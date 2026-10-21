"""Forecast engine for Apps 1, 2a and 2b.

On load, each trained bundle is run through `smartstock_core.recursive_forecast` for the full
26-week window that starts after the last week of data (App 2b is then combined with the App 2a
machine totals, exactly as in the notebook). Requests slice that window from the CURRENT week,
then apply priority, service level, calibration and revenue rules on the fly.
"""
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import NormalDist

import numpy as np
import pandas as pd

import smartstock_core as core

from . import calendar_utils as cal
from .config import settings
from .errors import bad_input

ALLOWED_SERVICE_LEVELS = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95)
PRIORITY_SL = {"High": 0.95, "Medium": 0.90, "Low": 0.80}
MIN_LEVEL = 0.1          # "minimum" = 90% sure at least this many sell


def _r(x, nd=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


class Level:
    """One trained application (app1, app2a or app2b) with its 26-week forecast."""

    def __init__(self, name, bundle, calibration, app2a=None):
        if "S" not in bundle:
            raise ValueError(f"{name}: this model bundle is from an older notebook version (no 'S' matrix). "
                             "Re-run the training notebook (v2.1 or later).")
        self.name = name
        self.bundle = bundle
        self.keys = bundle["keys"].reset_index(drop=True)
        self.Y = np.asarray(bundle["Y"], float)
        self.weeks = pd.DatetimeIndex(bundle["weeks"])
        self.T = self.Y.shape[1]
        self.horizon = int(bundle.get("reference_forecast", {}).get("weeks", settings.max_forecast_weeks))
        self.forecast_start = (self.weeks[-1] + pd.Timedelta(days=7)).date()
        self.future = pd.date_range(self.forecast_start, periods=self.horizon, freq="7D")
        self.cal = calibration
        self.z = {float(k): float(v) for k, v in calibration["z"].items()}

        ext = pd.date_range(self.weeks[0], periods=self.T + self.horizon, freq="7D")
        woy, month = core.week_calendar(ext)
        PR = bundle.get("price_matrix") if bundle.get("uses_price") else None
        P, L, U = core.recursive_forecast(bundle["models"], self.Y, woy, month, bundle["S"],
                                          bundle["static_names"], self.horizon, PR_hist=PR)
        comb = bundle.get("combination")
        if comb and app2a is not None:
            amap = pd.Series(np.arange(len(app2a.keys)), index=app2a.keys["Asset ID"].astype(str))
            idx = self.keys["Asset ID"].astype(str).map(amap)
            has = idx.notna().to_numpy()
            idx = idx.fillna(0).astype(int).to_numpy()
            share = core.product_shares(self.Y, app2a.Y[idx], int(comb.get("share_window_weeks", 13)))
            P, L, U, _ = core.combine_top_down(P, L, U, app2a.P[idx], share, has, float(comb.get("weight", 0.5)))
        self.P, self.L, self.U = P, L, U

        price = np.asarray(bundle.get("price_recent"), float)
        self.price = np.nan_to_num(price, nan=float(np.nanmedian(price)))
        groups = self.keys["Asset ID"].to_numpy() if name == "app2b" else None
        self.prio = core.priority_table(self.Y, self.price, groups)
        self.priority = self.prio["Priority"].to_numpy()
        self.cls = self.prio["Class"].to_numpy()
        if "Item" in self.keys:
            self.ptype = core.product_type(self.keys["Item"])
        else:
            self.ptype = np.array([None] * len(self.keys))
        self.location = np.asarray(bundle.get("location") or [""] * len(self.keys), dtype=object)
        self.confidence = np.asarray(bundle.get("confidence") or ["High"] * len(self.keys), dtype=object)
        self._index = {}

    # ---------------- lookups
    def rows_where(self, **kw):
        m = np.ones(len(self.keys), bool)
        for col, val in kw.items():
            s = self.keys[col].astype(str)
            hit = s == str(val)
            if not hit.any():   # tolerate case / spacing differences
                hit = s.str.strip().str.lower() == str(val).strip().lower()
            m &= hit.to_numpy()
        return np.where(m)[0]

    def reference_gap(self):
        """Max abs difference between this run and the forecast saved by the notebook (should be ~0)."""
        ref = self.bundle.get("reference_forecast")
        return None if ref is None else float(np.nanmax(np.abs(np.asarray(ref["P"]) - self.P)))

    def history(self, i, n=12):
        y = self.Y[i, -n:]
        return [{"week_start": str(w.date()), "units": _r(v)} for w, v in zip(self.weeks[-n:], y) if not np.isnan(v)]


# ---------------- the forecast window as seen from today
@dataclass
class Window:
    data_end: date
    forecast_start: date
    current_week_start: date
    offset: int                  # weeks between forecast start and the current week
    max_weeks: int
    max_months: int

    @property
    def data_age_weeks(self):
        return max(0, (self.current_week_start - self.forecast_start).days // 7)


# Set per request from ?skip_current=true: monthly forecasts then start the month after the current one
# ("Next month", "Next 3 months"), instead of with the current month ("This month").
skip_current_month: ContextVar[bool] = ContextVar("skip_current_month", default=False)


def month_start_index(level: Level) -> int:
    """Index of the first forecast week that touches the current month, so "this month" is a whole month
    (days already passed are expected values; the month stays expected until its data is fully uploaded)."""
    first = cal.today().replace(day=1)
    for i, w in enumerate(level.future):
        if w.date() + timedelta(days=6) >= first:
            return i
    return len(level.future)


def window_for(level: Level) -> Window:
    cws = cal.monday(cal.today())
    offset = max(0, (cws - level.forecast_start).days // 7)
    remaining = max(0, level.horizon - offset)
    max_w = min(settings.ui_max_weeks, remaining)
    months = 0
    if remaining > 0:
        _, months_list = core.month_fraction_matrix(level.future[month_start_index(level):])
        months = min(settings.ui_max_months, len(months_list))
    return Window(data_end=level.forecast_start - timedelta(days=1), forecast_start=level.forecast_start,
                  current_week_start=cws, offset=offset, max_weeks=max_w, max_months=months)


def check_params(win: Window, granularity: str, horizon: int | None, service_level: float | None):
    if granularity not in ("week", "month"):
        raise bad_input("granularity must be 'week' or 'month'.")
    limit = win.max_weeks if granularity == "week" else win.max_months - (1 if skip_current_month.get() else 0)
    if horizon is None:
        horizon = min(4 if granularity == "week" else 6, limit)
    if limit == 0:
        raise bad_input(f"Sales data is {win.data_age_weeks} weeks old, so no forecast is available from the current "
                        "week. Upload newer sales data and retrain.", "data_too_old")
    if not 1 <= horizon <= limit:
        unit = "weeks" if granularity == "week" else "months"
        raise bad_input(f"horizon must be between 1 and {limit} {unit} (limited because sales data is "
                        f"{win.data_age_weeks} weeks old).", "horizon_too_long")
    if service_level is not None and round(service_level, 2) not in ALLOWED_SERVICE_LEVELS:
        raise bad_input(f"service_level must be one of {', '.join(map(str, ALLOWED_SERVICE_LEVELS))}.")
    return horizon


def _z_for(level: Level, sl: float) -> float:
    sl = round(float(sl), 2)
    if sl in level.z:
        return level.z[sl]
    return core.SERVICE_Z.get(sl, NormalDist().inv_cdf(sl))


@dataclass
class Block:
    """Forecast values for a set of rows x periods (all arrays shaped rows x periods)."""
    meta: list
    p10: np.ndarray | None
    p50: np.ndarray
    p90: np.ndarray
    sigma: np.ndarray
    min_qty: np.ndarray
    safe_qty: np.ndarray
    service_level: np.ndarray
    price: np.ndarray
    rows: np.ndarray


def compute(level: Level, rows, granularity="week", horizon=None, service_level=None) -> tuple[Block, Window]:
    rows = np.asarray(rows, int)
    win = window_for(level)
    horizon = check_params(win, granularity, horizon, service_level)
    o = win.offset
    if granularity == "week":
        H = np.arange(o, o + horizon)
        P, L, U = level.P[rows][:, H], level.L[rows][:, H], level.U[rows][:, H]
        sigma = core.band_sigma(L, U)
        p10, p50, p90 = L, P, U
        meta = [{"period_start": str(level.future[h].date()), "period_label": cal.week_label(level.future[h].date()),
                 "horizon_confidence": cal.horizon_confidence(h + 1)} for h in H]
    else:
        m0 = month_start_index(level)
        fut = level.future[m0:]
        F, months = core.month_fraction_matrix(fut)
        if skip_current_month.get() and len(months) and months[0].start_time.date() == cal.today().replace(day=1):
            F, months = F[:, 1:], months[1:]
        F, months = F[:, :horizon], months[:horizon]
        Ps, Ls, Us = level.P[rows][:, m0:], level.L[rows][:, m0:], level.U[rows][:, m0:]
        p50, p90 = core.to_monthly(Ps, Ls, Us, F)
        sigma = core.monthly_sigma(Ls, Us, F)
        p10 = None
        meta = []
        for j, m in enumerate(months):
            last_week = int(np.max(np.where(F[:, j] > 0)[0]))
            meta.append({"period_start": str(m.start_time.date()), "period_label": cal.month_label(m),
                         "horizon_confidence": cal.horizon_confidence(max(o, m0) + last_week + 1)})
    if service_level is None:
        sl = np.array([PRIORITY_SL[p] for p in level.priority[rows]])
    else:
        sl = np.full(len(rows), round(float(service_level), 2))
    zsl = np.array([_z_for(level, s) for s in sl])[:, None]
    min_qty = core.calibrated_qty(p50, sigma, _z_for(level, MIN_LEVEL), "min")
    safe_qty = core.calibrated_qty(p50, sigma, zsl)
    return Block(meta, p10, p50, p90, sigma, min_qty, safe_qty, np.repeat(sl[:, None], len(meta), 1),
                 level.price[rows], rows), win


def periods_for_row(b: Block, k: int) -> list:
    out, pr = [], float(b.price[k])
    for j, m in enumerate(b.meta):
        p50, p90 = float(b.p50[k, j]), float(b.p90[k, j])
        mn, sf = int(b.min_qty[k, j]), int(b.safe_qty[k, j])
        out.append({**m, "p10": None if b.p10 is None else _r(b.p10[k, j]), "p50": _r(p50), "p90": _r(p90),
                    "min_qty": mn, "safe_qty": sf, "service_level": float(b.service_level[k, j]),
                    "revenue_p50": _r(p50 * pr), "revenue_p90": _r(p90 * pr),
                    "revenue_min": _r(mn * pr), "revenue_safe": _r(sf * pr)})
    return out


def aggregate_periods(b: Block, service_level=None, level=None) -> list:
    """Totals across rows (e.g. all products in a machine), treating the rows' errors as independent.
    min_qty / safe_qty describe the TOTAL (at service_level, default 90%); sum_of_safe_qty is what you
    would stock if every row were stocked at its own safe level (always higher)."""
    sl = 0.9 if service_level is None else round(float(service_level), 2)
    z_sl = core.SERVICE_Z.get(sl, NormalDist().inv_cdf(sl))
    out = []
    for j, m in enumerate(b.meta):
        p50 = float(b.p50[:, j].sum())
        sd = max(float(np.sqrt((b.sigma[:, j] ** 2).sum())), 0.5)
        p90 = p50 + core.Z90 * sd
        p10 = None if b.p10 is None else max(0.0, p50 - core.Z90 * sd)
        avg_price = float((b.p50[:, j] * b.price).sum() / max(p50, 1e-9)) if p50 > 0 else float(np.mean(b.price))
        mn = int(np.floor(max(p50 - core.Z90 * sd, 0)))
        sf = int(np.ceil(max(p50 + z_sl * sd, 0)))
        out.append({**m, "p10": _r(p10), "p50": _r(p50), "p90": _r(p90), "min_qty": mn, "safe_qty": sf,
                    "service_level": sl, "sum_of_safe_qty": int(b.safe_qty[:, j].sum()),
                    "revenue_p50": _r((b.p50[:, j] * b.price).sum()), "revenue_p90": _r(p90 * avg_price),
                    "revenue_min": _r(mn * avg_price), "revenue_safe": _r(sf * avg_price)})
    return out


def sparkline(b: Block, k: int):
    return [_r(v) for v in b.p50[k]]


def series_header(level: Level, i: int) -> dict:
    return {"priority": level.priority[i], "class": level.cls[i], "price_recent": _r(level.price[i]),
            **({"ptype": level.ptype[i]} if level.ptype[i] is not None else {})}


# ---------------- App 1 cut steps
def cut_step_quantities(level: Level, b: Block, step: int, service_level=None):
    """Quantities per row x period after a cut step. High priority is never cut.
    1: Low -> minimum; 2: also Medium -> 80% cover; 3: also Medium -> minimum."""
    pr = level.priority[b.rows][:, None]
    base = b.safe_qty
    q80 = core.calibrated_qty(b.p50, b.sigma, _z_for(level, 0.8))
    q = base.copy()
    if step >= 1:
        q = np.where(pr == "Low", b.min_qty, q)
    if step == 2:
        q = np.where(pr == "Medium", np.minimum(q80, base), q)
    if step >= 3:
        q = np.where(pr == "Medium", b.min_qty, q)
    return q
