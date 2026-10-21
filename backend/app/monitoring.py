"""Forecast vs actual: compare older versions' saved forecasts with the sales that have since arrived."""
import numpy as np
import pandas as pd

from .config import settings
from .errors import bad_input
from .store import list_versions, read_json, store, versions_dir


def accuracy(app: str, date_from: str | None = None, date_to: str | None = None) -> dict:
    if app not in ("app1", "app2a", "app2b"):
        raise bad_input("app must be app1, app2a or app2b.")
    ms = store.require()
    lv = ms.levels[app]
    key_cols = list(lv.keys.columns)
    actual = lv.keys.copy()
    actual = actual.loc[np.repeat(np.arange(len(lv.keys)), len(lv.weeks))].reset_index(drop=True)
    actual["week_start"] = np.tile([str(w.date()) for w in lv.weeks], len(lv.keys))
    actual["actual"] = lv.Y.ravel()
    actual = actual.dropna(subset=["actual"])
    for c in key_cols:
        actual[c] = actual[c].astype(str)

    frames = []
    for v in list_versions():
        if v["version"] == ms.version:
            continue
        snap = versions_dir() / v["version"] / f"snapshot_{app}.csv.gz"
        if not snap.exists():
            continue
        s = pd.read_csv(snap, dtype={c: str for c in key_cols})
        s["version"], s["trained_at"] = v["version"], str(v.get("trained_at"))
        frames.append(s)
    backtest = (ms.metrics.get(app) or {}).get("WAPE")
    thr = None if backtest is None else round(backtest + settings.drift_margin, 4)
    base = {"app": app, "weeks": [], "wape": None, "backtest_wape": backtest, "drift_threshold": thr, "drift": False}
    if not frames:
        return {**base, "note": "No forecast-vs-actual weeks yet. They appear after newer sales data is uploaded "
                                "and a newer model version is made active."}
    f = pd.concat(frames)
    f = f.sort_values("trained_at").drop_duplicates(key_cols + ["week_start"], keep="last")   # newest forecast per week
    m = f.merge(actual, on=key_cols + ["week_start"], how="inner")
    if date_from:
        m = m[m["week_start"] >= date_from]
    if date_to:
        m = m[m["week_start"] <= date_to]
    if m.empty:
        return {**base, "note": "No overlapping weeks between earlier forecasts and the current data."}
    weeks = []
    for w, g in m.groupby("week_start"):
        a = g["actual"].to_numpy()
        p = g["p50"].to_numpy()
        weeks.append({"week_start": w, "actual": round(float(a.sum()), 1), "forecast_p50": round(float(p.sum()), 1),
                      "safe_qty": int(g["safe_qty"].sum()), "wape": round(float(np.abs(a - p).sum() / max(a.sum(), 1e-9)), 4),
                      "within_safe_stock": round(float((a <= g["safe_qty"].to_numpy()).mean()), 4),
                      "series": int(len(g)), "forecast_version": g["version"].iloc[0]})
    a, p = m["actual"].to_numpy(), m["p50"].to_numpy()
    wape = float(np.abs(a - p).sum() / max(a.sum(), 1e-9))
    return {**base, "weeks": weeks, "wape": round(wape, 4),
            "within_safe_stock": round(float((a <= m["safe_qty"].to_numpy()).mean()), 4),
            "drift": bool(thr is not None and len(weeks) >= 2 and wape > thr)}
