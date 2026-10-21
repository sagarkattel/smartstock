"""Model versions on disk and the in-memory active model set.

models/
  active.json                      {"active": "<version>"}
  versions/<version>/
      version.json                 {version, trained_at, data_end, mode, status, job_id}
      models/  evaluation/  docs/  forecasts/  config/     (the notebook's smartstock_v2 output)
      snapshot_<app>.csv.gz        26-week forecast written on first load (for accuracy monitoring)
"""
import json
import logging
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

from .config import settings
from .errors import ApiError, not_found
import smartstock_core as core

from .forecasting import PRIORITY_SL, Level, _z_for, compute

log = logging.getLogger("smartstock")
APPS = ("app1", "app2a", "app2b")


def versions_dir() -> Path:
    return settings.models_dir / "versions"


def read_json(p: Path, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(p: Path, data):
    p = Path(p)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str))
    tmp.replace(p)


def list_versions() -> list[dict]:
    out = []
    for d in sorted(versions_dir().iterdir()) if versions_dir().exists() else []:
        if not (d / "models").is_dir():
            continue
        info = read_json(d / "version.json", {}) or {}
        metrics = read_json(d / "evaluation" / "metrics.json", {}) or {}
        info.setdefault("version", d.name)
        info.setdefault("trained_at", metrics.get("generated"))
        info.setdefault("data_end", (metrics.get("data_window") or [None, None])[1])
        info.setdefault("mode", "full")
        info.setdefault("status", "candidate")
        info["metrics"] = summary_metrics(metrics)
        out.append(info)
    active = active_version_name()
    for v in out:
        if v["version"] == active:
            v["status"] = "active"
        elif v["status"] == "active":
            v["status"] = "archived"
    return sorted(out, key=lambda v: str(v.get("trained_at")), reverse=True)


def summary_metrics(m: dict) -> dict:
    out = {}
    for app in APPS:
        a = m.get(app) or {}
        out[app] = {"wape": a.get("WAPE"), "gain_vs_baseline": a.get("MAE_improvement_vs_best_baseline")}
    loso = ((m.get("app3") or {}).get("loso_summary") or {})
    meth = (m.get("app3") or {}).get("method")
    out["app3"] = {"precision_at_10": (loso.get(meth) or {}).get("P@10")}
    return out


def active_version_name() -> str | None:
    a = read_json(settings.models_dir / "active.json", {}) or {}
    if a.get("active") and (versions_dir() / a["active"] / "models").is_dir():
        return a["active"]
    vs = [d.name for d in sorted(versions_dir().iterdir()) if (d / "models").is_dir()] if versions_dir().exists() else []
    return vs[-1] if vs else None


class ModelSet:
    """Everything loaded from one model version."""

    def __init__(self, version: str):
        t0 = time.time()
        self.version = version
        self.dir = versions_dir() / version
        mdir = self.dir / "models"
        self.calibration = read_json(mdir / "calibration.json")
        if not self.calibration:
            raise ValueError(f"{version}: models/calibration.json is missing")
        self.metrics = read_json(self.dir / "evaluation" / "metrics.json", {}) or {}
        self.info = read_json(self.dir / "version.json", {}) or {}
        bundles = {a: joblib.load(mdir / f"{a}_bundle.joblib") for a in APPS}
        self.sklearn_trained = bundles["app1"].get("sklearn_version")
        self.levels = {}
        self.levels["app1"] = Level("app1", bundles["app1"], self.calibration["app1"])
        self.levels["app2a"] = Level("app2a", bundles["app2a"], self.calibration["app2a"])
        self.levels["app2b"] = Level("app2b", bundles["app2b"], self.calibration["app2b"], app2a=self.levels["app2a"])
        self.app3_bundle = joblib.load(mdir / "app3_bundle.joblib")
        self.trained_until = bundles["app1"].get("trained_until")
        self.loaded_seconds = round(time.time() - t0, 1)
        self.write_snapshots()
        log.info("Loaded model version %s in %.1fs", version, self.loaded_seconds)

    def write_snapshots(self):
        """Save this version's 26-week forecast (default service levels) for later forecast-vs-actual checks."""
        for app, lv in self.levels.items():
            p = self.dir / f"snapshot_{app}.csv.gz"
            if p.exists():
                continue
            rows = []
            for h, w in enumerate(lv.future):
                d = lv.keys.copy()
                d["week_start"] = str(w.date())
                d["p50"] = np.round(lv.P[:, h], 3)
                sig = core.band_sigma(lv.L[:, h], lv.U[:, h])
                z = np.array([_z_for(lv, PRIORITY_SL[p]) for p in lv.priority])
                d["safe_qty"] = core.calibrated_qty(lv.P[:, h], sig, z)
                rows.append(d)
            try:
                pd.concat(rows).to_csv(p, index=False, compression="gzip")
            except OSError as exc:      # read-only model folder: monitoring just has less to show
                log.warning("Could not write %s: %s", p, exc)

    def health(self):
        gaps = {a: lv.reference_gap() for a, lv in self.levels.items()}
        return {"version": self.version, "trained_until": self.trained_until, "loaded_seconds": self.loaded_seconds,
                "sklearn_trained": self.sklearn_trained, "sklearn_installed": sklearn.__version__,
                "sklearn_match": self.sklearn_trained == sklearn.__version__,
                "forecast_matches_notebook": {a: (g is not None and g < 1e-6) for a, g in gaps.items()},
                "max_difference_vs_notebook": gaps}


class Store:
    def __init__(self):
        self._lock = threading.RLock()
        self.current: ModelSet | None = None
        self.load_error: str | None = None
        self.app3 = None          # app3 recommender, built in app3.py

    def load_active(self):
        with self._lock:
            name = active_version_name()
            if not name:
                self.current, self.load_error = None, "No trained model version found in models/versions/."
                return
            try:
                ms = ModelSet(name)
                from .app3 import Recommender
                self.app3 = Recommender(ms.app3_bundle, ms.version)
                self.current, self.load_error = ms, None
                if not (settings.models_dir / "active.json").exists():
                    write_json(settings.models_dir / "active.json", {"active": name})
            except Exception as exc:  # keep serving the previous set if a new one fails
                log.exception("Failed to load model version %s", name)
                self.load_error = f"{type(exc).__name__}: {exc}"
                if self.current is None:
                    raise

    def require(self) -> ModelSet:
        if self.current is None:
            raise ApiError(503, "models_not_loaded", self.load_error or "Models are still loading.")
        return self.current

    def level(self, app) -> Level:
        return self.require().levels[app]

    def promote(self, version: str):
        if not (versions_dir() / version / "models").is_dir():
            raise not_found(f"Model version '{version}' not found.")
        with self._lock:
            previous = active_version_name()
            ms = ModelSet(version)           # load first: never activate a version that cannot load
            from .app3 import Recommender
            rec = Recommender(ms.app3_bundle, ms.version)
            write_json(settings.models_dir / "active.json",
                       {"active": version, "previous": previous, "changed_at": datetime.now().isoformat(timespec="seconds")})
            for v, st in ((previous, "archived"), (version, "active")):
                if v and (versions_dir() / v).is_dir():
                    p = versions_dir() / v / "version.json"
                    info = read_json(p, {}) or {"version": v}
                    info["status"] = st
                    write_json(p, info)
            self.current, self.app3, self.load_error = ms, rec, None
        return version


store = Store()


def import_version(src: Path, version: str, mode: str, job_id: str | None = None, status="candidate") -> Path:
    """Copy a notebook output folder (smartstock_v2) into models/versions/<version>."""
    dst = versions_dir() / version
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("cache", "figures", "*.pkl"))
    m = read_json(dst / "evaluation" / "metrics.json", {}) or {}
    write_json(dst / "version.json", {"version": version, "trained_at": m.get("generated"),
                                      "data_end": (m.get("data_window") or [None, None])[1],
                                      "mode": mode, "status": status, "job_id": job_id})
    return dst


def check_bundle_sanity(model_set: ModelSet, *apps):
    for a in apps or APPS:
        lv = model_set.levels[a]
        b, _ = compute(lv, np.arange(min(3, len(lv.keys))), "week", 1)
        assert np.isfinite(b.p50).all()
