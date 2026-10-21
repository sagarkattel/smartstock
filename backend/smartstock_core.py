"""SmartStock core: feature and forecast code used by both the notebook and the backend.

Y is a (series x weeks) array of weekly units. NaN = before the first sale, 0 = no sales that week.
"""
import warnings
import numpy as np
import pandas as pd

LAGS = (1, 2, 4, 52)
WINDOWS = (4, 8, 13, 26)
DYNAMIC_FEATURES = ([f"lag_{k}" for k in LAGS] + [f"rm_{w}" for w in WINDOWS]
                    + ["rstd_8", "age", "woy", "month"])
PRICE_FEATURES = ["price_4", "price_chg"]
Z90 = 1.2816
IQR_TO_SIGMA = 2 * Z90       # sigma ~ (P90 - P10) / 2.563
SERVICE_Z = {0.5: 0.0, 0.6: 0.2533, 0.7: 0.5244, 0.8: 0.8416, 0.9: 1.2816, 0.95: 1.6449}


def qty_for_service_level(P, L, U, service_level=0.9):
    """Stock needed to cover demand at a given service level (normal approx. from P10-P90)."""
    z = SERVICE_Z.get(round(service_level, 2))
    if z is None:
        from statistics import NormalDist
        z = NormalDist().inv_cdf(service_level)
    sigma = (np.asarray(U) - np.asarray(L)) / IQR_TO_SIGMA
    return np.ceil(np.asarray(P) + z * sigma).astype(int)


def product_shares(Y_prod, Y_total, window=13):
    """Each product's share of its machine's total units over the last `window` weeks."""
    p = np.nansum(Y_prod[:, -window:], axis=1)
    t = np.nansum(Y_total[:, -window:], axis=1)
    return np.where(t > 0, p / np.maximum(t, 1e-9), 0.0)


def combine_top_down(P, L, U, P_total, share, has_total=None, weight=0.5):
    """Blend the direct forecast with share x machine total. The band moves with the point forecast."""
    td = share[:, None] * P_total
    if has_total is not None:
        td = np.where(np.asarray(has_total)[:, None], td, P)
    C = weight * P + (1 - weight) * td
    shift = C - P
    return C, np.clip(L + shift, 0, None), np.clip(U + shift, 0, None), td


# priority (ABC-XYZ) and calibration
PRIORITY_MAP = {"AX": "High", "AY": "High", "AZ": "High", "BX": "High",
                "BY": "Medium", "BZ": "Medium", "CX": "Medium",
                "CY": "Low", "CZ": "Low"}


def priority_table(Y_hist, price, groups=None, window=26):
    """ABC on sales value, XYZ on the coefficient of variation (both over the last `window` weeks)."""
    w = np.nan_to_num(Y_hist[:, -window:])
    units = w.sum(axis=1)
    value = units * np.asarray(price, dtype=float)
    mean = w.mean(axis=1)
    cv = np.where(mean > 0, w.std(axis=1) / np.maximum(mean, 1e-9), np.inf)
    xyz = np.where(cv <= 0.5, "X", np.where(cv <= 1.0, "Y", "Z"))
    abc = np.empty(len(value), dtype=object)
    grp = np.zeros(len(value)) if groups is None else np.asarray(groups)
    for g in pd.unique(grp):
        ix = np.where(grp == g)[0]
        order = ix[np.argsort(-value[ix], kind="stable")]
        share_before = (np.cumsum(value[order]) - value[order]) / max(value[ix].sum(), 1e-9)
        abc[order] = np.where(share_before < 0.80, "A", np.where(share_before < 0.95, "B", "C"))
    cls = np.char.add(abc.astype(str), xyz.astype(str))
    return pd.DataFrame({"ABC": abc, "XYZ": xyz, "Class": cls, "CV_26wk": np.round(cv, 3),
                         "Value_26wk": np.round(value, 2), "Units_26wk": units,
                         "Priority": [PRIORITY_MAP[c] for c in cls]})


def band_sigma(L, U, floor=0.5):
    """Sigma from the P10-P90 band, with a floor so tiny bands still work."""
    return np.maximum((np.asarray(U, float) - np.asarray(L, float)) / IQR_TO_SIGMA, floor)


def conformal_z(y, P, L, U, levels, grid=np.linspace(-4, 8, 1201)):
    """Split conformal: find the z that actually gives each coverage level on held-out errors.
    Levels >= 0.5 are safe-stock levels (round up), < 0.5 are minimums (round down)."""
    y, P = np.asarray(y, float), np.asarray(P, float)
    sig = band_sigma(L, U)
    n = len(y)
    out = {}
    for lv in levels:
        if lv >= 0.5:
            target = min(1.0, np.ceil((n + 1) * lv) / n)
            z = grid[-1]
            for g in grid:
                if (y <= np.ceil(np.maximum(P + g * sig, 0))).mean() >= target:
                    z = g
                    break
        else:
            target = min(1.0, np.ceil((n + 1) * (1 - lv)) / n)
            z = grid[0]
            for g in grid[::-1]:
                if (y >= np.floor(np.maximum(P + g * sig, 0))).mean() >= target:
                    z = g
                    break
        out[float(lv)] = float(z)
    return out


def calibrated_qty(P, sigma, z, kind="safe"):
    """P + z * sigma, rounded up for safe stock and down for the minimum."""
    v = np.maximum(np.asarray(P, float) + np.asarray(z, float) * np.asarray(sigma, float), 0)
    return (np.ceil(v) if kind == "safe" else np.floor(v)).astype(int)


def monthly_sigma(L, U, F):
    """Monthly sigma from the weekly ones, assuming independent weeks."""
    return np.sqrt((band_sigma(L, U) ** 2) @ (F ** 2))


# App 3: site categories from location names
import re as _re
OTHER_CAT, STAFF_CAT = "Other / unclassified", "Staff area"
# starting keyword list (saved to config/site_category_keywords.csv); "*" = any ending
DEFAULT_SITE_KEYWORDS = {
    "Sports & fitness": "sport*, aquatic, athletic, archery, f45, fitness, gym, hockey, stadium",
    "Transport & transit": "station, railcorp, transit, transdev, airport, airroad, air road, bus",
    "Education": "tafe, college, universit*, institute, school, education, study group, uws, cq, mit, tutor*, tuturing, academy",
    "Student accommodation": "unilodge, student accommodation",
    "Construction site": "building site, construction",
    "Automotive": "toyota, hyundai, motor*, hino, smash, crash, auto*",
    "Healthcare & aged care": "nursing, aged care, bupa, anglicare, hospital, medical, health*",
    "Hospitality & clubs": "hotel, inn, leagues, club, cafe, pub, racecourse, turf",
    "Retail": "h & m, h&m, myer*, office works, officeworks, flower power, woolworths, kmart, coles, aldi",
    "Car park & storage": "parking, kennards, storage, stirage",
    "Culture & events": "museum, showground, exhib*, gallery, theatre, cinema",
    "Office & corporate": ("pty, ltd, group, solutions, systems, company, finance, bank, csiro, b.o.m, nicta, csc, abbott, "
                           "life, partners, equipment, operations centre, business, imagetec, valiant, displaywise, ventia, "
                           "position, insurance, claims"),
    "Industrial & logistics": "warehouse, distribution, logistics, express, freight, metal, industr*, factory, foods, moffat, lifts",
    STAFF_CAT: "staff, lunch*, breakout, canteen, crib, tea room, tearoom, kitchen, office, shed, factory, warehouse, shift",
}


def default_keyword_table():
    rows = []
    for cat, kws in DEFAULT_SITE_KEYWORDS.items():
        for kw in [k.strip() for k in kws.split(",") if k.strip()]:
            rows.append({"Category": cat, "Keyword": kw,
                         "Applies_to": "placement notes" if cat == STAFF_CAT else "location name",
                         "Active": "yes", "Note": ""})
    return pd.DataFrame(rows)


def _kw_pattern(kw):
    kw = kw.strip().lower()
    stem, wild = (kw[:-1], True) if kw.endswith("*") else (kw, False)
    body = r"\s+".join(_re.escape(part) for part in stem.split())
    return r"(?<![a-z0-9])" + body + (r"[a-z0-9]*" if wild else r"(?![a-z0-9])")


def compile_site_rules(table):
    """Compile the keyword table into regex rules."""
    t = table.copy()
    t = t[t["Active"].astype(str).str.strip().str.lower().isin(["yes", "y", "true", "1"])]
    rules = {"name": [], "notes": []}
    for _, r in t.iterrows():
        key = "notes" if "note" in str(r["Applies_to"]).lower() else "name"
        rules[key].append((str(r["Category"]).strip(), str(r["Keyword"]).strip(), _re.compile(_kw_pattern(str(r["Keyword"])))))
    cats = list(dict.fromkeys([c for c, _, _ in rules["name"]]))
    rules["categories"] = cats + [OTHER_CAT, STAFF_CAT]
    return rules


def staff_area_match(text, rules):
    t = str(text).lower()
    return any(rx.search(t) for _, _, rx in rules["notes"])


def site_categories(name, staff_share, rules, overrides=None):
    """Returns (categories, matched keywords, source). Overrides win over keywords."""
    n = str(name).strip().lower()
    n = _re.sub(r"\s+", " ", n)
    ov = (overrides or {}).get(n)
    if ov and ov.get("categories"):
        cats, matched, source = list(ov["categories"]), [], "override"
    else:
        hits = [(c, kw) for c, kw, rx in rules["name"] if rx.search(n)]
        cats = list(dict.fromkeys(c for c, _ in hits))
        matched = [f"{c}: {kw}" for c, kw in hits]
        source = "keyword" if cats else "none"
        if not cats:
            cats = [OTHER_CAT]
    staff = ov.get("staff") if ov and ov.get("staff") is not None else (staff_share >= 0.5)
    if staff and STAFF_CAT not in cats:
        cats.append(STAFF_CAT)
    return cats, matched, source


def load_overrides(table):
    out = {}
    for _, r in table.iterrows():
        loc = _re.sub(r"\s+", " ", str(r.get("Location", "")).strip().lower())
        if not loc or loc == "nan":
            continue
        cats = [c.strip() for c in str(r.get("Categories", "")).split("|") if c.strip() and c.strip().lower() != "nan"]
        st = str(r.get("Staff_area", "")).strip().lower()
        out[loc] = {"categories": cats, "staff": True if st in ("yes", "y", "true", "1") else
                    (False if st in ("no", "n", "false", "0") else None)}
    return out


# product type from the product name
DRINK_RE = (r"\d+\s?ml\b|\d(?:\.\d+)?\s?l(?:tr)?\b|cola|coke|pepsi|water|juice|red ?bull|monster|gatorade|powerade|"
            r"sprite|fanta|solo|lemonade|\btea\b|coffee|milk|\bv\b|mother|soda|drink|kombucha|aloe|mount franklin|nudie")
NONFOOD_RE = r"laundry|detergent|softener|powder|wash|soap|razor|battery|charger|tissue|mask"


def product_type(names):
    """Drink, snack/food or non-food, guessed from the name."""
    lo = pd.Series(list(names), dtype=str).str.lower()
    return np.select([lo.str.contains(NONFOOD_RE, regex=True), lo.str.contains(DRINK_RE, regex=True)],
                     ["Other (non-food)", "Drink"], "Snack/food")


def scaled_seasonal_naive(Y_hist, horizon):
    """Last year's weeks (smoothed), scaled by recent growth."""
    n, T = Y_hist.shape
    recent = np.nansum(Y_hist[:, T - 13:T], axis=1)
    ly = np.nansum(Y_hist[:, max(0, T - 65):max(0, T - 52)], axis=1)
    r = np.clip(np.where(ly > 0, recent / np.maximum(ly, 1e-9), 1.0), 0.3, 3.0)
    ma = np.nan_to_num(_nan_agg(np.nanmean, Y_hist[:, T - 13:T]))
    out = np.zeros((n, horizon))
    for h in range(horizon):
        a = T - 52 + h
        v = _nan_agg(np.nanmean, Y_hist[:, max(0, a - 1):max(0, a + 2)]) if a + 2 > 0 else np.full(n, np.nan)
        out[:, h] = np.where(np.isnan(v) | (ly <= 0), ma, r * v)
    return out


def _nan_agg(fn, a):
    if a.shape[1] == 0:
        return np.full(a.shape[0], np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        return fn(a, axis=1)


def week_calendar(week_starts):
    """Week of year and month for each week start."""
    ws = pd.DatetimeIndex(week_starts)
    woy = ws.isocalendar().week.to_numpy().astype(int)
    month = (ws + pd.Timedelta(days=3)).month.to_numpy()
    return woy, month


def features_at(Y, t, woy, month, S, static_names, PR=None):
    """Features for week t, built only from weeks before t. PR = optional weekly price matrix."""
    n = Y.shape[0]
    f = {}
    for k in LAGS:
        f[f"lag_{k}"] = Y[:, t - k] if t - k >= 0 else np.full(n, np.nan)
    for w in WINDOWS:
        f[f"rm_{w}"] = _nan_agg(np.nanmean, Y[:, max(0, t - w):t])
    f["rstd_8"] = _nan_agg(np.nanstd, Y[:, max(0, t - 8):t])
    f["age"] = np.sum(~np.isnan(Y[:, :t]), axis=1)
    f["woy"] = np.full(n, woy[t])
    f["month"] = np.full(n, month[t])
    if PR is not None:
        p4 = _nan_agg(np.nanmean, PR[:, max(0, t - 4):t])
        p_prev = _nan_agg(np.nanmean, PR[:, max(0, t - 13):max(0, t - 4)])
        f["price_4"] = p4
        f["price_chg"] = np.where(p_prev > 0, p4 / np.where(p_prev > 0, p_prev, 1) - 1, np.nan)
    for j, name in enumerate(static_names):
        f[name] = S[:, j]
    return pd.DataFrame(f)


def feature_names(static_names, price=False):
    return DYNAMIC_FEATURES + (PRICE_FEATURES if price else []) + list(static_names)


def extend_prices(PR, horizon):
    """Carry the last known price forward."""
    last = pd.DataFrame(PR).T.ffill().T.to_numpy()[:, -1]
    return np.concatenate([PR, np.repeat(last[:, None], horizon, axis=1)], axis=1)


def recent_price(Y, PR, window=8):
    """Average price over the last `window` weeks, or all history if there were no sales."""
    y, p = np.nan_to_num(Y), np.nan_to_num(PR)
    rev_w, u_w = (y[:, -window:] * p[:, -window:]).sum(1), y[:, -window:].sum(1)
    rev_a, u_a = (y * p).sum(1), y.sum(1)
    fallback = np.where(u_a > 0, rev_a / np.maximum(u_a, 1e-9), np.nan)
    return np.where(u_w > 0, rev_w / np.maximum(u_w, 1e-9), fallback)


def build_training_table(Y, woy, month, S, static_names, min_age=4, PR=None):
    """One row per series-week with a target and at least min_age weeks of history."""
    parts = []
    for t in range(1, Y.shape[1]):
        y = Y[:, t]
        X = features_at(Y, t, woy, month, S, static_names, PR)
        m = ~np.isnan(y) & (X["age"].to_numpy() >= min_age)
        if m.any():
            X = X[m].copy()
            X["_t"], X["_i"], X["_y"] = t, np.where(m)[0], y[m]
            parts.append(X)
    return pd.concat(parts, ignore_index=True)


def recursive_forecast(models, Y_hist, woy, month, S, static_names, horizon, PR_hist=None):
    """Forecast week by week, feeding each P50 back in as history. Returns P50, P10, P90."""
    n, T = Y_hist.shape
    cols = feature_names(static_names, price=PR_hist is not None)
    PRw = extend_prices(PR_hist, horizon) if PR_hist is not None else None
    Yw = np.concatenate([Y_hist, np.full((n, horizon), np.nan)], axis=1)
    P, L, U = (np.zeros((n, horizon)) for _ in range(3))
    for h in range(horizon):
        X = features_at(Yw, T + h, woy, month, S, static_names, PRw)[cols]
        p = np.clip(models["point"].predict(X), 0, None)
        lo = np.clip(models["q10"].predict(X), 0, None) if "q10" in models else p
        hi = np.clip(models["q90"].predict(X), 0, None) if "q90" in models else p
        P[:, h], L[:, h], U[:, h] = p, np.minimum(lo, p), np.maximum(hi, p)
        Yw[:, T + h] = p
    return P, L, U


def baseline_forecasts(Y_hist, horizon):
    """Last week, 4-week average and same week last year."""
    n, T = Y_hist.shape
    last = np.nan_to_num(Y_hist[:, -1])
    ma4 = np.nan_to_num(_nan_agg(np.nanmean, Y_hist[:, -4:]))
    snaive = np.zeros((n, horizon))
    for h in range(horizon):
        idx = T - 52 + h
        col = Y_hist[:, idx] if idx >= 0 else np.full(n, np.nan)
        snaive[:, h] = np.where(np.isnan(col), last, col)
    rep = lambda v: np.repeat(v[:, None], horizon, axis=1)
    return {"Naive (last week)": rep(last), "Moving avg (4 wk)": rep(ma4),
            "Seasonal naive (52 wk)": snaive}


def month_fraction_matrix(week_starts):
    """Share of each week's days that fall in each complete month."""
    ws = pd.DatetimeIndex(week_starts)
    days = pd.DatetimeIndex(np.concatenate([pd.date_range(w, periods=7) for w in ws]))
    months = days.to_period("M").unique()
    complete = [m for m in months
                if pd.Timestamp(m.start_time) >= ws[0]
                and pd.Timestamp(m.end_time).normalize() <= ws[-1] + pd.Timedelta(days=6)]
    F = np.zeros((len(ws), len(complete)))
    for i, w in enumerate(ws):
        for d in pd.date_range(w, periods=7):
            p = d.to_period("M")
            if p in complete:
                F[i, complete.index(p)] += 1 / 7
    return F, complete


def to_monthly(P, L, U, F):
    """Weekly forecasts to monthly P50 and an approximate P90 (independent weeks)."""
    sigma = (U - L) / IQR_TO_SIGMA
    p50 = P @ F
    p90 = p50 + Z90 * np.sqrt((sigma ** 2) @ (F ** 2))
    return p50, p90