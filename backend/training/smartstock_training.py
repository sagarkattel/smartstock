import matplotlib; matplotlib.use('Agg')

import os, sys, json, time, shutil, warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import joblib
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance

warnings.filterwarnings("ignore")
pd.set_option("display.max_columns", None)
pd.set_option("display.width", 160)
try:
    display
except NameError:          # plain python, no Jupyter
    display = print

try:
    import lightgbm as lgb  # only for the comparison in section 8
    HAS_LGBM = True
except ImportError:
    HAS_LGBM = False
print("LightGBM available:", HAS_LGBM)

IN_COLAB = "google.colab" in sys.modules
if IN_COLAB:
    from google.colab import drive
    drive.mount("/content/drive")
    BASE = "/content/drive/MyDrive/ai_practice"
else:
    BASE = os.environ.get("SMARTSTOCK_BASE", "./ai_practice")

DATA_DIR = os.path.join(BASE, "dataset")
OUT = os.path.join(BASE, "smartstock_v2")
DIRS = {k: os.path.join(OUT, k) for k in ["models", "forecasts", "evaluation", "figures", "docs", "cache"]}
for d in DIRS.values():
    os.makedirs(d, exist_ok=True)
CONFIG_DIR = os.path.join(OUT, "config")   # App 3 keyword rules
os.makedirs(CONFIG_DIR, exist_ok=True)
print("Data:", DATA_DIR, "\nOutputs:", OUT)

# Settings
import glob, re
# picks up every yearly sales export in the dataset folder
SALES_YEARS = sorted(int(re.search(r"(\d{4})", os.path.basename(p)).group(1))
                     for p in glob.glob(os.path.join(DATA_DIR, "CashlessSalesAnalysis-*.xlsx"))) or [2023, 2024, 2025, 2026]
# quick mode = backend "quick update": no grid search, reuse the last tuned params
QUICK = os.environ.get("SMARTSTOCK_QUICK", "0") == "1"
FIXED_PARAMS = json.loads(os.environ.get("SMARTSTOCK_FIXED_PARAMS", "{}") or "{}")
RANDOM_STATE = 42

ACTIVE_WEEKS = 8          # must have sold something in the last 8 weeks
MIN_HISTORY_WEEKS = 8
APP1_MIN_TXNS = 200
APP2_MIN_TXNS, APP2_MIN_DAYS = 30, 15   # min for a machine-product pair

BACKTEST_FOLDS = 4
HORIZON = 4               # weeks ahead per fold
TUNE = not QUICK
FORECAST_WEEKS = 26       # enough for 6 full months
FLAT_BUFFER = 0.20        # old +20% rule, for comparison

# methods picked in section 8 (better overall and in 3+ of 4 folds)
SEL = {"app1": "HGB Poisson + price", "app2a": "HGB Poisson", "app2b": "Combined: direct + top-down"}
NAMES = {"app1": "App 1 - Warehouse demand", "app2a": "App 2a - Machine totals", "app3": "App 3 - New-site product recommendations",
         "app2b": "App 2b - Product breakdown"}
TD_WEIGHT, SHARE_WINDOW = 0.5, 13   # App 2b blend weight, share window (weeks)

BASE_PARAMS = dict(learning_rate=0.05, max_iter=300, max_leaf_nodes=31,
                   min_samples_leaf=40, l2_regularization=1.0)
TUNE_GRID = [dict(learning_rate=lr, max_leaf_nodes=nl) for lr in (0.05, 0.1) for nl in (31, 63)]

# chart style
C_MODEL, C_BASE, C_ALT, C_GREY, C_INK = "#2a78d6", "#eb6834", "#1baf7a", "#a3a29d", "#52514e"
plt.rcParams.update({"axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": C_GREY, "axes.labelcolor": C_INK, "xtick.color": C_INK,
                     "ytick.color": C_INK, "axes.titleweight": "bold", "axes.grid": True,
                     "grid.color": "#e6e5e0", "grid.linewidth": 0.6, "figure.dpi": 110})

open('smartstock_core.py','w').write('"""SmartStock core: feature and forecast code used by both the notebook and the backend.\n\nY is a (series x weeks) array of weekly units. NaN = before the first sale, 0 = no sales that week.\n"""\nimport warnings\nimport numpy as np\nimport pandas as pd\n\nLAGS = (1, 2, 4, 52)\nWINDOWS = (4, 8, 13, 26)\nDYNAMIC_FEATURES = ([f"lag_{k}" for k in LAGS] + [f"rm_{w}" for w in WINDOWS]\n                    + ["rstd_8", "age", "woy", "month"])\nPRICE_FEATURES = ["price_4", "price_chg"]\nZ90 = 1.2816\nIQR_TO_SIGMA = 2 * Z90       # sigma ~ (P90 - P10) / 2.563\nSERVICE_Z = {0.5: 0.0, 0.6: 0.2533, 0.7: 0.5244, 0.8: 0.8416, 0.9: 1.2816, 0.95: 1.6449}\n\n\ndef qty_for_service_level(P, L, U, service_level=0.9):\n    """Stock needed to cover demand at a given service level (normal approx. from P10-P90)."""\n    z = SERVICE_Z.get(round(service_level, 2))\n    if z is None:\n        from statistics import NormalDist\n        z = NormalDist().inv_cdf(service_level)\n    sigma = (np.asarray(U) - np.asarray(L)) / IQR_TO_SIGMA\n    return np.ceil(np.asarray(P) + z * sigma).astype(int)\n\n\ndef product_shares(Y_prod, Y_total, window=13):\n    """Each product\'s share of its machine\'s total units over the last `window` weeks."""\n    p = np.nansum(Y_prod[:, -window:], axis=1)\n    t = np.nansum(Y_total[:, -window:], axis=1)\n    return np.where(t > 0, p / np.maximum(t, 1e-9), 0.0)\n\n\ndef combine_top_down(P, L, U, P_total, share, has_total=None, weight=0.5):\n    """Blend the direct forecast with share x machine total. The band moves with the point forecast."""\n    td = share[:, None] * P_total\n    if has_total is not None:\n        td = np.where(np.asarray(has_total)[:, None], td, P)\n    C = weight * P + (1 - weight) * td\n    shift = C - P\n    return C, np.clip(L + shift, 0, None), np.clip(U + shift, 0, None), td\n\n\n# priority (ABC-XYZ) and calibration\nPRIORITY_MAP = {"AX": "High", "AY": "High", "AZ": "High", "BX": "High",\n                "BY": "Medium", "BZ": "Medium", "CX": "Medium",\n                "CY": "Low", "CZ": "Low"}\n\n\ndef priority_table(Y_hist, price, groups=None, window=26):\n    """ABC on sales value, XYZ on the coefficient of variation (both over the last `window` weeks)."""\n    w = np.nan_to_num(Y_hist[:, -window:])\n    units = w.sum(axis=1)\n    value = units * np.asarray(price, dtype=float)\n    mean = w.mean(axis=1)\n    cv = np.where(mean > 0, w.std(axis=1) / np.maximum(mean, 1e-9), np.inf)\n    xyz = np.where(cv <= 0.5, "X", np.where(cv <= 1.0, "Y", "Z"))\n    abc = np.empty(len(value), dtype=object)\n    grp = np.zeros(len(value)) if groups is None else np.asarray(groups)\n    for g in pd.unique(grp):\n        ix = np.where(grp == g)[0]\n        order = ix[np.argsort(-value[ix], kind="stable")]\n        share_before = (np.cumsum(value[order]) - value[order]) / max(value[ix].sum(), 1e-9)\n        abc[order] = np.where(share_before < 0.80, "A", np.where(share_before < 0.95, "B", "C"))\n    cls = np.char.add(abc.astype(str), xyz.astype(str))\n    return pd.DataFrame({"ABC": abc, "XYZ": xyz, "Class": cls, "CV_26wk": np.round(cv, 3),\n                         "Value_26wk": np.round(value, 2), "Units_26wk": units,\n                         "Priority": [PRIORITY_MAP[c] for c in cls]})\n\n\ndef band_sigma(L, U, floor=0.5):\n    """Sigma from the P10-P90 band, with a floor so tiny bands still work."""\n    return np.maximum((np.asarray(U, float) - np.asarray(L, float)) / IQR_TO_SIGMA, floor)\n\n\ndef conformal_z(y, P, L, U, levels, grid=np.linspace(-4, 8, 1201)):\n    """Split conformal: find the z that actually gives each coverage level on held-out errors.\n    Levels >= 0.5 are safe-stock levels (round up), < 0.5 are minimums (round down)."""\n    y, P = np.asarray(y, float), np.asarray(P, float)\n    sig = band_sigma(L, U)\n    n = len(y)\n    out = {}\n    for lv in levels:\n        if lv >= 0.5:\n            target = min(1.0, np.ceil((n + 1) * lv) / n)\n            z = grid[-1]\n            for g in grid:\n                if (y <= np.ceil(np.maximum(P + g * sig, 0))).mean() >= target:\n                    z = g\n                    break\n        else:\n            target = min(1.0, np.ceil((n + 1) * (1 - lv)) / n)\n            z = grid[0]\n            for g in grid[::-1]:\n                if (y >= np.floor(np.maximum(P + g * sig, 0))).mean() >= target:\n                    z = g\n                    break\n        out[float(lv)] = float(z)\n    return out\n\n\ndef calibrated_qty(P, sigma, z, kind="safe"):\n    """P + z * sigma, rounded up for safe stock and down for the minimum."""\n    v = np.maximum(np.asarray(P, float) + np.asarray(z, float) * np.asarray(sigma, float), 0)\n    return (np.ceil(v) if kind == "safe" else np.floor(v)).astype(int)\n\n\ndef monthly_sigma(L, U, F):\n    """Monthly sigma from the weekly ones, assuming independent weeks."""\n    return np.sqrt((band_sigma(L, U) ** 2) @ (F ** 2))\n\n\n# App 3: site categories from location names\nimport re as _re\nOTHER_CAT, STAFF_CAT = "Other / unclassified", "Staff area"\n# starting keyword list (saved to config/site_category_keywords.csv); "*" = any ending\nDEFAULT_SITE_KEYWORDS = {\n    "Sports & fitness": "sport*, aquatic, athletic, archery, f45, fitness, gym, hockey, stadium",\n    "Transport & transit": "station, railcorp, transit, transdev, airport, airroad, air road, bus",\n    "Education": "tafe, college, universit*, institute, school, education, study group, uws, cq, mit, tutor*, tuturing, academy",\n    "Student accommodation": "unilodge, student accommodation",\n    "Construction site": "building site, construction",\n    "Automotive": "toyota, hyundai, motor*, hino, smash, crash, auto*",\n    "Healthcare & aged care": "nursing, aged care, bupa, anglicare, hospital, medical, health*",\n    "Hospitality & clubs": "hotel, inn, leagues, club, cafe, pub, racecourse, turf",\n    "Retail": "h & m, h&m, myer*, office works, officeworks, flower power, woolworths, kmart, coles, aldi",\n    "Car park & storage": "parking, kennards, storage, stirage",\n    "Culture & events": "museum, showground, exhib*, gallery, theatre, cinema",\n    "Office & corporate": ("pty, ltd, group, solutions, systems, company, finance, bank, csiro, b.o.m, nicta, csc, abbott, "\n                           "life, partners, equipment, operations centre, business, imagetec, valiant, displaywise, ventia, "\n                           "position, insurance, claims"),\n    "Industrial & logistics": "warehouse, distribution, logistics, express, freight, metal, industr*, factory, foods, moffat, lifts",\n    STAFF_CAT: "staff, lunch*, breakout, canteen, crib, tea room, tearoom, kitchen, office, shed, factory, warehouse, shift",\n}\n\n\ndef default_keyword_table():\n    rows = []\n    for cat, kws in DEFAULT_SITE_KEYWORDS.items():\n        for kw in [k.strip() for k in kws.split(",") if k.strip()]:\n            rows.append({"Category": cat, "Keyword": kw,\n                         "Applies_to": "placement notes" if cat == STAFF_CAT else "location name",\n                         "Active": "yes", "Note": ""})\n    return pd.DataFrame(rows)\n\n\ndef _kw_pattern(kw):\n    kw = kw.strip().lower()\n    stem, wild = (kw[:-1], True) if kw.endswith("*") else (kw, False)\n    body = r"\\s+".join(_re.escape(part) for part in stem.split())\n    return r"(?<![a-z0-9])" + body + (r"[a-z0-9]*" if wild else r"(?![a-z0-9])")\n\n\ndef compile_site_rules(table):\n    """Compile the keyword table into regex rules."""\n    t = table.copy()\n    t = t[t["Active"].astype(str).str.strip().str.lower().isin(["yes", "y", "true", "1"])]\n    rules = {"name": [], "notes": []}\n    for _, r in t.iterrows():\n        key = "notes" if "note" in str(r["Applies_to"]).lower() else "name"\n        rules[key].append((str(r["Category"]).strip(), str(r["Keyword"]).strip(), _re.compile(_kw_pattern(str(r["Keyword"])))))\n    cats = list(dict.fromkeys([c for c, _, _ in rules["name"]]))\n    rules["categories"] = cats + [OTHER_CAT, STAFF_CAT]\n    return rules\n\n\ndef staff_area_match(text, rules):\n    t = str(text).lower()\n    return any(rx.search(t) for _, _, rx in rules["notes"])\n\n\ndef site_categories(name, staff_share, rules, overrides=None):\n    """Returns (categories, matched keywords, source). Overrides win over keywords."""\n    n = str(name).strip().lower()\n    n = _re.sub(r"\\s+", " ", n)\n    ov = (overrides or {}).get(n)\n    if ov and ov.get("categories"):\n        cats, matched, source = list(ov["categories"]), [], "override"\n    else:\n        hits = [(c, kw) for c, kw, rx in rules["name"] if rx.search(n)]\n        cats = list(dict.fromkeys(c for c, _ in hits))\n        matched = [f"{c}: {kw}" for c, kw in hits]\n        source = "keyword" if cats else "none"\n        if not cats:\n            cats = [OTHER_CAT]\n    staff = ov.get("staff") if ov and ov.get("staff") is not None else (staff_share >= 0.5)\n    if staff and STAFF_CAT not in cats:\n        cats.append(STAFF_CAT)\n    return cats, matched, source\n\n\ndef load_overrides(table):\n    out = {}\n    for _, r in table.iterrows():\n        loc = _re.sub(r"\\s+", " ", str(r.get("Location", "")).strip().lower())\n        if not loc or loc == "nan":\n            continue\n        cats = [c.strip() for c in str(r.get("Categories", "")).split("|") if c.strip() and c.strip().lower() != "nan"]\n        st = str(r.get("Staff_area", "")).strip().lower()\n        out[loc] = {"categories": cats, "staff": True if st in ("yes", "y", "true", "1") else\n                    (False if st in ("no", "n", "false", "0") else None)}\n    return out\n\n\n# product type from the product name\nDRINK_RE = (r"\\d+\\s?ml\\b|\\d(?:\\.\\d+)?\\s?l(?:tr)?\\b|cola|coke|pepsi|water|juice|red ?bull|monster|gatorade|powerade|"\n            r"sprite|fanta|solo|lemonade|\\btea\\b|coffee|milk|\\bv\\b|mother|soda|drink|kombucha|aloe|mount franklin|nudie")\nNONFOOD_RE = r"laundry|detergent|softener|powder|wash|soap|razor|battery|charger|tissue|mask"\n\n\ndef product_type(names):\n    """Drink, snack/food or non-food, guessed from the name."""\n    lo = pd.Series(list(names), dtype=str).str.lower()\n    return np.select([lo.str.contains(NONFOOD_RE, regex=True), lo.str.contains(DRINK_RE, regex=True)],\n                     ["Other (non-food)", "Drink"], "Snack/food")\n\n\ndef scaled_seasonal_naive(Y_hist, horizon):\n    """Last year\'s weeks (smoothed), scaled by recent growth."""\n    n, T = Y_hist.shape\n    recent = np.nansum(Y_hist[:, T - 13:T], axis=1)\n    ly = np.nansum(Y_hist[:, max(0, T - 65):max(0, T - 52)], axis=1)\n    r = np.clip(np.where(ly > 0, recent / np.maximum(ly, 1e-9), 1.0), 0.3, 3.0)\n    ma = np.nan_to_num(_nan_agg(np.nanmean, Y_hist[:, T - 13:T]))\n    out = np.zeros((n, horizon))\n    for h in range(horizon):\n        a = T - 52 + h\n        v = _nan_agg(np.nanmean, Y_hist[:, max(0, a - 1):max(0, a + 2)]) if a + 2 > 0 else np.full(n, np.nan)\n        out[:, h] = np.where(np.isnan(v) | (ly <= 0), ma, r * v)\n    return out\n\n\ndef _nan_agg(fn, a):\n    if a.shape[1] == 0:\n        return np.full(a.shape[0], np.nan)\n    with warnings.catch_warnings():\n        warnings.simplefilter("ignore", category=RuntimeWarning)\n        return fn(a, axis=1)\n\n\ndef week_calendar(week_starts):\n    """Week of year and month for each week start."""\n    ws = pd.DatetimeIndex(week_starts)\n    woy = ws.isocalendar().week.to_numpy().astype(int)\n    month = (ws + pd.Timedelta(days=3)).month.to_numpy()\n    return woy, month\n\n\ndef features_at(Y, t, woy, month, S, static_names, PR=None):\n    """Features for week t, built only from weeks before t. PR = optional weekly price matrix."""\n    n = Y.shape[0]\n    f = {}\n    for k in LAGS:\n        f[f"lag_{k}"] = Y[:, t - k] if t - k >= 0 else np.full(n, np.nan)\n    for w in WINDOWS:\n        f[f"rm_{w}"] = _nan_agg(np.nanmean, Y[:, max(0, t - w):t])\n    f["rstd_8"] = _nan_agg(np.nanstd, Y[:, max(0, t - 8):t])\n    f["age"] = np.sum(~np.isnan(Y[:, :t]), axis=1)\n    f["woy"] = np.full(n, woy[t])\n    f["month"] = np.full(n, month[t])\n    if PR is not None:\n        p4 = _nan_agg(np.nanmean, PR[:, max(0, t - 4):t])\n        p_prev = _nan_agg(np.nanmean, PR[:, max(0, t - 13):max(0, t - 4)])\n        f["price_4"] = p4\n        f["price_chg"] = np.where(p_prev > 0, p4 / np.where(p_prev > 0, p_prev, 1) - 1, np.nan)\n    for j, name in enumerate(static_names):\n        f[name] = S[:, j]\n    return pd.DataFrame(f)\n\n\ndef feature_names(static_names, price=False):\n    return DYNAMIC_FEATURES + (PRICE_FEATURES if price else []) + list(static_names)\n\n\ndef extend_prices(PR, horizon):\n    """Carry the last known price forward."""\n    last = pd.DataFrame(PR).T.ffill().T.to_numpy()[:, -1]\n    return np.concatenate([PR, np.repeat(last[:, None], horizon, axis=1)], axis=1)\n\n\ndef recent_price(Y, PR, window=8):\n    """Average price over the last `window` weeks, or all history if there were no sales."""\n    y, p = np.nan_to_num(Y), np.nan_to_num(PR)\n    rev_w, u_w = (y[:, -window:] * p[:, -window:]).sum(1), y[:, -window:].sum(1)\n    rev_a, u_a = (y * p).sum(1), y.sum(1)\n    fallback = np.where(u_a > 0, rev_a / np.maximum(u_a, 1e-9), np.nan)\n    return np.where(u_w > 0, rev_w / np.maximum(u_w, 1e-9), fallback)\n\n\ndef build_training_table(Y, woy, month, S, static_names, min_age=4, PR=None):\n    """One row per series-week with a target and at least min_age weeks of history."""\n    parts = []\n    for t in range(1, Y.shape[1]):\n        y = Y[:, t]\n        X = features_at(Y, t, woy, month, S, static_names, PR)\n        m = ~np.isnan(y) & (X["age"].to_numpy() >= min_age)\n        if m.any():\n            X = X[m].copy()\n            X["_t"], X["_i"], X["_y"] = t, np.where(m)[0], y[m]\n            parts.append(X)\n    return pd.concat(parts, ignore_index=True)\n\n\ndef recursive_forecast(models, Y_hist, woy, month, S, static_names, horizon, PR_hist=None):\n    """Forecast week by week, feeding each P50 back in as history. Returns P50, P10, P90."""\n    n, T = Y_hist.shape\n    cols = feature_names(static_names, price=PR_hist is not None)\n    PRw = extend_prices(PR_hist, horizon) if PR_hist is not None else None\n    Yw = np.concatenate([Y_hist, np.full((n, horizon), np.nan)], axis=1)\n    P, L, U = (np.zeros((n, horizon)) for _ in range(3))\n    for h in range(horizon):\n        X = features_at(Yw, T + h, woy, month, S, static_names, PRw)[cols]\n        p = np.clip(models["point"].predict(X), 0, None)\n        lo = np.clip(models["q10"].predict(X), 0, None) if "q10" in models else p\n        hi = np.clip(models["q90"].predict(X), 0, None) if "q90" in models else p\n        P[:, h], L[:, h], U[:, h] = p, np.minimum(lo, p), np.maximum(hi, p)\n        Yw[:, T + h] = p\n    return P, L, U\n\n\ndef baseline_forecasts(Y_hist, horizon):\n    """Last week, 4-week average and same week last year."""\n    n, T = Y_hist.shape\n    last = np.nan_to_num(Y_hist[:, -1])\n    ma4 = np.nan_to_num(_nan_agg(np.nanmean, Y_hist[:, -4:]))\n    snaive = np.zeros((n, horizon))\n    for h in range(horizon):\n        idx = T - 52 + h\n        col = Y_hist[:, idx] if idx >= 0 else np.full(n, np.nan)\n        snaive[:, h] = np.where(np.isnan(col), last, col)\n    rep = lambda v: np.repeat(v[:, None], horizon, axis=1)\n    return {"Naive (last week)": rep(last), "Moving avg (4 wk)": rep(ma4),\n            "Seasonal naive (52 wk)": snaive}\n\n\ndef month_fraction_matrix(week_starts):\n    """Share of each week\'s days that fall in each complete month."""\n    ws = pd.DatetimeIndex(week_starts)\n    days = pd.DatetimeIndex(np.concatenate([pd.date_range(w, periods=7) for w in ws]))\n    months = days.to_period("M").unique()\n    complete = [m for m in months\n                if pd.Timestamp(m.start_time) >= ws[0]\n                and pd.Timestamp(m.end_time).normalize() <= ws[-1] + pd.Timedelta(days=6)]\n    F = np.zeros((len(ws), len(complete)))\n    for i, w in enumerate(ws):\n        for d in pd.date_range(w, periods=7):\n            p = d.to_period("M")\n            if p in complete:\n                F[i, complete.index(p)] += 1 / 7\n    return F, complete\n\n\ndef to_monthly(P, L, U, F):\n    """Weekly forecasts to monthly P50 and an approximate P90 (independent weeks)."""\n    sigma = (U - L) / IQR_TO_SIGMA\n    p50 = P @ F\n    p90 = p50 + Z90 * np.sqrt((sigma ** 2) @ (F ** 2))\n    return p50, p90')

import importlib, smartstock_core as core
importlib.reload(core)
shutil.copy("smartstock_core.py", os.path.join(OUT, "smartstock_core.py"))
print("Core module ready; features:", core.DYNAMIC_FEATURES)

# App 3 site-category rules
KW_CSV = os.path.join(CONFIG_DIR, "site_category_keywords.csv")
OV_CSV = os.path.join(CONFIG_DIR, "site_category_overrides.csv")
if not os.path.exists(KW_CSV):
    core.default_keyword_table().to_csv(KW_CSV, index=False)
    print("Created", KW_CSV)
if not os.path.exists(OV_CSV):
    pd.DataFrame(columns=["Location", "Categories", "Staff_area", "Note"]).to_csv(OV_CSV, index=False)
    print("Created", OV_CSV)
kw_table = pd.read_csv(KW_CSV, dtype=str).fillna("")
ov_table = pd.read_csv(OV_CSV, dtype=str).fillna("")
SITE_RULES = core.compile_site_rules(kw_table)
SITE_OVERRIDES = core.load_overrides(ov_table)
SITE_CATS = SITE_RULES["categories"]
print(f"Site-category rules: {len(SITE_RULES['name'])} location keywords, {len(SITE_RULES['notes'])} staff-area keywords, "
      f"{len(SITE_OVERRIDES)} overrides; categories: {len(SITE_CATS)}")

cache = os.path.join(DIRS["cache"], "sales_raw.pkl")
machines = pd.read_excel(os.path.join(DATA_DIR, "CashlessMachines.xlsx"), dtype={"Asset ID": str})
machines["Asset ID"] = machines["Asset ID"].astype(str).str.strip()

if os.path.exists(cache):
    sales_raw = pd.read_pickle(cache)
    print("Loaded cached sales")
else:
    frames = []
    for yr in SALES_YEARS:
        t0 = time.time()
        d = pd.read_excel(os.path.join(DATA_DIR, f"CashlessSalesAnalysis-{yr}.xlsx"),
                          sheet_name="Item", dtype={"Asset ID": str, "Coil": str})
        frames.append(d)
        print(f"{yr}: {len(d):,} rows ({time.time() - t0:.0f}s)")
    sales_raw = pd.concat(frames, ignore_index=True)
    sales_raw.to_pickle(cache)

print(f"Machine list: {machines.shape}; sales: {sales_raw.shape}")
print("Date range:", sales_raw["Sale Date Time"].min(), "->", sales_raw["Sale Date Time"].max())

audit = []   # rows for the datasheet
def log(check, value, action):
    audit.append({"Check": check, "Value": value, "Action": action})

df = sales_raw.copy()
raw_ids = set(df["Asset ID"].astype(str).str.strip())
log("Distinct Asset IDs: sales log / machine list / matched",
    f"{len(raw_ids)} / {machines['Asset ID'].nunique()} / {len(raw_ids & set(machines['Asset ID']))}",
    "Machine features derived from the sales log itself (progress report, S1)")

# Place holds door codes and phone numbers, so we drop it
place_vals = df["Place"].dropna().astype(str).drop_duplicates()
sensitive = place_vals.str.contains(r"code|\d{8}|\d{4}\s?\d{4}|\*\d+#|padlock|password|key\d", case=False, regex=True)
log("'Place' values with access codes / phone numbers", f"{sensitive.sum()} of {len(place_vals)} distinct values",
    "Column dropped at load: security-sensitive, not needed for forecasting; never shown in outputs or UI")
# keep only a yes/no staff-area flag for App 3 before dropping it
_site_key = df["Location"].astype(str).str.strip().str.lower().str.replace(r"\s+", " ", regex=True)
site_staff_share = (df["Place"].astype(str).map(lambda t: core.staff_area_match(t, SITE_RULES))
                    .groupby(_site_key).mean())
df = df.drop(columns=["Place"])

for c in ["Asset ID", "Location", "Type", "Coil", "Item"]:
    df[c] = df[c].astype(str).str.strip()
    df.loc[df[c].isin(["nan", "None", "", "<NA>"]), c] = np.nan
df.loc[df["Item"] == "Unknown Item", "Item"] = np.nan
n0 = len(df)
log("Raw transactions", f"{n0:,}", "-")

dups = df.duplicated().sum()
df = df.drop_duplicates()
log("Exact duplicate rows", f"{dups:,} ({dups / n0:.1%})",
    "Removed: likely resent transactions (confirm with client)")

unnamed = df["Item"].isna().mean()
log("Rows with no item name", f"{unnamed:.1%}",
    "Kept: used by App 2a machine-total model; excluded only from per-product models")

wh = df["Location"].fillna("").str.lower().str.contains("unassigned")
log("Test vends in warehouse ('Unassigned' location)", f"{wh.sum():,}",
    "Removed: machines in storage, not customer demand")
df = df[~wh]

df["Date"] = df["Sale Date Time"].dt.normalize()
df["WeekStart"] = df["Date"] - pd.to_timedelta(df["Date"].dt.dayofweek, unit="D")

# full Monday-Sunday weeks only
first_day, last_day = df["Date"].min(), df["Date"].max()
FIRST_WEEK = first_day if first_day.dayofweek == 0 else first_day + pd.Timedelta(days=7 - first_day.dayofweek)
LAST_WEEK = last_day - pd.Timedelta(days=last_day.dayofweek)
if (last_day - LAST_WEEK).days < 6:
    LAST_WEEK -= pd.Timedelta(days=7)
partial = (~df["WeekStart"].between(FIRST_WEEK, LAST_WEEK)).sum()
df = df[df["WeekStart"].between(FIRST_WEEK, LAST_WEEK)]
WEEKS = pd.date_range(FIRST_WEEK, LAST_WEEK, freq="7D")
FORECAST_START = LAST_WEEK + pd.Timedelta(days=7)
log("Rows in partial first/last weeks", f"{partial:,}",
    f"Removed: modelling window {FIRST_WEEK.date()} to {(LAST_WEEK + pd.Timedelta(days=6)).date()} ({len(WEEKS)} full weeks)")

def categorize(t):
    t = str(t).lower()
    if t in ("nan", "unknown"): return "Unknown"
    if "bev" in t or "drink" in t: return "Beverage"
    if "snack" in t: return "Snack"
    if "combo" in t: return "Combo"
    return "Other"
df["MachineCategory"] = df["Type"].map(categorize)

print(f"Clean rows: {len(df):,}")
print(f"Full weeks: {len(WEEKS)} ({FIRST_WEEK.date()} -> {LAST_WEEK.date()}); forecasts start {FORECAST_START.date()}")

# machines on the current list only; history restarts after a move
on_list = set(machines["Asset ID"])
ids_sales = df["Asset ID"].nunique()
log("Asset IDs in sales vs machine list", f"{ids_sales} vs {len(on_list)}",
    "Per-machine models use only machines on the current list")

dm = df[df["Asset ID"].isin(on_list)].sort_values("Sale Date Time").copy()
dm["_loc"] = dm["Location"].fillna("").str.lower().str.replace(r"[^a-z0-9]+", " ", regex=True).str.strip()
last_loc = dm.groupby("Asset ID")["_loc"].last()
is_last = dm["_loc"].to_numpy() == dm["Asset ID"].map(last_loc).to_numpy()
cut = dm[~is_last].groupby("Asset ID")["Sale Date Time"].max()
keep = dm["Sale Date Time"] > dm["Asset ID"].map(cut).fillna(pd.Timestamp("1900-01-01"))
moved = dm.loc[~keep, "Asset ID"].nunique()
log("Machines relocated during the period", f"{moved} machines, {(~keep).sum():,} rows",
    "Per-machine history restarts at the current location")
dm = dm[keep].drop(columns="_loc")

machine_cat = dm.groupby("Asset ID")["MachineCategory"].agg(lambda s: s.mode().iat[0])
machine_loc = dm.groupby("Asset ID")["Location"].last()

# confidence = share of the last 13 weeks with no item name
recent = dm[dm["WeekStart"] > LAST_WEEK - pd.Timedelta(weeks=13)]
unnamed_share = recent.groupby("Asset ID")["Item"].apply(lambda s: s.isna().mean())
confidence = pd.cut(unnamed_share, [-0.01, 0.2, 0.5, 1.0], labels=["High", "Medium", "Low"]).astype(str)
log("Machines with >50% unnamed sales (last 13 wks)", f"{(confidence == 'Low').sum()}",
    "Flagged 'Low' confidence; still forecast via App 2a")

# product category = machine type it mostly sells from
named = df.dropna(subset=["Item"])
item_cat = (named.assign(mc=named["Asset ID"].map(machine_cat).fillna(named["MachineCategory"]))
            .groupby("Item")["mc"].agg(lambda s: s.mode().iat[0]))

audit_df = pd.DataFrame(audit)
audit_df.to_csv(os.path.join(DIRS["evaluation"], "data_audit.csv"), index=False)
display(audit_df)

def build_matrix(weekly, key_cols):
    # long table -> series x weeks matrix
    pv = weekly.pivot_table(index=key_cols, columns="WeekStart", values="Units", aggfunc="sum")
    pv = pv.reindex(columns=WEEKS)
    Y = pv.to_numpy(dtype=float)
    started = np.cumsum(~np.isnan(Y), axis=1) > 0
    Y = np.where(started & np.isnan(Y), 0.0, Y)
    return Y, pv.index.to_frame(index=False)

def build_price_matrix(rows, key_cols, keys):
    # weekly average price, same layout as build_matrix
    pv = rows.groupby(key_cols + ["WeekStart"])["Cashless Price"].mean().unstack("WeekStart").reindex(columns=WEEKS)
    idx = pd.MultiIndex.from_frame(keys[key_cols]) if len(key_cols) > 1 else pd.Index(keys[key_cols[0]])
    return pv.reindex(idx).to_numpy(dtype=float)

def active_mask(Y):
    hist = np.sum(~np.isnan(Y), axis=1)
    recent = np.nansum(Y[:, -ACTIVE_WEEKS:], axis=1)
    return (hist >= MIN_HISTORY_WEEKS) & (recent > 0)

def encode_static(values, max_cats=250):
    # category codes; rare ones go to OTHER (HGB allows 255)
    vc = pd.Series(values).astype(str).value_counts()
    cats = list(vc.index[:max_cats - 1]) + (["OTHER"] if len(vc) >= max_cats else [])
    lookup = {c: i for i, c in enumerate(cats)}
    other = lookup.get("OTHER", -1)
    codes = np.array([lookup.get(str(v), other) for v in values])
    return codes, cats

def make_hgb(loss, params, n_static, quantile=None, n_dynamic=None):
    n_dynamic = len(core.DYNAMIC_FEATURES) if n_dynamic is None else n_dynamic
    cat_mask = [False] * n_dynamic + [True] * n_static
    kw = dict(BASE_PARAMS, **params)
    if loss == "quantile":
        kw["l2_regularization"] = 0.0   # L2 squashes quantile leaves to ~0
    return HistGradientBoostingRegressor(loss=loss, quantile=quantile, categorical_features=cat_mask,
                                         early_stopping=False, random_state=RANDOM_STATE, **kw)

def fit_quantile(X, y, q, n_static, params, n_dynamic=None, tol=0.03):
    # quantile HGB sometimes misses its target, so retry with a lower learning rate
    best, best_gap = None, np.inf
    lr0 = params.get("learning_rate", BASE_PARAMS["learning_rate"])
    for lr in (lr0, lr0 / 2, lr0 / 4):
        m = make_hgb("quantile", {**params, "learning_rate": lr}, n_static, q, n_dynamic=n_dynamic).fit(X, y)
        # coverage check that allows for whole-unit sales
        fl, yy = np.floor(np.clip(m.predict(X), 0, None)), np.asarray(y)
        gap = max(0.0, (yy < fl).mean() - q, q - (yy <= fl).mean())
        if gap < best_gap:
            best, best_gap = m, gap
        if gap <= tol:
            break
    if best_gap > tol:
        print(f"   warning: q{int(q * 100)} model in-sample coverage off by {best_gap:.1%}")
    return best

def fit_set(X, y, n_static, params, point_loss="poisson", quantiles=True, n_dynamic=None):
    m = {"point": make_hgb(point_loss, params, n_static, n_dynamic=n_dynamic).fit(X, y)}
    if quantiles:
        m["q10"] = fit_quantile(X, y, 0.1, n_static, params, n_dynamic)
        m["q90"] = fit_quantile(X, y, 0.9, n_static, params, n_dynamic)
    return m

class LGBMWrap:
    # LightGBM version, comparison only
    def __init__(self, static_names):
        self.static = list(static_names)
        self.m = lgb.LGBMRegressor(objective="poisson", n_estimators=300, learning_rate=0.05,
                                   num_leaves=31, min_child_samples=40, verbose=-1,
                                   random_state=RANDOM_STATE)
    def _prep(self, X):
        X = X.copy()
        for c in self.static: X[c] = X[c].astype("category")
        return X
    def fit(self, X, y):
        self.m.fit(self._prep(X), y); return self
    def predict(self, X):
        return self.m.predict(self._prep(X))

def wape(y, f): return np.abs(y - f).sum() / max(y.sum(), 1e-9)

def score(df_):
    # df_: y, f and scale (naive MAE per series)
    e = df_["f"] - df_["y"]
    per = df_.assign(ae=e.abs()).groupby(["fold", "_i"]).agg(ae=("ae", "mean"), sc=("scale", "first"))
    per = per[per["sc"] > 0]
    return pd.Series({"MAE": e.abs().mean(), "RMSE": np.sqrt((e ** 2).mean()),
                      "WAPE": wape(df_["y"].to_numpy(), df_["f"].to_numpy()),
                      "MASE": (per["ae"] / per["sc"]).mean(),
                      "Bias": e.sum() / max(df_["y"].sum(), 1e-9)})

def run_level(name, Y, keys, static_df, label_cols, top_down=None, PR=None, extra=None):
    # top_down is only used for App 2b (links each row to its App 2a machine)
    t_all = time.time()
    static_names = list(static_df.columns)
    enc = {c: encode_static(static_df[c].to_numpy()) for c in static_names}
    S = np.column_stack([enc[c][0] for c in static_names])
    cols = core.feature_names(static_names)
    T = Y.shape[1]
    ext_weeks = pd.date_range(WEEKS[0], periods=T + FORECAST_WEEKS, freq="7D")
    woy, month = core.week_calendar(ext_weeks)

    table = core.build_training_table(Y, woy, month, S, static_names)
    print(f"[{name}] series={Y.shape[0]:,}, weeks={T}, training rows={len(table):,}")
    if PR is not None:   # price features
        table_p = core.build_training_table(Y, woy, month, S, static_names, PR=PR)
        cols_p = core.feature_names(static_names, price=True)
        n_dyn_p = len(core.DYNAMIC_FEATURES) + len(core.PRICE_FEATURES)
    # main model uses price only if it won in the backtest
    use_price = PR is not None and SEL[name].endswith("+ price")
    tab_m, cols_m = (table_p, cols_p) if use_price else (table, cols)
    ndyn_m = n_dyn_p if use_price else None
    PR_m = PR if use_price else None
    main_label = "HGB Poisson + price" if use_price else "HGB Poisson"
    def fc_main(origin, models, horizon=HORIZON):
        return core.recursive_forecast(models, Y[:, :origin], woy, month, S, static_names, horizon,
                                       PR_hist=None if PR_m is None else PR_m[:, :origin])

    eval_origins = [T - HORIZON * k for k in range(BACKTEST_FOLDS, 0, -1)]
    tune_origins = [eval_origins[0] - HORIZON * k for k in (2, 1)]

    def fold_forecast(origin, models):
        P, L, U = core.recursive_forecast(models, Y[:, :origin], woy, month, S, static_names, HORIZON)
        return P, L, U

    def eval_rows(origin):
        act = Y[:, origin:origin + HORIZON]
        hist = np.sum(~np.isnan(Y[:, :origin]), axis=1)
        ok = (hist >= MIN_HISTORY_WEEKS) & ~np.isnan(act).any(axis=1)
        scale = core._nan_agg(np.nanmean, np.abs(np.diff(Y[:, :origin], axis=1)))
        return act, ok, scale

    # tuning, on origins before the test folds
    params = {}
    tune_rows = []
    if TUNE:
        for g in TUNE_GRID:
            ws = []
            for origin in tune_origins:
                tr = table[table["_t"] < origin]
                m = {"point": make_hgb("poisson", g, len(static_names)).fit(tr[cols], tr["_y"])}
                P, _, _ = fold_forecast(origin, m)
                act, ok, _ = eval_rows(origin)
                ws.append(wape(act[ok], P[ok]))
            tune_rows.append({**g, "WAPE": np.mean(ws)})
        tune_df = pd.DataFrame(tune_rows).sort_values("WAPE")
        params = {"learning_rate": float(tune_df.iloc[0]["learning_rate"]),
                  "max_leaf_nodes": int(tune_df.iloc[0]["max_leaf_nodes"])}
        print(f"[{name}] tuned params: {params}")
    else:
        tune_df = pd.DataFrame()
        params = {k: v for k, v in FIXED_PARAMS.get(name, {}).items() if k in ("learning_rate", "max_leaf_nodes")}
        print(f"[{name}] tuning skipped; params: {params or 'defaults'}")

    # rolling-origin backtest
    recs = []
    fold_models = None
    fold_P = {}
    for fi, origin in enumerate(eval_origins):
        tr = table[table["_t"] < origin]
        Xtr, ytr = tr[cols], tr["_y"]
        act, ok, scale = eval_rows(origin)
        idx = np.where(ok)[0]
        variants = {}
        trm = tab_m[tab_m["_t"] < origin]
        best = fit_set(trm[cols_m], trm["_y"], len(static_names), params, "poisson", quantiles=True, n_dynamic=ndyn_m)
        P0, L0, U0 = fc_main(origin, best)
        variants[main_label] = (P0, L0, U0)
        if use_price:   # keep the no-price model to compare against
            variants["HGB Poisson"] = fold_forecast(
                origin, {"point": make_hgb("poisson", params, len(static_names)).fit(Xtr, ytr)})
        P_ref = variants["HGB Poisson"][0]
        fold_P[origin] = P0
        ma4 = core.baseline_forecasts(Y[:, :origin], HORIZON)["Moving avg (4 wk)"]
        E = 0.5 * (P_ref + ma4)
        variants["Ensemble HGB + MA4"] = (E, E, E)
        if top_down is not None:
            share = core.product_shares(Y[:, :origin], top_down["Y_tot"][:, :origin], SHARE_WINDOW)
            Ptot = top_down["fold_P"][origin][top_down["idx"]]
            C, Lc, Uc, TD = core.combine_top_down(P0, L0, U0, Ptot, share, top_down["has"], TD_WEIGHT)
            variants["Combined: direct + top-down"] = (C, Lc, Uc)
            variants["Top-down only"] = (TD, TD, TD)
        if PR is not None and not use_price:
            trp = table_p[table_p["_t"] < origin]
            mp = {"point": make_hgb("poisson", params, len(static_names), n_dynamic=n_dyn_p).fit(trp[cols_p], trp["_y"])}
            Pp, _, _ = core.recursive_forecast(mp, Y[:, :origin], woy, month, S, static_names, HORIZON,
                                               PR_hist=PR[:, :origin])
            variants["HGB Poisson + price"] = (Pp, Pp, Pp)
        variants["HGB Squared error"] = fold_forecast(
            origin, {"point": make_hgb("squared_error", params, len(static_names)).fit(Xtr, ytr)})
        if HAS_LGBM and not QUICK:
            try:
                variants["LightGBM Poisson"] = fold_forecast(origin, {"point": LGBMWrap(static_names).fit(Xtr, ytr)})
            except Exception as exc:   # don't let a comparison stop the run
                print(f"[{name}] LightGBM skipped: {exc}")
        for bname, B in core.baseline_forecasts(Y[:, :origin], HORIZON).items():
            variants[bname] = (B, B, B)
        for mname, (P, L, U) in variants.items():
            for h in range(HORIZON):
                recs.append(pd.DataFrame({"fold": fi + 1, "origin": WEEKS[origin], "model": mname,
                                          "h": h + 1, "_i": idx, "y": act[idx, h], "f": P[idx, h],
                                          "lo": L[idx, h], "hi": U[idx, h], "scale": scale[idx]}))
        if fi == len(eval_origins) - 1:
            fold_models, last_origin = best, origin
        print(f"[{name}] fold {fi + 1}/{len(eval_origins)} origin {WEEKS[origin].date()} done")
    bt = pd.concat(recs, ignore_index=True)

    # does the recursive forecast hold up over 26 weeks?
    lh = []
    for origin in [T - 52, T - 39, T - 26]:
        tr = tab_m[tab_m["_t"] < origin]
        m = {"point": make_hgb("poisson", params, len(static_names), n_dynamic=ndyn_m).fit(tr[cols_m], tr["_y"])}
        P26, _, _ = fc_main(origin, m, 26)
        act = Y[:, origin:origin + 26]
        ok = ~np.isnan(act).any(axis=1) & (np.sum(~np.isnan(Y[:, :origin]), axis=1) >= MIN_HISTORY_WEEKS)
        cands = {"HGB recursive (selected)": P26,
                 "Moving avg (4 wk)": core.baseline_forecasts(Y[:, :origin], 26)["Moving avg (4 wk)"],
                 "Scaled seasonal naive": core.scaled_seasonal_naive(Y[:, :origin], 26)}
        for nm, Fc in cands.items():
            a, f = act[ok], Fc[ok]
            lh.append({"origin": str(WEEKS[origin].date()), "method": nm, "series": int(ok.sum()),
                       "WAPE wk 1-4": wape(a[:, :4], f[:, :4]), "WAPE wk 5-26": wape(a[:, 4:], f[:, 4:]),
                       "Total-demand error wk 5-26": abs(a[:, 4:].sum() - f[:, 4:].sum()) / a[:, 4:].sum()})
    long_h = pd.DataFrame(lh)

    # permutation importance on the last fold
    te = tab_m[(tab_m["_t"] >= last_origin) & (tab_m["_t"] < last_origin + HORIZON)]
    te = te.sample(min(5000, len(te)), random_state=RANDOM_STATE)
    pi = permutation_importance(fold_models["point"], te[cols_m], te["_y"], n_repeats=5,
                                random_state=RANDOM_STATE, scoring="neg_mean_absolute_error")
    importance = pd.Series(pi.importances_mean, index=cols_m).sort_values(ascending=False)

    # refit on everything and forecast 26 weeks
    final = fit_set(tab_m[cols_m], tab_m["_y"], len(static_names), params, "poisson", quantiles=True, n_dynamic=ndyn_m)
    P, L, U = core.recursive_forecast(final, Y, woy, month, S, static_names, FORECAST_WEEKS, PR_hist=PR_m)
    combination = None
    if top_down is not None:
        share = core.product_shares(Y, top_down["Y_tot"], SHARE_WINDOW)
        P, L, U, _ = core.combine_top_down(P, L, U, top_down["P"][top_down["idx"]], share,
                                           top_down["has"], TD_WEIGHT)
        combination = {"method": "weight * direct + (1 - weight) * share * app2a_total",
                       "weight": TD_WEIGHT, "share_window_weeks": SHARE_WINDOW, "total_model": "app2a",
                       "join_key": "Asset ID"}

    price_recent = core.recent_price(Y, PR) if PR is not None else None
    bundle = {"name": name, "models": final, "static_names": static_names, "price_recent": price_recent,
              "static_categories": {c: enc[c][1] for c in static_names},
              "keys": keys, "label_cols": label_cols, "Y": Y, "weeks": WEEKS,
              "feature_names": cols_m, "uses_price": bool(use_price), "price_matrix": PR_m,
              "params": {**BASE_PARAMS, **params}, "combination": combination,
              "trained_until": str((LAST_WEEK + pd.Timedelta(days=6)).date()),
              "forecast_start": str(FORECAST_START.date()),
              "S": S, "static_values": static_df.reset_index(drop=True),
              "reference_forecast": {"P": P, "L": L, "U": U, "weeks": FORECAST_WEEKS},
              "sklearn_version": __import__("sklearn").__version__, **(extra or {})}
    joblib.dump(bundle, os.path.join(DIRS["models"], f"{name}_bundle.joblib"), compress=3)

    # history in long form for the backend
    hist_long = keys.loc[np.repeat(np.arange(len(keys)), len(WEEKS))].reset_index(drop=True)
    hist_long["WeekStart"] = np.tile(WEEKS, len(keys))
    hist_long["Units"] = Y.ravel()
    hist_long.dropna(subset=["Units"]).to_csv(os.path.join(DIRS["models"], f"{name}_history.csv.gz"),
                                              index=False, compression="gzip")
    print(f"[{name}] finished in {time.time() - t_all:.0f}s")
    return {"bt": bt, "fold_P": fold_P, "long_h": long_h, "price": price_recent, "importance": importance, "tune": tune_df, "P": P, "L": L, "U": U,
            "keys": keys, "Y": Y, "params": params, "n_train_rows": len(table)}

def summarise(name, res):
    bt = res["bt"]
    summ = bt.groupby("model").apply(score).sort_values("WAPE")
    sel = bt[bt["model"] == SEL[name]]
    best_base = summ.loc[[m for m in summ.index if m in core.baseline_forecasts(np.zeros((1, 60)), 1)], "MAE"].idxmin()
    base_mae = summ.loc[best_base, "MAE"]
    sel_mae = summ.loc[SEL[name], "MAE"]
    cov80 = ((sel["y"] >= sel["lo"]) & (sel["y"] <= sel["hi"])).mean()
    cov90 = (sel["y"] <= sel["hi"]).mean()
    by_fold = bt.groupby(["model", "fold"]).apply(lambda d: wape(d["y"].to_numpy(), d["f"].to_numpy())).unstack()
    by_fold.to_csv(os.path.join(DIRS["evaluation"], f"{name}_wape_by_fold.csv"))
    by_h = bt.groupby(["model", "h"]).apply(lambda d: wape(d["y"].to_numpy(), d["f"].to_numpy())).unstack()
    print(f"\n===== {NAMES[name]}: backtest ({BACKTEST_FOLDS} folds x {HORIZON} weeks, recursive) =====")
    display(summ.round(3))
    print(f"Selected method: {SEL[name]}")
    print(f"MAE improvement vs best baseline ({best_base}): {(base_mae - sel_mae) / base_mae:.1%}")
    print(f"P10-P90 interval coverage: {cov80:.1%} (target 80%) | share of actuals <= P90: {cov90:.1%} (target 90%)")
    rk = res["importance"].rank(ascending=False).astype(int)
    print(f"Permutation importance: top = {', '.join(res['importance'].index[:4])}; "
          f"week-of-year ranks {rk['woy']}/{len(rk)}, month ranks {rk['month']}/{len(rk)} "
          "(recent-sales features already carry most seasonal signal)")
    summ.to_csv(os.path.join(DIRS["evaluation"], f"{name}_backtest_summary.csv"))
    by_h.to_csv(os.path.join(DIRS["evaluation"], f"{name}_wape_by_horizon.csv"))
    res["importance"].to_csv(os.path.join(DIRS["evaluation"], f"{name}_permutation_importance.csv"))
    lh = res["long_h"]
    lh.to_csv(os.path.join(DIRS["evaluation"], f"{name}_long_horizon_check.csv"), index=False)
    print("26-week stability check (point forecasts, 3 origins):")
    display(lh.pivot(index="method", columns="origin", values="WAPE wk 5-26").round(3))
    if len(res["tune"]): res["tune"].to_csv(os.path.join(DIRS["evaluation"], f"{name}_tuning.csv"), index=False)
    return {"summary": summ, "best_baseline": best_base, "selected": SEL[name], "by_fold": by_fold,
            "mae_improvement": float((base_mae - sel_mae) / base_mae),
            "coverage_p10_p90": float(cov80), "coverage_p90": float(cov90), "by_h": by_h}

def policy_eval(name, res):
    # stockouts and excess if we stocked to each rule
    bt = res["bt"]
    sel = bt[bt["model"] == SEL[name]]
    naive = bt[bt["model"] == "Naive (last week)"]
    rules = {"P90 (SmartStock v2)": np.ceil(sel["hi"].to_numpy()),
             "Forecast +20% (v1)": np.ceil(sel["f"].to_numpy() * (1 + FLAT_BUFFER)),
             "Last week's sales (manual habit)": np.ceil(naive["f"].to_numpy())}
    y = sel["y"].to_numpy()
    rows = []
    for r, q in rules.items():
        rows.append({"Rule": r, "Stockout rate (demand > stock)": (y > q).mean(),
                     "Avg units short": np.maximum(y - q, 0).mean(),
                     "Avg excess units": np.maximum(q - y, 0).mean(), "Total stock / demand": q.sum() / y.sum()})
    out = pd.DataFrame(rows).set_index("Rule")
    out.to_csv(os.path.join(DIRS["evaluation"], f"{name}_policy_simulation.csv"))
    print(f"\n{name}: stocking-policy simulation on backtest weeks")
    display(out.round(3))
    # service-level trade-off
    trade = []
    for sl in core.SERVICE_Z:
        q = core.qty_for_service_level(sel["f"], sel["lo"], sel["hi"], sl)
        trade.append({"Service level": sl, "Stockout rate": (y > q).mean(), "Stock / demand": q.sum() / y.sum()})
    tradeoffs[name] = pd.DataFrame(trade)
    tradeoffs[name].to_csv(os.path.join(DIRS["evaluation"], f"{name}_service_level_tradeoff.csv"), index=False)
    return out

tradeoffs = {}

def segment_eval(name, res, seg):
    # seg = segment label for each series
    sel = res["bt"][res["bt"]["model"] == SEL[name]].copy()
    sel["segment"] = np.asarray(seg)[sel["_i"]]
    out = sel.groupby("segment").apply(lambda d: pd.Series({
        "series": d["_i"].nunique(), "WAPE": wape(d["y"].to_numpy(), d["f"].to_numpy()),
        "MAE": (d["y"] - d["f"]).abs().mean(),
        "Bias": (d["f"] - d["y"]).sum() / max(d["y"].sum(), 1e-9),
        "P90 coverage": (d["y"] <= d["hi"]).mean()}))
    return out

def volume_band(Y):
    m = core._nan_agg(np.nanmean, Y[:, -26:])
    return pd.qcut(pd.Series(m).rank(method="first"), 3, labels=["Low volume", "Mid volume", "High volume"]).astype(str).to_numpy()

def plot_level(name, res, ev, title_key):
    bt, summ = res["bt"], ev["summary"]
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.2))
    # (a) WAPE by model
    s = summ["WAPE"].sort_values()
    baselines = set(core.baseline_forecasts(np.zeros((1, 60)), 1))
    colors = [C_MODEL if m == SEL[name] else (C_BASE if m in baselines else C_ALT) for m in s.index]
    axes[0].barh([f"{m} (selected)" if m == SEL[name] else m for m in s.index], s.values, color=colors, height=0.6)
    for i, v in enumerate(s.values): axes[0].text(v, i, f" {v:.1%}", va="center", color=C_INK, fontsize=9)
    axes[0].invert_yaxis(); axes[0].set_xlabel("WAPE (lower is better)")
    axes[0].set_title(f"{title_key}: backtest error by model"); axes[0].grid(axis="y", visible=False)
    # (b) WAPE by horizon
    for m, c in [(SEL[name], C_MODEL), (ev["best_baseline"], C_BASE)]:
        axes[1].plot(ev["by_h"].columns, ev["by_h"].loc[m], marker="o", color=c, lw=2, label=m)
    axes[1].set_xticks(range(1, HORIZON + 1)); axes[1].set_xlabel("Weeks ahead"); axes[1].set_ylabel("WAPE")
    axes[1].set_title("Error grows with horizon"); axes[1].legend(frameon=False, fontsize=8)
    # (c) importance
    imp = res["importance"].head(10)[::-1]
    axes[2].barh(imp.index, imp.values, color=C_MODEL, height=0.6)
    axes[2].set_title("Permutation importance (top 10)"); axes[2].set_xlabel("MAE increase when shuffled")
    axes[2].grid(axis="y", visible=False)
    plt.tight_layout()
    fig.savefig(os.path.join(DIRS["figures"], f"{name}_evaluation.png"), bbox_inches="tight")
    plt.show()

def plot_example(name, res, i, label):
    Y, P, L, U = res["Y"], res["P"], res["L"], res["U"]
    hist_w = WEEKS[-52:]
    fut_w = pd.date_range(FORECAST_START, periods=FORECAST_WEEKS, freq="7D")
    fig, ax = plt.subplots(figsize=(12, 3.8))
    ax.plot(hist_w, Y[i, -52:], color=C_INK, lw=1.5, label="Actual (last 52 weeks)")
    ax.fill_between(fut_w, L[i], U[i], color=C_MODEL, alpha=0.18, lw=0, label="P10-P90 range")
    ax.plot(fut_w, P[i], color=C_MODEL, lw=2, label="Forecast (P50)")
    ax.plot(fut_w, np.ceil(U[i]), color=C_MODEL, lw=1, ls="--", label="Suggested qty (P90)")
    ax.axvline(FORECAST_START, color=C_GREY, lw=1)
    ax.set_title(f"{label}: weekly units, history and 26-week forecast"); ax.set_ylabel("Units / week")
    ax.legend(frameon=False, ncol=4, fontsize=8, loc="upper left")
    plt.tight_layout()
    fig.savefig(os.path.join(DIRS["figures"], f"{name}_example_forecast.png"), bbox_inches="tight")
    plt.show()

named_rows = df.dropna(subset=["Item"])
cnt = named_rows.groupby("Item").size()
items_ok = cnt[cnt >= APP1_MIN_TXNS].index
w1 = (named_rows[named_rows["Item"].isin(items_ok)]
      .groupby(["Item", "WeekStart"]).size().rename("Units").reset_index())
Y1, keys1 = build_matrix(w1, ["Item"])
m1 = active_mask(Y1)
Y1, keys1 = Y1[m1], keys1[m1].reset_index(drop=True)
print(f"App1 products: {len(keys1)} active (of {len(items_ok)} with >= {APP1_MIN_TXNS} transactions)")
static1 = pd.DataFrame({"item": keys1["Item"], "item_cat": keys1["Item"].map(item_cat).fillna("Unknown")})
PR1 = build_price_matrix(named_rows[named_rows["Item"].isin(items_ok)], ["Item"], keys1)
res1 = run_level("app1", Y1, keys1, static1, ["Item"], PR=PR1)
ev1 = summarise("app1", res1)
pol1 = policy_eval("app1", res1)
seg1 = segment_eval("app1", res1, volume_band(Y1)); display(seg1.round(3))
seg1.to_csv(os.path.join(DIRS["evaluation"], "app1_segments.csv"))
plot_level("app1", res1, ev1, NAMES["app1"])
top1 = int(np.nanargmax(np.nansum(Y1[:, -8:], axis=1)))
plot_example("app1", res1, top1, keys1.loc[top1, "Item"])

w2a = dm.groupby(["Asset ID", "WeekStart"]).size().rename("Units").reset_index()
Y2a, keys2a = build_matrix(w2a, ["Asset ID"])
m2a = active_mask(Y2a)
Y2a, keys2a = Y2a[m2a], keys2a[m2a].reset_index(drop=True)
print(f"App2a machines: {len(keys2a)} active (all transactions, incl. unnamed items)")
static2a = pd.DataFrame({"asset": keys2a["Asset ID"], "mcat": keys2a["Asset ID"].map(machine_cat).fillna("Unknown")})
PR2a = build_price_matrix(dm, ["Asset ID"], keys2a)   # includes unnamed items
conf_all = keys2a["Asset ID"].map(confidence).fillna("Low")
res2a = run_level("app2a", Y2a, keys2a, static2a, ["Asset ID"], PR=PR2a,
                  extra={"location": keys2a["Asset ID"].map(machine_loc).fillna("").tolist(),
                         "confidence": conf_all.tolist()})
ev2a = summarise("app2a", res2a)
pol2a = policy_eval("app2a", res2a)
conf2a = keys2a["Asset ID"].map(confidence).fillna("Low").to_numpy()
seg2a = pd.concat({"Volume": segment_eval("app2a", res2a, volume_band(Y2a)),
                  "Confidence": segment_eval("app2a", res2a, conf2a),
                  "Machine type": segment_eval("app2a", res2a, static2a["mcat"].to_numpy())})
display(seg2a.round(3)); seg2a.to_csv(os.path.join(DIRS["evaluation"], "app2a_segments.csv"))
plot_level("app2a", res2a, ev2a, NAMES["app2a"])
top2a = int(np.nanargmax(np.nansum(Y2a[:, -8:], axis=1)))
plot_example("app2a", res2a, top2a, f"Machine {keys2a.loc[top2a, 'Asset ID']} (all products)")

nd = dm.dropna(subset=["Item"])
cs = nd.groupby(["Asset ID", "Item"]).agg(n=("Item", "size"), days=("Date", "nunique"))
pairs = cs[(cs["n"] >= APP2_MIN_TXNS) & (cs["days"] >= APP2_MIN_DAYS)].index
w2b = (nd.set_index(["Asset ID", "Item"]).loc[lambda x: x.index.isin(pairs)].reset_index()
      .groupby(["Asset ID", "Item", "WeekStart"]).size().rename("Units").reset_index())
Y2b, keys2b = build_matrix(w2b, ["Asset ID", "Item"])
m2b = active_mask(Y2b)
Y2b, keys2b = Y2b[m2b], keys2b[m2b].reset_index(drop=True)
print(f"App2b pairs: {len(keys2b):,} active (of {len(pairs):,}); machines: {keys2b['Asset ID'].nunique()}")
static2b = pd.DataFrame({"asset": keys2b["Asset ID"], "item": keys2b["Item"],
                        "mcat": keys2b["Asset ID"].map(machine_cat).fillna("Unknown"),
                        "item_cat": keys2b["Item"].map(item_cat).fillna("Unknown")})
amap = pd.Series(np.arange(len(keys2a)), index=keys2a["Asset ID"])
tot_idx = keys2b["Asset ID"].map(amap)
has_tot = tot_idx.notna().to_numpy()
tot_idx = tot_idx.fillna(0).astype(int).to_numpy()
print(f"Pairs whose machine has an App 2a total: {has_tot.mean():.1%}")
top_down = {"idx": tot_idx, "has": has_tot, "Y_tot": Y2a[tot_idx], "fold_P": res2a["fold_P"], "P": res2a["P"]}
PR2b = build_price_matrix(nd, ["Asset ID", "Item"], keys2b)
res2b = run_level("app2b", Y2b, keys2b, static2b, ["Asset ID", "Item"], top_down=top_down, PR=PR2b)
ev2b = summarise("app2b", res2b)
pol2b = policy_eval("app2b", res2b)
seg2b = pd.concat({"Volume": segment_eval("app2b", res2b, volume_band(Y2b)),
                  "Machine type": segment_eval("app2b", res2b, static2b["mcat"].to_numpy())})
display(seg2b.round(3)); seg2b.to_csv(os.path.join(DIRS["evaluation"], "app2b_segments.csv"))
plot_level("app2b", res2b, ev2b, NAMES["app2b"])
top2b = int(np.nanargmax(np.nansum(Y2b[:, -8:], axis=1)))
plot_example("app2b", res2b, top2b, f"Machine {keys2b.loc[top2b, 'Asset ID']} - {keys2b.loc[top2b, 'Item']}")

rows = []
for nm, ev in [("app1", ev1), ("app2a", ev2a), ("app2b", ev2b)]:
    fw, sm = ev["by_fold"], ev["summary"]
    for alt in [m for m in fw.index if m not in core.baseline_forecasts(np.zeros((1, 60)), 1) and m != "HGB Poisson"]:
        wins = int((fw.loc[alt] < fw.loc["HGB Poisson"]).sum())
        better = sm.loc[alt, "WAPE"] < sm.loc["HGB Poisson", "WAPE"]
        rows.append({"app": nm, "alternative": alt, "WAPE alternative": sm.loc[alt, "WAPE"],
                     "WAPE HGB Poisson": sm.loc["HGB Poisson", "WAPE"], "folds better": f"{wins}/{fw.shape[1]}",
                     "rule says adopt": bool(better and wins >= 3), "adopted": SEL[nm] == alt})
comp = pd.DataFrame(rows)
comp.to_csv(os.path.join(DIRS["evaluation"], "approach_comparison.csv"), index=False)
display(comp.round(4))
for nm in SEL:
    sub = comp[comp["app"] == nm]
    rule_pick = sub.loc[sub["rule says adopt"]].sort_values("WAPE alternative")["alternative"].tolist()
    expected = rule_pick[0] if rule_pick else "HGB Poisson"
    flag = "OK" if expected == SEL[nm] else f"CHECK: rule now prefers '{expected}' - update SEL and re-run"
    print(f"{nm}: selected = {SEL[nm]} -> {flag}")
display(ev2b["by_fold"].loc[["HGB Poisson", "Combined: direct + top-down", "Top-down only"]].round(3))

fig, ax = plt.subplots(figsize=(8, 4.5))
for (nm, d), c in zip(tradeoffs.items(), [C_MODEL, C_BASE, C_ALT]):
    ax.plot(d["Stock / demand"], d["Stockout rate"], marker="o", lw=2, color=c, label=NAMES[nm])
    for _, r in d.iterrows():
        if r["Service level"] in (0.5, 0.8, 0.95):
            ax.annotate(f"{r['Service level']:.0%}", (r["Stock / demand"], r["Stockout rate"]),
                        textcoords="offset points", xytext=(5, 5), fontsize=8, color=C_INK)
ax.set_xlabel("Stock carried / actual demand"); ax.set_ylabel("Share of weeks with a stockout")
ax.set_title("Service-level trade-off (backtest)"); ax.legend(frameon=False)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0%}"))
plt.tight_layout(); fig.savefig(os.path.join(DIRS["figures"], "service_level_tradeoff.png"), bbox_inches="tight"); plt.show()
display(pd.concat(tradeoffs, names=["app"]).round(3))

PRIORITY_SL = {"High": 0.95, "Medium": 0.90, "Low": 0.80}
MIN_CONF = 0.90
CAL_LEVELS = [round(1 - MIN_CONF, 2), 0.80, 0.90, 0.95]

def series_price(rows, key_cols, keys):
    g = rows.groupby(key_cols)["Cashless Price"].mean()
    idx = pd.MultiIndex.from_frame(keys[key_cols]) if len(key_cols) > 1 else keys[key_cols[0]]
    return g.reindex(idx).fillna(g.median()).to_numpy()

LEVELS = {
    "app1":  dict(res=res1,  Y=Y1,  keys=keys1,  price=np.nan_to_num(res1["price"], nan=np.nanmedian(res1["price"])), groups=None),
    "app2a": dict(res=res2a, Y=Y2a, keys=keys2a, price=np.nan_to_num(res2a["price"], nan=np.nanmedian(res2a["price"])), groups=None),
    "app2b": dict(res=res2b, Y=Y2b, keys=keys2b, price=np.nan_to_num(res2b["price"], nan=np.nanmedian(res2b["price"])),
                  groups=keys2b["Asset ID"].to_numpy()),
}
CAL, PRIO, cal_tables, prio_policy = {}, {}, {}, {}

for nm, L in LEVELS.items():
    sel = L["res"]["bt"][L["res"]["bt"]["model"] == SEL[nm]]
    cal_part, test_part = sel[sel["fold"] <= 2], sel[sel["fold"] >= 3]
    z_cal = core.conformal_z(cal_part["y"], cal_part["f"], cal_part["lo"], cal_part["hi"], CAL_LEVELS)
    y, P, Lo, Hi = (test_part[c].to_numpy() for c in ("y", "f", "lo", "hi"))
    sig = core.band_sigma(Lo, Hi)
    z_raw = {CAL_LEVELS[0]: -core.Z90, **{sl: core.SERVICE_Z[sl] for sl in (0.80, 0.90, 0.95)}}

    # (a) held-out coverage on folds 3-4: raw band vs conformal
    def coverage(z):
        out = [(y >= core.calibrated_qty(P, sig, z[CAL_LEVELS[0]], "min")).mean()]
        return out + [(y <= core.calibrated_qty(P, sig, z[sl])).mean() for sl in (0.80, 0.90, 0.95)]
    cal_tables[nm] = pd.DataFrame({"Quantity": [f"Minimum ({MIN_CONF:.0%} sure it sells)"] +
                                               [f"Safe stock at {sl:.0%}" for sl in (0.80, 0.90, 0.95)],
                                   "Target": [MIN_CONF, 0.80, 0.90, 0.95],
                                   "Raw": coverage(z_raw), "Calibrated": coverage(z_cal)})
    err_raw = (cal_tables[nm]["Raw"] - cal_tables[nm]["Target"]).abs().mean()
    err_cal = (cal_tables[nm]["Calibrated"] - cal_tables[nm]["Target"]).abs().mean()
    method = "conformal" if err_cal < err_raw else "raw"   # keep whichever is closer to target
    z_test = z_cal if method == "conformal" else z_raw
    zmin = z_test[CAL_LEVELS[0]]

    # (b) policy replay on folds 3-4 (priority from data before fold 3)
    origin3 = WEEKS.get_loc(pd.Timestamp(test_part["origin"].min()))
    pr_bt = core.priority_table(L["Y"][:, :origin3], L["price"], L["groups"])["Priority"].to_numpy()
    pr = pr_bt[test_part["_i"].to_numpy()]
    pr_price = L["price"][test_part["_i"].to_numpy()]
    q_safe = {sl: core.calibrated_qty(P, sig, z_test[sl]) for sl in (0.80, 0.90, 0.95)}
    q_min = core.calibrated_qty(P, sig, zmin, "min")
    q_prio = np.select([pr == "High", pr == "Medium"], [q_safe[0.95], q_safe[0.90]], q_safe[0.80])
    q_s1 = np.where(pr == "Low", q_min, q_prio)                                   # step 1
    q_s2 = np.where(pr == "Medium", q_safe[0.80], q_s1)                            # step 2
    q_s3 = np.where(pr == "Medium", q_min, q_s1)                                   # step 3
    pol = []
    for rule, q in {"Flat 90% for every product": q_safe[0.90],
                    "Priority-based (95 / 90 / 80%)": q_prio,
                    "Cut step 1: Low -> minimum": q_s1,
                    "Cut step 2: + Medium -> 80%": q_s2,
                    "Cut step 3: + Medium -> minimum": q_s3}.items():
        pol.append({"Rule": rule, "Stock / demand": q.sum() / y.sum(),
                    "Stockouts - all": (y > q).mean(),
                    "Stockouts - High": (y[pr == "High"] > q[pr == "High"]).mean(),
                    "Stockouts - Medium": (y[pr == "Medium"] > q[pr == "Medium"]).mean() if (pr == "Medium").any() else np.nan,
                    "Stockouts - Low": (y[pr == "Low"] > q[pr == "Low"]).mean() if (pr == "Low").any() else np.nan,
                    "Stock vs priority-based": q.sum() / q_prio.sum() - 1,
                    "Stock value ($)": float((q * pr_price).sum()),
                    "Value vs priority-based": (q * pr_price).sum() / (q_prio * pr_price).sum() - 1})
    prio_policy[nm] = pd.DataFrame(pol).set_index("Rule")

    # (c) final: calibrate on all folds, priority on full history
    z_prod = core.conformal_z(sel["y"], sel["f"], sel["lo"], sel["hi"], CAL_LEVELS) if method == "conformal" else z_raw
    CAL[nm] = {"method": method, "z": {float(k): float(v) for k, v in z_prod.items()},
               "heldout_mean_abs_coverage_error": {"raw": float(err_raw), "conformal": float(err_cal)},
               "levels": CAL_LEVELS, "min_confidence": MIN_CONF, "priority_service_levels": PRIORITY_SL,
               "sigma_floor": 0.5, "calibration_rows": int(len(sel))}
    PRIO[nm] = pd.concat([L["keys"].reset_index(drop=True),
                          core.priority_table(L["Y"], L["price"], L["groups"])], axis=1)

    print(f"\n===== {NAMES[nm]} =====")
    print("Coverage on held-out folds 3-4 (target = share of weeks the statement should hold):")
    display(cal_tables[nm].round(3))
    print(f"Mean coverage error - raw: {err_raw:.1%}, calibrated: {err_cal:.1%} -> using {method.upper()} quantities")
    print("Stocking policy simulation (folds 3-4):")
    display(prio_policy[nm].round(3))
    print("Priority mix:", PRIO[nm]["Priority"].value_counts().to_dict())

    PRIO[nm].to_csv(os.path.join(DIRS["evaluation"], f"{nm}_priority_classes.csv"), index=False)
    cal_tables[nm].to_csv(os.path.join(DIRS["evaluation"], f"{nm}_calibration_coverage.csv"), index=False)
    prio_policy[nm].to_csv(os.path.join(DIRS["evaluation"], f"{nm}_priority_policy.csv"))

with open(os.path.join(DIRS["models"], "calibration.json"), "w") as fh:
    json.dump(CAL, fh, indent=2)

fig, axes = plt.subplots(1, 3, figsize=(16, 4), sharey=True)
for ax, (nm, t) in zip(axes, cal_tables.items()):
    x = np.arange(len(t))
    ax.bar(x - 0.2, t["Raw"], 0.38, color=C_GREY, label="Raw quantile models")
    ax.bar(x + 0.2, t["Calibrated"], 0.38, color=C_MODEL, label="Conformal-calibrated")
    ax.scatter(x, t["Target"], marker="_", s=900, color=C_INK, zorder=3, label="Target")
    ax.set_xticks(x); ax.set_xticklabels(["Min 90%", "Safe 80%", "Safe 90%", "Safe 95%"])
    ax.set_ylim(0.6, 1.0); ax.set_title(f"{NAMES[nm]}\n(using {CAL[nm]['method']})"); ax.grid(axis="x", visible=False)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0%}"))
axes[0].set_ylabel("Share of held-out weeks where it held")
h, l = axes[0].get_legend_handles_labels()
fig.legend(h, l, loc="upper center", ncol=3, frameon=False, bbox_to_anchor=(0.5, 0.93), fontsize=9)
fig.suptitle("Does '90% confident' really mean 90%? Coverage before and after calibration", fontweight="bold", y=1.0)
plt.tight_layout(rect=(0, 0, 1, 0.86)); fig.savefig(os.path.join(DIRS["figures"], "calibration_coverage.png"), bbox_inches="tight"); plt.show()

from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, brier_score_loss
APP3_MIN_NAMED, APP3_MIN_WEEKS, REGULAR_RATE, SHRINK_K = 500, 8, 1.0, 3
MIN_SITES_RECO = 3   # min sites a product was stocked at

def site_key(s):
    return s.astype(str).str.strip().str.lower().str.replace(r"\s+", " ", regex=True)

dfa = df.assign(site=site_key(df["Location"]))
sites = dfa.groupby("site").agg(Location=("Location", lambda s: s.mode().iat[0]),
                                machines=("Asset ID", "nunique"), txns=("Asset ID", "size"),
                                named=("Item", lambda s: int(s.notna().sum())),
                                last_sale=("Date", "max"))
sites["staff_share"] = site_staff_share.reindex(sites.index).fillna(0).round(2)
_cat_info = [core.site_categories(n, sh, SITE_RULES, SITE_OVERRIDES) for n, sh in zip(sites.index, sites["staff_share"])]
sites["categories"] = [ci[0] for ci in _cat_info]
sites["matched_keywords"] = [" | ".join(ci[1]) for ci in _cat_info]
sites["source"] = [ci[2] for ci in _cat_info]
site_cat = pd.DataFrame([{c: (c in cs) for c in SITE_CATS} for cs in sites["categories"]], index=sites.index)

# active products and their type
prod = pd.DataFrame({"Item": keys1["Item"], "price": np.round(res1["price"], 2)})
prod["ptype"] = core.product_type(prod["Item"])
item_code = {it: i for i, it in enumerate(prod["Item"])}

# units per machine-week, only while the product was stocked
site_week = dfa.groupby(["site", "WeekStart"])["Asset ID"].nunique().rename("machines").reset_index()
spw = (dfa[dfa["Item"].isin(item_code)].groupby(["site", "Item", "WeekStart"]).size().rename("units").reset_index())
span = spw.groupby(["site", "Item"]).agg(first=("WeekStart", "min"), last=("WeekStart", "max"), units=("units", "sum")).reset_index()
mm = span.merge(site_week, on="site")
mm = mm[(mm["WeekStart"] >= mm["first"]) & (mm["WeekStart"] <= mm["last"])]
off = mm.groupby(["site", "Item"]).agg(offered_weeks=("WeekStart", "size"), avg_machines=("machines", "mean")).reset_index()
rates = span.merge(off, on=["site", "Item"])
rates["rate"] = rates["units"] / (rates["offered_weeks"] * rates["avg_machines"])
train_sites = sites.index[sites["named"] >= APP3_MIN_NAMED]
rates = rates[(rates["offered_weeks"] >= APP3_MIN_WEEKS) & rates["site"].isin(train_sites)]
n_prod = rates.groupby("site").size()
rates = rates[rates["site"].isin(n_prod[n_prod >= 10].index)].reset_index(drop=True)
rates["regular"] = (rates["rate"] >= REGULAR_RATE).astype(int)
app3_sites = sorted(rates["site"].unique())

cat_counts = site_cat.loc[app3_sites].sum().sort_values(ascending=False)
print(f"App 3 training sites: {len(app3_sites)} (of {len(sites)} locations); site-product rows: {len(rates):,}; "
      f"products: {rates['Item'].nunique()}; regular-seller share: {rates['regular'].mean():.1%}")
print("Training sites per category:"); display(cat_counts.to_frame("sites"))
cat_table = sites.loc[app3_sites, ["Location", "machines", "named", "staff_share"]].assign(
    categories=[", ".join(c) for c in sites.loc[app3_sites, "categories"]])
display(cat_table.sort_values("named", ascending=False).head(20))
# one row per location with its categories, unclassified first
review = sites.assign(Categories=[" | ".join(c) for c in sites["categories"]],
                      Used_in_training=sites.index.isin(app3_sites),
                      Staff_area=np.where(site_cat[core.STAFF_CAT], "yes", "no"))
review = review.rename(columns={"matched_keywords": "Matched_keywords", "source": "Source", "named": "Named_sales",
                                "machines": "Machines"})
review["_order"] = review["Source"].map({"none": 0, "keyword": 1, "override": 2})
review = review.sort_values(["_order", "Named_sales"], ascending=[True, False])
review[["Location", "Categories", "Matched_keywords", "Source", "Staff_area", "Machines", "Named_sales",
        "Used_in_training"]].to_csv(os.path.join(DIRS["evaluation"], "app3_site_categories_review.csv"), index=False)
print(f"Category sources: {sites['source'].value_counts().to_dict()} -> review file: app3_site_categories_review.csv")

def popularity(tr, k=SHRINK_K):
    # fleet average, shrunk when few sites stocked it
    g = tr.groupby("Item").agg(n=("site", "nunique"), regular=("regular", "mean"))
    g["rate"] = tr.groupby("Item").apply(lambda d: np.average(d["rate"], weights=d["offered_weeks"]))
    glob_r, glob_g = tr["rate"].median(), tr["regular"].mean()
    g["rate"] = (g["n"] * g["rate"] + k * glob_r) / (g["n"] + k)
    g["regular"] = (g["n"] * g["regular"] + k * glob_g) / (g["n"] + k)
    return g

def profile_predict(tr, cats, items, k=SHRINK_K):
    # average over sites with the same categories, shrunk to popularity
    pop = popularity(tr).reindex(items)
    rows = tr.merge(site_cat, left_on="site", right_index=True)
    num_r = pd.Series(0.0, index=items); num_g = pd.Series(0.0, index=items); n = pd.Series(0.0, index=items)
    for c in cats:
        sub = rows[rows[c]]
        if sub.empty:
            continue
        g = sub.groupby("Item").agg(rate=("rate", "mean"), regular=("regular", "mean"), n=("site", "nunique")).reindex(items)
        num_r += (g["rate"] * g["n"]).fillna(0); num_g += (g["regular"] * g["n"]).fillna(0); n += g["n"].fillna(0)
    pr, pg = pop["rate"].fillna(tr["rate"].median()), pop["regular"].fillna(tr["regular"].mean())
    return pd.DataFrame({"rate": (num_r + k * pr) / (n + k), "regular": (num_g + k * pg) / (n + k),
                         "n_sites": n.astype(int), "pop_rate": pr}, index=items)

def ml_frame(rows, pop, loo=False):
    X = rows[["site", "Item"]].merge(site_cat, left_on="site", right_index=True, how="left").fillna(False)
    X = X[SITE_CATS].astype(int)
    X["item"] = rows["Item"].map(item_code).to_numpy()
    pinfo = prod.set_index("Item").loc[rows["Item"]]
    X["is_drink"] = (pinfo["ptype"].to_numpy() == "Drink").astype(int)
    X["price"] = pinfo["price"].to_numpy()
    p = pop.reindex(rows["Item"])
    if loo:   # leave the site itself out to avoid leakage
        tot = rows.groupby("Item")["rate"].transform("sum"); cnt = rows.groupby("Item")["rate"].transform("count")
        X["pop_rate"] = np.where(cnt > 1, (tot - rows["rate"]) / (cnt - 1).clip(lower=1), np.nan)
        totg = rows.groupby("Item")["regular"].transform("sum")
        X["pop_regular"] = np.where(cnt > 1, (totg - rows["regular"]) / (cnt - 1).clip(lower=1), np.nan)
    else:
        X["pop_rate"] = p["rate"].to_numpy(); X["pop_regular"] = p["regular"].to_numpy()
    return X

ML_KW = dict(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=20, random_state=RANDOM_STATE)
def ml_fit(tr):
    X = ml_frame(tr, popularity(tr), loo=True)
    cat_mask = [c == "item" for c in X.columns]
    reg = HistGradientBoostingRegressor(loss="poisson", categorical_features=cat_mask, **ML_KW).fit(X, tr["rate"], sample_weight=tr["offered_weeks"])
    clf = HistGradientBoostingClassifier(categorical_features=cat_mask, **ML_KW).fit(X, tr["regular"], sample_weight=tr["offered_weeks"])
    return reg, clf

def ndcg_at(actual, pred, k=10):
    order = np.argsort(-pred)[:k]; ideal = np.sort(actual)[::-1][:k]
    disc = 1 / np.log2(np.arange(2, k + 2))
    return float((actual[order] * disc[:len(order)]).sum() / max((ideal * disc[:len(ideal)]).sum(), 1e-9))

def p_at(actual, pred, k=10):
    return len(set(np.argsort(-pred)[:k]) & set(np.argsort(-actual)[:k])) / k

# leave-one-site-out evaluation
loso = []
for s_ in app3_sites:
    tr, te = rates[rates["site"] != s_], rates[rates["site"] == s_]
    cats = sites.loc[s_, "categories"]; items = te["Item"].to_numpy()
    y, yreg = te["rate"].to_numpy(), te["regular"].to_numpy()
    pop = popularity(tr).reindex(items)
    prof = profile_predict(tr, cats, items)
    reg, clf = ml_fit(tr)
    Xte = ml_frame(te, popularity(tr))
    preds = {"Popularity (fleet best-sellers)": (pop["rate"].fillna(0).to_numpy(), pop["regular"].fillna(0).to_numpy()),
             "Category profile": (prof["rate"].to_numpy(), prof["regular"].to_numpy()),
             "ML (gradient boosting)": (reg.predict(Xte), clf.predict_proba(Xte)[:, 1])}
    for m_, (pr_, pg_) in preds.items():
        loso.append({"site": s_, "method": m_, "products": len(te), "P@10": p_at(y, pr_), "NDCG@10": ndcg_at(y, pr_),
                     "Spearman": pd.Series(y).corr(pd.Series(pr_), method="spearman"),
                     "WAPE (rate)": np.abs(y - pr_).sum() / y.sum(),
                     "AUC": roc_auc_score(yreg, pg_) if 0 < yreg.mean() < 1 else np.nan,
                     "Brier": brier_score_loss(yreg, np.clip(pg_, 0, 1))})
loso = pd.DataFrame(loso)
app3_summary = loso.groupby("method")[["P@10", "NDCG@10", "Spearman", "WAPE (rate)", "AUC", "Brier"]].mean()
app3_summary["Random P@10 (reference)"] = (10 / loso.groupby("method")["products"].mean()).clip(upper=1)
piv = loso.pivot(index="site", columns="method", values="NDCG@10")
w_ml = int((piv["ML (gradient boosting)"] > piv["Category profile"]).sum()); l_ml = int((piv["ML (gradient boosting)"] < piv["Category profile"]).sum())
w_pf = int((piv["Category profile"] > piv["Popularity (fleet best-sellers)"]).sum()); l_pf = int((piv["Category profile"] < piv["Popularity (fleet best-sellers)"]).sum())
S_ = app3_summary
ml_ok = (S_.loc["ML (gradient boosting)", "NDCG@10"] > S_.loc["Category profile", "NDCG@10"] and
         S_.loc["ML (gradient boosting)", "P@10"] >= S_.loc["Category profile", "P@10"] and w_ml > l_ml and
         S_.loc["ML (gradient boosting)", "NDCG@10"] > S_.loc["Popularity (fleet best-sellers)", "NDCG@10"])
pf_ok = (S_.loc["Category profile", "NDCG@10"] > S_.loc["Popularity (fleet best-sellers)", "NDCG@10"] and w_pf > l_pf)
APP3_METHOD = "ML (gradient boosting)" if ml_ok else ("Category profile" if pf_ok else "Popularity (fleet best-sellers)")
print(f"Leave-one-site-out over {len(app3_sites)} sites:")
display(app3_summary.round(3))
print(f"NDCG@10 per site - ML vs category profile: {w_ml} wins / {l_ml} losses; "
      f"category profile vs popularity: {w_pf} wins / {l_pf} losses")
print(f"Selected App 3 method: {APP3_METHOD}")
loso.to_csv(os.path.join(DIRS["evaluation"], "app3_loso_by_site.csv"), index=False)
app3_summary.to_csv(os.path.join(DIRS["evaluation"], "app3_loso_summary.csv"))

# quality by site type
loso_sel = loso[loso["method"] == APP3_METHOD].merge(site_cat, left_on="site", right_index=True)
app3_by_cat = pd.DataFrame({c: {"sites": int(loso_sel[c].sum()), "NDCG@10": loso_sel.loc[loso_sel[c], "NDCG@10"].mean(),
                                "P@10": loso_sel.loc[loso_sel[c], "P@10"].mean()}
                            for c in SITE_CATS if loso_sel[c].any()}).T.sort_values("sites", ascending=False)
display(app3_by_cat.round(3)); app3_by_cat.to_csv(os.path.join(DIRS["evaluation"], "app3_quality_by_category.csv"))

# final fit on all sites + recommend()
reg3, clf3 = ml_fit(rates)
pop_all = popularity(rates)

def recommend(cats, top=None, method=None):
    # ranked products for a new site with these categories
    method = method or APP3_METHOD
    cats = [c for c in cats if c in SITE_CATS] or [core.OTHER_CAT]
    items = prod["Item"].to_numpy()
    prof = profile_predict(rates, cats, items)
    if method == "ML (gradient boosting)":
        rows = pd.DataFrame({"site": "__new__", "Item": items})
        X = ml_frame(rows, pop_all)
        X[SITE_CATS] = 0
        for c in cats: X[c] = 1
        rate, like = reg3.predict(X), clf3.predict_proba(X)[:, 1]
    elif method == "Category profile":
        rate, like = prof["rate"].to_numpy(), prof["regular"].to_numpy()
    else:
        rate, like = prof["pop_rate"].to_numpy(), pop_all["regular"].reindex(items).fillna(0).to_numpy()
    similar = int(site_cat.loc[app3_sites, cats].any(axis=1).sum())
    out = prod.copy()
    out["Sites_stocked_fleet"] = pop_all["n"].reindex(items).fillna(0).astype(int).to_numpy()
    out["Likelihood_regular_seller"] = np.round(like, 3)
    out["Expected_units_per_machine_week"] = np.round(rate, 2)
    out["Expected_revenue_per_machine_week"] = np.round(rate * out["price"], 2)
    out["Lift_vs_fleet"] = np.round(rate / np.maximum(prof["pop_rate"].to_numpy(), 1e-6), 2)
    out["Similar_sites_with_product"] = prof["n_sites"].to_numpy()
    out["Confidence"] = np.select([out["Similar_sites_with_product"] >= 5, out["Similar_sites_with_product"] >= 2],
                                  ["High", "Medium"], "Low")
    out = out[out["Sites_stocked_fleet"] >= MIN_SITES_RECO]
    out = out.sort_values("Expected_units_per_machine_week", ascending=False).reset_index(drop=True)
    # machine hint: drink share vs the fleet, over all products (top 10s are mostly drinks anyway)
    drink_share = float(out.loc[out["ptype"] == "Drink", "Expected_units_per_machine_week"].sum() /
                        max(out["Expected_units_per_machine_week"].sum(), 1e-9))
    fleet = pop_all.reindex(out["Item"]).assign(ptype=out["ptype"].to_numpy())
    fleet_share = float(fleet.loc[fleet["ptype"] == "Drink", "rate"].sum() / max(fleet["rate"].sum(), 1e-9))
    diff = drink_share - fleet_share
    hint = (f"More drink-heavy than the fleet ({drink_share:.0%} drinks vs {fleet_share:.0%}): favour a drink machine or a drink-heavy combo"
            if diff > 0.05 else
            f"More snack-heavy than the fleet ({drink_share:.0%} drinks vs {fleet_share:.0%}): favour a snack machine or a snack-heavy combo"
            if diff < -0.05 else f"Similar mix to the fleet ({drink_share:.0%} drinks): a combo machine suits")
    distinctive = out[(out["Confidence"] != "Low") & (out["Expected_units_per_machine_week"] >= 0.5)] \
        .sort_values("Lift_vs_fleet", ascending=False).head(10).reset_index(drop=True)
    meta = {"categories": cats, "similar_training_sites": similar, "method": method,
            "drink_share": round(drink_share, 3), "fleet_drink_share": round(fleet_share, 3),
            "machine_hint": hint, "distinctive": distinctive,
            "overall_confidence": "High" if similar >= 5 else ("Medium" if similar >= 2 else "Low - few or no similar sites")}
    return (out.head(top) if top else out), meta

EXAMPLES = [["Sports & fitness"], ["Education"], ["Transport & transit"],
            ["Construction site", "Staff area"], ["Office & corporate", "Staff area"], ["Culture & events"]]
ex_rows = []
for cats in EXAMPLES:
    rec, meta = recommend(cats, top=10)
    print(f"\n=== New site: {' + '.join(cats)} | similar training sites: {meta['similar_training_sites']} "
          f"({meta['overall_confidence']}) | {meta['machine_hint']}")
    show = ["Item", "ptype", "Likelihood_regular_seller", "Expected_units_per_machine_week",
            "Expected_revenue_per_machine_week", "Lift_vs_fleet", "Confidence"]
    print("Expected best-sellers:"); display(rec[show])
    print("Distinctive for this site type (sells more here than the fleet average):"); display(meta["distinctive"][show].head(5))
    ex_rows.append(rec.assign(query=" + ".join(cats), list="Expected best-sellers",
                              similar_sites=meta["similar_training_sites"], machine_hint=meta["machine_hint"]))
    ex_rows.append(meta["distinctive"].assign(query=" + ".join(cats), list="Distinctive for this site type",
                                              similar_sites=meta["similar_training_sites"], machine_hint=meta["machine_hint"]))
pd.concat(ex_rows).to_csv(os.path.join(DIRS["forecasts"], "app3_example_recommendations.csv"), index=False)

joblib.dump({"name": "app3", "method": APP3_METHOD, "regressor": reg3, "classifier": clf3,
             "rates": rates, "sites": sites.drop(columns=["last_sale"]), "site_cat": site_cat, "app3_sites": app3_sites,
             "products": prod, "item_code": item_code, "shrink_k": SHRINK_K, "regular_rate": REGULAR_RATE,
             "site_keywords": kw_table, "site_overrides": ov_table, "categories": SITE_CATS,
             "feature_names": list(ml_frame(rates.head(1), pop_all).columns)},
            os.path.join(DIRS["models"], "app3_bundle.joblib"), compress=3)

fig, axes = plt.subplots(1, 2, figsize=(14, 4.2))
mets = ["P@10", "NDCG@10", "Spearman", "AUC"]
x = np.arange(len(mets)); wdt = 0.26
_meths = ["Popularity (fleet best-sellers)", "Category profile", "ML (gradient boosting)"]
_others = iter([C_GREY, C_BASE])
_cols = [C_MODEL if m == APP3_METHOD else next(_others) for m in _meths]
for i, (m_, c_) in enumerate(zip(_meths, _cols)):
    vals = app3_summary.loc[m_, mets].to_numpy()
    axes[0].bar(x + (i - 1) * wdt, vals, wdt, color=c_, label=m_ + (" (selected)" if m_ == APP3_METHOD else ""))
axes[0].set_xticks(x); axes[0].set_xticklabels(mets); axes[0].set_ylim(0, 1)
axes[0].set_title("App 3: leave-one-site-out quality (higher is better)"); axes[0].legend(frameon=False, fontsize=8)
axes[0].grid(axis="x", visible=False)
rec, meta = recommend(["Sports & fitness"], top=10)
dd = meta["distinctive"].head(10)
cols_ = [C_MODEL if t == "Drink" else C_ALT for t in dd["ptype"]]
axes[1].barh(dd["Item"][::-1], dd["Lift_vs_fleet"][::-1], color=cols_[::-1], height=0.6)
axes[1].axvline(1, color=C_GREY, lw=1)
axes[1].set_title("Example: what sells more at Sports & fitness sites\n(lift vs fleet average; blue = drink, green = snack/food)")
axes[1].set_xlabel("Sales relative to fleet average (1 = same)"); axes[1].grid(axis="y", visible=False)
plt.tight_layout(); fig.savefig(os.path.join(DIRS["figures"], "app3_evaluation.png"), bbox_inches="tight"); plt.show()

def worst(name, res, label_fn, n=10):
    sel = res["bt"][res["bt"]["model"] == SEL[name]]
    g = sel.groupby("_i").agg(abs_err=("y", lambda s: 0), actual=("y", "sum"), forecast=("f", "sum"))
    g["abs_err"] = sel.assign(ae=(sel["y"] - sel["f"]).abs()).groupby("_i")["ae"].sum()
    g["direction"] = np.where(g["forecast"] > g["actual"], "Over-forecast", "Under-forecast")
    g = g.sort_values("abs_err", ascending=False).head(n)
    g.insert(0, "series", [label_fn(i) for i in g.index])
    g.to_csv(os.path.join(DIRS["evaluation"], f"{name}_worst_series.csv"), index=False)
    return g.round(1)

display(worst("app1", res1, lambda i: keys1.loc[i, "Item"]))
display(worst("app2a", res2a, lambda i: keys2a.loc[i, "Asset ID"]))
display(worst("app2b", res2b, lambda i: f"{keys2b.loc[i, 'Asset ID']} | {keys2b.loc[i, 'Item']}"))

fut = pd.date_range(FORECAST_START, periods=FORECAST_WEEKS, freq="7D")
F, months = core.month_fraction_matrix(fut)
print(f"Weeks {fut[0].date()} -> {(fut[-1] + pd.Timedelta(days=6)).date()}; complete months: {[str(m) for m in months]}")

def add_priority_cols(d, nm, P, sigma, n_rep):
    # add priority, min and safe qty to the stacked frame
    pr = PRIO[nm].loc[np.tile(np.arange(len(PRIO[nm])), n_rep)].reset_index(drop=True)
    for c in ("Priority", "Class", "ABC", "XYZ"):
        d[c] = pr[c].to_numpy()
    sl = d["Priority"].map(PRIORITY_SL).to_numpy()
    z = CAL[nm]["z"]
    d["Service_Level"] = sl
    d["Min_Qty"] = core.calibrated_qty(P, sigma, z[CAL_LEVELS[0]], "min")
    d["Safe_Qty"] = core.calibrated_qty(P, sigma, np.array([z[s] for s in sl]))
    return d

def add_revenue_cols(d, price, n_rep, cols):
    # dollars = units x recent price (cashless only)
    pr = np.tile(price, n_rep)
    d["Price_Recent"] = np.round(pr, 2)
    for c in cols:
        d[f"Revenue_{c}"] = np.round(d[c].to_numpy() * pr, 2)
    return d

def weekly_frame(res, keys, nm, n=HORIZON):
    out = []
    for h in range(n):
        d = keys.copy()
        d["WeekStart"] = fut[h].date()
        d["P10"], d["P50"], d["P90"] = res["L"][:, h], res["P"][:, h], res["U"][:, h]
        out.append(d)
    d = pd.concat(out, ignore_index=True)
    d["Sigma"] = (d["P90"] - d["P10"]) / core.IQR_TO_SIGMA
    d["Qty_P90"] = np.ceil(d["P90"]).astype(int)
    d["Qty_Flat20"] = np.ceil(d["P50"] * (1 + FLAT_BUFFER)).astype(int)
    Pf = res["P"][:, :n].T.ravel()
    sf = core.band_sigma(res["L"][:, :n].T.ravel(), res["U"][:, :n].T.ravel())
    d = add_priority_cols(d, nm, Pf, sf, n)
    d = add_revenue_cols(d, res["price"], n, ["P10", "P50", "P90", "Min_Qty", "Safe_Qty"])
    return d.round(2)

def monthly_frame(res, keys, nm):
    p50, p90 = core.to_monthly(res["P"], res["L"], res["U"], F)
    out = []
    for j, m in enumerate(months):
        d = keys.copy()
        d["Month"] = str(m)
        d["P50"], d["P90"] = p50[:, j], p90[:, j]
        out.append(d)
    d = pd.concat(out, ignore_index=True)
    d["Qty_P90"] = np.ceil(d["P90"]).astype(int)
    d["Qty_Flat20"] = np.ceil(d["P50"] * (1 + FLAT_BUFFER)).astype(int)
    sm = core.monthly_sigma(res["L"], res["U"], F)
    d = add_priority_cols(d, nm, p50.T.ravel(), sm.T.ravel(), len(months))
    d = add_revenue_cols(d, res["price"], len(months), ["P50", "P90", "Min_Qty", "Safe_Qty"])
    return d.round(2)

a1w, a1m = weekly_frame(res1, keys1, "app1"), monthly_frame(res1, keys1, "app1")
a2aw, a2am = weekly_frame(res2a, keys2a, "app2a"), monthly_frame(res2a, keys2a, "app2a")
a2bw, a2bm = weekly_frame(res2b, keys2b, "app2b"), monthly_frame(res2b, keys2b, "app2b")
for d in (a2aw, a2am):
    d["Location"] = d["Asset ID"].map(machine_loc)
    d["Confidence"] = d["Asset ID"].map(confidence).fillna("Low")
tot_w = a2aw.rename(columns={"P50": "Expected_P50"})
tot_m = a2am.rename(columns={"P50": "Expected_P50"})

exports = {"app1_warehouse_weekly.csv": a1w, "app1_warehouse_monthly.csv": a1m,
           "app2b_product_breakdown_weekly.csv": a2bw, "app2b_product_breakdown_monthly.csv": a2bm,
           "app2a_machine_totals_weekly.csv": tot_w, "app2a_machine_totals_monthly.csv": tot_m}
for fn, d in exports.items():
    d.to_csv(os.path.join(DIRS["forecasts"], fn), index=False)
    print(f"{fn:38s} {len(d):>7,} rows")

# revenue summary
rev_rows = []
for nm, (w, m) in {"app1": (a1w, a1m), "app2a": (a2aw, a2am), "app2b": (a2bw, a2bm)}.items():
    rev_rows.append({"app": NAMES[nm], "Next 4 weeks - expected ($)": w["Revenue_P50"].sum(),
                     "Next 4 weeks - range: 90% minimum to P90 ($)": f"{w['Revenue_Min_Qty'].sum():,.0f} - {w['Revenue_P90'].sum():,.0f}",
                     "Next 6 months - expected ($)": m["Revenue_P50"].sum(),
                     "Monthly breakdown ($)": m.groupby("Month")["Revenue_P50"].sum().round(0).to_dict()})
revenue_summary = pd.DataFrame(rev_rows)
revenue_summary.to_csv(os.path.join(DIRS["evaluation"], "revenue_summary.csv"), index=False)
print("\nExpected cashless sales at current prices:")
display(revenue_summary[["app", "Next 4 weeks - expected ($)", "Next 4 weeks - range: 90% minimum to P90 ($)", "Next 6 months - expected ($)"]].round(0))
print("App 2a covers all sales of active machines (incl. unnamed items); App 1 and App 2b cover named products only.")
display(tot_w.head())

def level_metrics(res, ev, pol, n_series, unit):
    s = ev["summary"].loc[ev["selected"]]
    return {"series": int(n_series), "unit": unit, "selected_method": ev["selected"], "training_rows": int(res["n_train_rows"]),
            "params": {k: (float(v) if isinstance(v, (np.floating, float)) else int(v)) for k, v in {**BASE_PARAMS, **res["params"]}.items()},
            "MAE": float(s["MAE"]), "RMSE": float(s["RMSE"]), "WAPE": float(s["WAPE"]),
            "MASE": float(s["MASE"]), "Bias": float(s["Bias"]),
            "best_baseline": ev["best_baseline"],
            "best_baseline_MAE": float(ev["summary"].loc[ev["best_baseline"], "MAE"]),
            "MAE_improvement_vs_best_baseline": ev["mae_improvement"],
            "coverage_P10_P90": ev["coverage_p10_p90"], "share_below_P90": ev["coverage_p90"],
            "all_models": ev["summary"].round(4).to_dict(orient="index"),
            "policy": pol.round(4).to_dict(orient="index"),
            "top_features": res["importance"].head(5).round(4).to_dict(),
            "long_horizon_check": res["long_h"].round(4).to_dict(orient="records")}

metrics = {
    "generated": pd.Timestamp.now().isoformat(timespec="seconds"),
    "data_window": [str(FIRST_WEEK.date()), str((LAST_WEEK + pd.Timedelta(days=6)).date())],
    "forecast_start": str(FORECAST_START.date()),
    "backtest": {"folds": BACKTEST_FOLDS, "horizon_weeks": HORIZON, "method": "rolling-origin, recursive multi-step"},
    "app1": level_metrics(res1, ev1, pol1, len(keys1), "product (fleet-wide)"),
    "app2a": level_metrics(res2a, ev2a, pol2a, len(keys2a), "machine total (all transactions)"),
    "app2b": level_metrics(res2b, ev2b, pol2b, len(keys2b), "machine x product"),
    "names": NAMES,
    "app3": {"method": APP3_METHOD, "training_sites": len(app3_sites), "site_product_rows": int(len(rates)),
             "loso_summary": app3_summary.round(4).to_dict(orient="index"),
             "ml_vs_profile_ndcg_wins_losses": [w_ml, l_ml], "profile_vs_popularity_wins_losses": [w_pf, l_pf],
             "sites_per_category": cat_counts.astype(int).to_dict(),
             "quality_by_category": app3_by_cat.round(4).to_dict(orient="index")},
    "data_audit": audit_df.to_dict(orient="records"),
    "confidence_counts": confidence.value_counts().to_dict(),
    "service_level_tradeoff": {k: v.round(4).to_dict(orient="records") for k, v in tradeoffs.items()},
    "default_service_level": {"app1": 0.9, "app2a": 0.9, "app2b": 0.8},
    "approach_comparison": comp.round(4).to_dict(orient="records"),
    "revenue_summary": revenue_summary.drop(columns=["Monthly breakdown ($)"]).round(2).to_dict(orient="records"),
    "revenue_monthly": {r["app"]: r["Monthly breakdown ($)"] for r in rev_rows},
    "priority_and_calibration": {nm: {"calibration": CAL[nm],
                                      "coverage_heldout": cal_tables[nm].round(4).to_dict(orient="records"),
                                      "policy_simulation": prio_policy[nm].round(4).to_dict(orient="index"),
                                      "priority_counts": PRIO[nm]["Priority"].value_counts().to_dict(),
                                      "class_counts": PRIO[nm]["Class"].value_counts().to_dict()}
                                 for nm in LEVELS},
}
with open(os.path.join(DIRS["evaluation"], "metrics.json"), "w") as fh:
    json.dump(metrics, fh, indent=2, default=str)

headline = pd.DataFrame({k: {"Series": metrics[k]["series"], "WAPE": metrics[k]["WAPE"], "MASE": metrics[k]["MASE"],
                             "MAE": metrics[k]["MAE"], "Best baseline MAE": metrics[k]["best_baseline_MAE"],
                             "MAE gain vs best baseline": metrics[k]["MAE_improvement_vs_best_baseline"],
                             "Share of actuals <= P90": metrics[k]["share_below_P90"], "Bias": metrics[k]["Bias"]}
                         for k in ("app1", "app2a", "app2b")}).T
display(headline.round(3))
headline.to_csv(os.path.join(DIRS["evaluation"], "headline_results.csv"))

def pct(x): return f"{x:.1%}"

def lh_note(m):
    lh = pd.DataFrame(m["long_horizon_check"])
    best = lh.loc[lh.groupby("origin")["WAPE wk 5-26"].idxmin()]
    lost = best[~best["method"].str.startswith("HGB")]
    if lost.empty:
        return "The recursive model was the most accurate method at every origin (vs moving average and scaled seasonal naive)."
    return (f"The recursive model was most accurate at {3 - len(lost)} of 3 origins. Where it lost "
            f"({', '.join(lost['origin'])}, to {', '.join(lost['method'])}), the fleet was shrinking sharply "
            "(machines removed in early 2026), a structural break that lag features adapt to slowly.")

def prio_line(key):
    t = cal_tables[key].set_index("Quantity")
    pp = prio_policy[key]
    sh, s3 = pp.loc["Cut step 1: Low -> minimum"], pp.loc["Cut step 3: + Medium -> minimum"]
    pc = PRIO[key]["Priority"].value_counts().to_dict()
    col = "Calibrated" if CAL[key]["method"] == "conformal" else "Raw"
    return (f"**Priority and stocking quantities:** {pc.get('High', 0)} High / {pc.get('Medium', 0)} Medium / "
            f"{pc.get('Low', 0)} Low (ABC-XYZ). Quantities use the **{CAL[key]['method']}** band (chosen on held-out "
            f"coverage error: raw {CAL[key]['heldout_mean_abs_coverage_error']['raw']:.1%} vs conformal "
            f"{CAL[key]['heldout_mean_abs_coverage_error']['conformal']:.1%}). On held-out weeks, the 90% minimum held in "
            f"{t.iloc[0][col]:.1%} of cases and safe stock at 90% in {t.loc['Safe stock at 90%', col]:.1%}. "
            f"Cut ladder: step 1 (Low at minimum) changes total stock by {sh['Stock vs priority-based']:+.1%}, and step 3 "
            f"(Low and Medium at minimum) by {s3['Stock vs priority-based']:+.1%}. High-priority stockouts stay at {s3['Stockouts - High']:.1%}.")

def combo_line(key):
    if SEL[key] == "HGB Poisson":
        return f"- **Final method:** {SEL[key]} (alternatives in `approach_comparison.csv` did not meet the adoption rule)."
    if SEL[key] == "HGB Poisson + price":
        c = comp[(comp["app"] == key) & (comp["alternative"] == SEL[key])].iloc[0]
        return (f"- **Final method:** HGB Poisson **with price features** (recent price, recent price change; future prices "
                f"held at today's level). Adopted because it lowered WAPE from {c['WAPE HGB Poisson']:.1%} to "
                f"{c['WAPE alternative']:.1%} and was better in {c['folds better']} folds.")
    c = comp[(comp["app"] == key) & (comp["alternative"] == SEL[key])].iloc[0]
    return (f"- **Final method:** {TD_WEIGHT:.0%} direct model + {1 - TD_WEIGHT:.0%} top-down (product share of last "
            f"{SHARE_WINDOW} weeks x App 2a machine total). Adopted because it lowered WAPE from "
            f"{c['WAPE HGB Poisson']:.1%} to {c['WAPE alternative']:.1%} and was better in {c['folds better']} folds.")

def model_card(key, title, purpose, users, data_desc, extra_limits):
    m = metrics[key]
    pol = pd.DataFrame(m["policy"]).T
    p = pol.loc["P90 (SmartStock v2)"]; f20 = pol.loc["Forecast +20% (v1)"]
    feats = ", ".join(m["top_features"].keys())
    return f"""# Model Card: {title}
*SmartStock v2, Group Sydney 06 (CDU PRT691). Generated {metrics['generated']} by the training notebook.*

## Model details
- **Type:** scikit-learn HistGradientBoostingRegressor. Poisson loss for the point forecast (P50); quantile loss for P10 and P90.
- **Granularity:** weekly (Monday to Sunday), {m['unit']}; {m['series']:,} series; {m['training_rows']:,} training rows.
- **Features:** lags (1, 2, 4, 52 weeks), rolling means (4/8/13/26 weeks), rolling std (8 weeks), series age, ISO week, month, plus categorical IDs. Every feature uses only past weeks.
- **Hyperparameters:** {m['params']} (tuned on origins kept separate from evaluation).
- **Forecasting:** recursive. Each week's P50 is fed back as history for the next week.
- **Revenue:** forecast units x recent average price per unit (last 8 weeks, per series). This is cashless revenue only, assuming prices stay unchanged.
{combo_line(key)}

## Intended use
- **Purpose:** {purpose}
- **Users:** {users}
- **Decision support only.** A person reviews and approves every order or restock. Not for automatic ordering.

## Training and evaluation data
- {data_desc}
- Window: {metrics['data_window'][0]} to {metrics['data_window'][1]} (complete weeks only).

## Evaluation (rolling-origin backtest: {BACKTEST_FOLDS} folds x {HORIZON} weeks ahead, recursive)
| Metric | Value |
|---|---|
| WAPE | {pct(m['WAPE'])} |
| MASE (vs in-sample naive) | {m['MASE']:.3f} |
| MAE | {m['MAE']:.3f} units/week |
| MAE gain vs best baseline ({m['best_baseline']}) | {pct(m['MAE_improvement_vs_best_baseline'])} |
| Bias (+ = over-forecast) | {pct(m['Bias'])} |
| Actuals within P10-P90 (target 80%) | {pct(m['coverage_P10_P90'])} |
| Actuals at or below P90 (target 90%) | {pct(m['share_below_P90'])} |

**Stocking-policy simulation (backtest weeks):** stocking to P90 gives a stockout rate of {pct(p['Stockout rate (demand > stock)'])}, carrying {p['Total stock / demand']:.2f}x demand. A flat +20% gives {pct(f20['Stockout rate (demand > stock)'])} at {f20['Total stock / demand']:.2f}x demand.

**Most influential features (permutation importance):** {feats}.

{prio_line(key)}

**26-week stability check** (point forecasts from 3 origins, WAPE for weeks 5-26): {'; '.join(f"{r['origin']}: {r['WAPE wk 5-26']:.1%}" for r in m['long_horizon_check'] if r['method'].startswith('HGB'))}. {lh_note(m)}

## Limitations and risks
- Trained on **realised cashless sales**. Demand during stockouts is unseen (censored), and cash sales are not included.
- No weather, academic calendar or promotion data.
- The monthly P90 assumes independent weekly errors, so it may understate the true range.
- Recursive forecasts become less accurate further ahead (see the error-by-horizon chart).
{extra_limits}

## Ethical considerations
- No personal or customer data is used: only machine, product, time and price.
- **Fairness:** error is reported by volume band and machine type so that under-served segments are visible. Low-confidence machines are flagged in the interface rather than excluded.
- **Oversight:** quantities are recommendations. The client approves or overrides them.
"""

cards = {
 "app1": model_card("app1", NAMES["app1"],
    "Weekly and monthly warehouse purchase quantities per product.", "Operations manager / purchasing",
    "Fleet-wide weekly unit sales per product (named items only, products with at least 200 transactions, active in the last 8 weeks).",
    "- ~44% of transactions have no item name, so product-level totals undercount true fleet demand."),
 "app2b": model_card("app2b", NAMES["app2b"],
    "Weekly and monthly units per product for each machine, shown to route staff, who decide what to restock.", "Route staff (restock drivers)",
    "Weekly unit sales per machine-product pair (current machine list, history restarted at relocation, at least 30 transactions and 15 active days).",
    "- Machines whose sales are mostly unnamed items get an incomplete product list; use the App 2a total for these."),
 "app2a": model_card("app2a", NAMES["app2a"],
    "Weekly total units per machine, including unnamed items, for route planning and for machines without product labels.",
    "Route staff and operations manager",
    "Weekly total transactions per machine (all transactions, current machine list, history restarted at relocation).",
    "- Gives a total only, not a product mix."),
}
for k, txt in cards.items():
    with open(os.path.join(DIRS["docs"], f"model_card_{k}.md"), "w") as fh: fh.write(txt)

audit_md = "\n".join(f"| {r['Check']} | {r['Value']} | {r['Action']} |" for r in metrics["data_audit"])
datasheet = f"""# Datasheet: A to Z Vending cashless sales (2023-2026)
*Following Gebru et al. (2021), "Datasheets for Datasets". Generated by the SmartStock v2 notebook.*

## Motivation
Supplied by A to Z Vending (via the PRT691 unit) to forecast stock needs for the warehouse and for each machine.

## Composition
- Four yearly workbooks (sheet "Item") with columns: Sale Date Time, Asset ID, Location, Place, Type, Cashless Price, Coil, Item. One row is one cashless vend.
- Machine list (CashlessMachines.xlsx): Asset ID, SN, Location, Place, Type, Cash Discount, rolling cashless sales totals.
- Raw period: {sales_raw['Sale Date Time'].min()} to {sales_raw['Sale Date Time'].max()}.

## Data-quality audit and preprocessing
| Check | Value | Action |
|---|---|---|
{audit_md}

## What the data does not contain
Cash sales, restock or stockout records, product master or category data, prices paid by the business, weather, site calendars and promotions.

## Privacy
No customer identifiers (no card numbers, names or loyalty IDs). **Correction to the progress report:** the `Place` field is free-text access notes, not a site-type category. It contains door/padlock codes and individuals' phone numbers, so it is security-sensitive and partly personal information. SmartStock v2 drops it at load and never displays it. Site names and addresses are business locations. Raw data is stored only in a restricted team Drive folder and is never committed to a public repository.

## Maintenance
Retrain monthly when new sales data arrives. The next retrain should add restock logs and planograms once the client supplies them.
"""
with open(os.path.join(DIRS["docs"], "datasheet.md"), "w") as fh: fh.write(datasheet)

s3 = app3_summary.loc[APP3_METHOD]
card3 = f"""# Model Card: {NAMES['app3']}
*SmartStock v2, Group Sydney 06 (CDU PRT691). Generated {metrics['generated']}.*

## Model details
- **Task:** rank currently active products for a *new* site, given its site categories.
- **Selected method:** {APP3_METHOD} (chosen by leave-one-site-out evaluation against popularity and category-profile baselines).
- **Site categories:** derived automatically from location names by the editable keyword rules in `config/site_category_keywords.csv`, with per-location fixes in `config/site_category_overrides.csv`. Reviewed through `app3_site_categories_review.csv`. Multi-label, plus a *Staff area* flag from placement notes. {len(SITE_CATS)} categories in total.
- **Target:** units per machine per week **while the product was stocked** at the site. *Regular seller* means at least {REGULAR_RATE:g} unit per machine-week.

## Intended use
- **Purpose:** decide what to stock first in a new machine, and which machine type suits a site (drink share of the expected best-sellers compared with the fleet average). Two lists are shown: *expected best-sellers* and *distinctive for this site type* (highest lift against the fleet average). Products stocked at fewer than {MIN_SITES_RECO} sites are not recommended.
- **Users:** operations manager.
- **Decision support only.** The first weeks of real sales should replace these estimates (App 2a/2b take over).

## Data
- {len(app3_sites)} sites with at least {APP3_MIN_NAMED} named-product sales and at least 10 stocked products; {len(rates):,} site-product rows; {rates['Item'].nunique()} products.
- Training sites per category: {', '.join(f'{k} {v}' for k, v in cat_counts.items() if v > 0)}.

## Evaluation (leave-one-site-out)
| Metric | {APP3_METHOD} |
|---|---|
| Precision@10 | {s3['P@10']:.2f} (random: {s3['Random P@10 (reference)']:.2f}) |
| NDCG@10 | {s3['NDCG@10']:.2f} |
| Spearman rank correlation | {s3['Spearman']:.2f} |
| AUC (regular seller) | {s3['AUC']:.2f} |

All three methods are compared in `app3_loso_summary.csv`, and quality by site type in `app3_quality_by_category.csv`.

## Limitations
- **Few training sites:** about 60 in total, and several categories have fewer than 3. The tool shows a confidence level and the number of similar sites with every result.
- **Keyword rules are imperfect:** some names cannot be classified (*Other / unclassified*), and some could be misread, e.g. "Airport Link" is a toll-road office. These are fixed by adding keywords or overrides in the config CSVs and re-running.
- **Unseen site types:** types with no examples in the data (e.g. shopping malls, cinemas) fall back to the closest categories at low confidence.
- **Assortment bias:** sales reflect what was stocked. A product never stocked at similar sites gets the fleet-average estimate.
- **Cashless only;** unnamed-item sales (about 43%) cannot be used.

## Ethical considerations
- The data holds no personal information. Only a yes/no *Staff area* flag is taken from the placement notes.
- Recommendations are suggestions. A person chooses what to stock.
"""
with open(os.path.join(DIRS["docs"], "model_card_app3.md"), "w") as fh: fh.write(card3)

feature_dict = """# Feature dictionary (SmartStock v2)
All features are computed by `smartstock_core.features_at()` for week *t* using only weeks before *t*.

| Feature | Used in | Description |
|---|---|---|
| lag_1, lag_2, lag_4 | All | Units sold 1, 2 and 4 weeks earlier |
| lag_52 | All | Units sold in the same week last year (yearly seasonality; missing for series under a year old, handled natively by HGB) |
| rm_4, rm_8, rm_13, rm_26 | All | Mean weekly units over the previous 4/8/13/26 weeks |
| rstd_8 | All | Standard deviation of weekly units over the previous 8 weeks (volatility) |
| age | All | Weeks of history the series has (new vs established machines/products) |
| woy | All | ISO week of year of the target week |
| month | All | Calendar month of the target week's midpoint |
| item | App 1, App 2b | Product identity (native categorical) |
| item_cat | App 1, App 2b | Product category inferred from the machine type it mostly sells from (Beverage/Snack/Combo/Other) |
| asset | App 2b, App 2a | Machine identity (native categorical) |
| mcat | App 2b, App 2a | Machine category from the raw Type field (Beverage/Snack/Combo/Other/Unknown) |

**Removed vs v1:** DayOfWeek and IsWeekend (now weekly granularity); lag_7/lag_14/rolling_mean_7/28 (daily features).
**Target:** weekly units (count of vends). **Losses:** Poisson (P50), quantile 0.1 / 0.9 (P10 / P90).
"""
with open(os.path.join(DIRS["docs"], "feature_dictionary.md"), "w") as fh: fh.write(feature_dict)
print("Wrote model cards and datasheet to", DIRS["docs"])

for root, _, files in os.walk(OUT):
    if "cache" in root: continue
    for f in sorted(files):
        p = os.path.join(root, f)
        print(f"{os.path.relpath(p, OUT):55s} {os.path.getsize(p) / 1024:8.0f} KB")