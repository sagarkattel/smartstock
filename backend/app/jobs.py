"""Retraining jobs: run the training notebook (as a script) in the background.

Each job gets its own folder data/jobs/<job_id>/ with a work copy of the dataset (current files
plus any uploaded files that replace them), the current site-category rules, the log, and job.json.
A successful job becomes a *candidate* model version; it is used only after someone makes it active.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from . import uploads
from .config import settings
from .errors import bad_input, conflict, not_found
from .store import ModelSet, import_version, read_json, store, write_json

PROGRESS = [  # (regex on a log line, step name, percent)
    (r"^Site-category rules", "Preparing", 3),
    (r"^\d{4}: [\d,]+ rows", "Reading sales files", 6),
    (r"^Loaded cached sales", "Reading sales files", 8),
    (r"^Clean rows", "Cleaning and checking data", 12),
    (r"^\[app1\] series", "App 1: training", 15),
    (r"^\[app1\] fold (\d)/4", "App 1: backtest", None),
    (r"^\[app1\] finished", "App 1: done", 32),
    (r"^\[app2a\] series", "App 2a: training", 34),
    (r"^\[app2a\] fold (\d)/4", "App 2a: backtest", None),
    (r"^\[app2a\] finished", "App 2a: done", 50),
    (r"^\[app2b\] series", "App 2b: training", 52),
    (r"^\[app2b\] fold (\d)/4", "App 2b: backtest", None),
    (r"^\[app2b\] finished", "App 2b: done", 74),
    (r"^app1: selected", "Approach comparison", 77),
    (r"^===== App 1 - Warehouse demand =====", "Priority and calibration", 80),
    (r"^App 3 training sites", "App 3: site categories", 84),
    (r"^Leave-one-site-out", "App 3: evaluation", 88),
    (r"^app1_warehouse_weekly\.csv", "Exporting forecasts", 93),
    (r"^Files written|^All outputs", "Writing documents", 97),
]
FOLD_RANGE = {"app1": (15, 32), "app2a": (34, 50), "app2b": (52, 74)}
_lock = threading.Lock()


def jobs_dir() -> Path:
    return settings.data_dir / "jobs"


def job_path(job_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", job_id or ""):
        raise not_found("Unknown job.", "unknown_job")
    return jobs_dir() / job_id


def load_job(job_id: str) -> dict:
    j = read_json(job_path(job_id) / "job.json")
    if not j:
        raise not_found("Unknown job.", "unknown_job")
    log = job_path(job_id) / "log.txt"
    j["log_tail"] = log.read_text(errors="replace").splitlines()[-30:] if log.exists() else []
    return j


def list_jobs() -> list[dict]:
    out = []
    for d in jobs_dir().iterdir() if jobs_dir().exists() else []:
        j = read_json(d / "job.json")
        if j:
            out.append({k: v for k, v in j.items() if k != "log_tail"})
    return sorted(out, key=lambda j: j.get("started_at") or "", reverse=True)


def running_job():
    for j in list_jobs():
        if j["status"] in ("queued", "running"):
            return j
    return None


def recover_after_restart():
    for j in list_jobs():
        if j["status"] in ("queued", "running"):
            j["status"], j["step"] = "failed", "Stopped: the server restarted during training"
            j["finished_at"] = datetime.now().isoformat(timespec="seconds")
            write_json(jobs_dir() / j["job_id"] / "job.json", j)


def _dataset_signature(files: dict) -> str:
    h = hashlib.sha256()
    for name in sorted(files):
        st = Path(files[name]).stat()
        h.update(f"{name}:{st.st_size}:{int(st.st_mtime)}".encode())
    return h.hexdigest()[:16]


def start(upload_id: str | None, mode: str, started_by: str = "admin") -> dict:
    if mode not in ("quick", "full"):
        raise bad_input("mode must be 'quick' or 'full'.")
    if not settings.training_script.exists():
        raise bad_input(f"Training script not found: {settings.training_script}", "no_training_script")
    staged = {}
    if upload_id:
        r = uploads.get_report(upload_id)
        if not r.get("can_train"):
            raise bad_input("This upload has blocking errors; fix them and upload again.", "upload_not_trainable")
        staged = {t: uploads.upload_dir(upload_id) / n for t, n in (r.get("staged") or {}).items()}
    files = {p.name: p for p in settings.dataset_dir.glob("*.xlsx")}
    files.update(staged)
    if "CashlessMachines.xlsx" not in files or not any(n.startswith("CashlessSalesAnalysis-") for n in files):
        raise bad_input("The dataset folder needs CashlessMachines.xlsx and at least one CashlessSalesAnalysis-<year>.xlsx "
                        f"(put them in {settings.dataset_dir} or upload them).", "no_dataset")
    with _lock:
        if running_job():
            raise conflict("A retraining job is already running. Wait for it to finish.", "job_running")
        job_id = uuid.uuid4().hex[:12]
        jd = jobs_dir() / job_id
        jd.mkdir(parents=True)
        job = {"job_id": job_id, "mode": mode, "status": "queued", "step": "Queued", "percent": 0,
               "started_at": datetime.now().isoformat(timespec="seconds"), "finished_at": None,
               "started_by": started_by, "upload_id": upload_id, "result_version": None, "error": None,
               "dataset_files": sorted(files)}
        write_json(jd / "job.json", job)
    threading.Thread(target=_run, args=(job_id, files, mode, upload_id), daemon=True).start()
    return {"job_id": job_id}


def _update(job_id, **kw):
    p = jobs_dir() / job_id / "job.json"
    j = read_json(p, {})
    j.update(kw)
    write_json(p, j)
    return j


def _run(job_id, files, mode, upload_id):
    jd = jobs_dir() / job_id
    base = jd / "work" / "ai_practice"
    ds = base / "dataset"
    out = base / "smartstock_v2"
    log_path = jd / "log.txt"
    t0 = time.time()
    try:
        ds.mkdir(parents=True)
        (out / "config").mkdir(parents=True)
        (out / "cache").mkdir(parents=True)
        for name, src in files.items():
            try:
                os.symlink(Path(src).resolve(), ds / name)
            except OSError:
                shutil.copy2(src, ds / name)
        for f in settings.config_dir.glob("*.csv"):
            shutil.copy2(f, out / "config" / f.name)
        sig = _dataset_signature(files)
        cache = settings.data_dir / "state" / f"sales_raw_{sig}.pkl"
        if cache.exists():                     # same files as a previous job: skip re-reading the Excel files
            shutil.copy2(cache, out / "cache" / "sales_raw.pkl")
        script = jd / "smartstock_training.py"
        shutil.copy2(settings.training_script, script)
        fixed = {}
        if store.current is not None:
            for a in ("app1", "app2a", "app2b"):
                p = (store.current.metrics.get(a) or {}).get("params") or {}
                fixed[a] = {k: p[k] for k in ("learning_rate", "max_leaf_nodes") if k in p}
        env = {**os.environ, "SMARTSTOCK_BASE": str(base), "SMARTSTOCK_QUICK": "1" if mode == "quick" else "0",
               "SMARTSTOCK_FIXED_PARAMS": json.dumps(fixed), "MPLBACKEND": "Agg", "PYTHONUNBUFFERED": "1"}
        _update(job_id, status="running", step="Starting", percent=1)
        py = settings.python_executable or sys.executable
        with open(log_path, "w") as log:
            proc = subprocess.Popen([py, "-u", script.name], cwd=jd, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, bufsize=1)
            pct = 1
            for line in proc.stdout:
                log.write(line)
                log.flush()
                s = line.strip()
                for rx, step, p in PROGRESS:
                    m = re.match(rx, s)
                    if m:
                        if p is None:
                            app = re.match(r"^\[(\w+)\]", s).group(1)
                            lo, hi = FOLD_RANGE[app]
                            p = lo + (hi - lo) * int(m.group(1)) / 5
                        if p >= pct:
                            pct = int(p)
                            _update(job_id, step=step, percent=pct)
                        break
            rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"Training stopped with exit code {rc}. See the log for details.")
        if (out / "cache" / "sales_raw.pkl").exists() and not cache.exists():
            for old in (settings.data_dir / "state").glob("sales_raw_*.pkl"):
                old.unlink(missing_ok=True)
            shutil.copy2(out / "cache" / "sales_raw.pkl", cache)
        _update(job_id, step="Checking the new models", percent=98)
        version = datetime.now().strftime("%Y%m%d-%H%M") + f"-{mode}"
        dst = import_version(out, version, mode, job_id)
        ms = ModelSet(version)                 # proves the new version loads and forecasts
        comparison = compare_with_active(ms)
        info = read_json(dst / "version.json", {})
        info.update({"comparison": comparison, "better_than_active": comparison.get("better")})
        write_json(dst / "version.json", info)
        merged = uploads.merge_into_dataset(upload_id) if upload_id else []
        shutil.rmtree(jd / "work", ignore_errors=True)
        _update(job_id, status="succeeded", step="Finished", percent=100, result_version=version,
                finished_at=datetime.now().isoformat(timespec="seconds"), duration_seconds=int(time.time() - t0),
                comparison=comparison, merged_files=merged)
    except Exception as exc:
        with open(log_path, "a") as log:
            log.write(f"\nERROR: {type(exc).__name__}: {exc}\n")
        _update(job_id, status="failed", step="Failed", error=f"{type(exc).__name__}: {exc}",
                finished_at=datetime.now().isoformat(timespec="seconds"), duration_seconds=int(time.time() - t0))


def compare_with_active(ms: ModelSet) -> dict:
    cur = store.current
    rows, wins = {}, 0
    for a in ("app1", "app2a", "app2b"):
        new = (ms.metrics.get(a) or {}).get("WAPE")
        old = (cur.metrics.get(a) or {}).get("WAPE") if cur else None
        if new is None or old is None:
            verdict = None
        else:
            verdict = "same" if abs(new - old) < 1e-6 else ("better" if new < old else "worse")
        rows[a] = {"wape_new": new, "wape_active": old, "verdict": verdict}
        wins += verdict == "better"
    same = all(rows[a]["verdict"] == "same" for a in ("app1", "app2a", "app2b"))
    rows["better"] = None if (cur is None or same) else wins >= 2
    rows["verdict"] = "same" if same else ("better" if rows["better"] else "worse")
    rows["note"] = ("WAPE is measured on each version's own most recent backtest weeks, so versions trained on "
                    "different data are compared on different weeks.")
    return rows
