"""Response builders for every data operation (the routers only parse inputs and call these)."""
import calendar
from datetime import date, timedelta

import numpy as np

from . import calendar_utils as cal
from . import forecasting as fc
from .errors import bad_input, not_found
from .store import store


def _meta_window():
    lv = store.level("app2a")
    return fc.window_for(lv), lv


# ---------------- system
def _named_share(weeks=13):
    """Share of recent units that carry a product name (App 1 sees only these; App 2a sees all sales)."""
    named = float(np.nansum(store.level("app1").Y[:, -weeks:]))
    total = float(np.nansum(store.level("app2a").Y[:, -weeks:]))
    return round(named / total, 3) if total > 0 else None


def meta():
    ms = store.require()
    win, _ = _meta_window()
    m = ms.metrics
    return {"data_start": (m.get("data_window") or [None])[0], "data_end": str(win.data_end),
            "forecast_start": str(win.forecast_start), "current_week_start": str(win.current_week_start),
            "data_age_weeks": win.data_age_weeks, "max_horizon_weeks": win.max_weeks,
            "max_horizon_months": win.max_months, "model_version": ms.version, "trained_until": ms.trained_until,
            "default_service_levels": dict(fc.PRIORITY_SL), "allowed_service_levels": list(fc.ALLOWED_SERVICE_LEVELS),
            "currency": "AUD", "revenue_note": "Cashless sales only, at current prices",
            "named_sales_share": _named_share()}


def fleet_history(app, weeks=12, granularity="week", months=24, asset_id=None):
    """Actual sales (units, and revenue at current prices) across all series, or for one machine.

    Weekly: the most recent `weeks` weeks. Monthly: the most recent `months` complete calendar months;
    each week's sales are spread evenly over its 7 days, and only months fully covered by the data are returned.
    """
    if app not in ("app1", "app2a"):
        raise bad_input("app must be app1 or app2a.")
    if granularity not in ("week", "month"):
        raise bad_input("granularity must be 'week' or 'month'.")
    lv = store.level(app)
    if asset_id is not None:
        if app != "app2a":
            raise bad_input("asset_id can only be used with app2a.")
        rows = np.array([_one(lv, "Asset ID", asset_id)])
    else:
        rows = np.arange(len(lv.keys))
    y = np.nan_to_num(lv.Y[rows])
    units = y.sum(axis=0)
    revenue = (y * lv.price[rows][:, None]).sum(axis=0)
    note = "Actual sales that the models were trained on. Revenue uses current prices."

    if granularity == "week":
        n = min(int(weeks), lv.T)
        return {"app": app, "asset_id": asset_id, "granularity": "week",
                "weeks": [{"week_start": str(w.date()), "units": round(float(u), 1), "revenue": round(float(r), 2)}
                          for w, u, r in zip(lv.weeks[-n:], units[-n:], revenue[-n:])], "note": note}

    buckets = {}                      # (year, month) -> [units, revenue, days covered]
    for w, u, r in zip(lv.weeks, units, revenue):
        for d in range(7):
            day = w.date() + timedelta(days=d)
            b = buckets.setdefault((day.year, day.month), [0.0, 0.0, 0])
            b[0] += float(u) / 7
            b[1] += float(r) / 7
            b[2] += 1
    complete = [(k, v) for k, v in sorted(buckets.items()) if v[2] == calendar.monthrange(*k)[1]]
    out = [{"period_start": f"{y_:04d}-{m_:02d}-01", "period_label": f"{date(y_, m_, 1):%b %Y}",
            "units": round(v[0], 1), "revenue": round(v[1], 2)} for (y_, m_), v in complete[-int(months):]]
    return {"app": app, "asset_id": asset_id, "granularity": "month", "months": out, "note": note}


def missed_forecast(app, asset_id=None):
    """Expected sales for the weeks between the end of the data and the current week.

    These weeks are in the past but have no real sales yet (the data is older than today). Once newer sales
    are uploaded and the model retrained, the real sales appear for them and this list gets shorter.
    """
    if app not in ("app1", "app2a"):
        raise bad_input("app must be app1 or app2a.")
    lv = store.level(app)
    if asset_id is not None and app != "app2a":
        raise bad_input("asset_id can only be used with app2a.")
    rows = np.array([_one(lv, "Asset ID", asset_id)]) if asset_id is not None else np.arange(len(lv.keys))
    count = min(fc.window_for(lv).offset, lv.horizon)
    price = lv.price[rows]
    weeks = []
    for h in range(count):
        p50 = lv.P[rows][:, h]
        start = lv.future[h].date()
        weeks.append({"period_start": str(start), "period_label": cal.week_label(start),
                      "horizon_confidence": cal.horizon_confidence(h + 1),
                      "expected": round(float(p50.sum()), 1), "revenue_expected": round(float((p50 * price).sum()), 2)})
    return {"app": app, "asset_id": asset_id, "weeks": weeks,
            "note": "Expected sales for weeks that have passed but have no real sales in the data yet."}


def home_summary():
    ms = store.require()
    lv = ms.levels["app2a"]
    rows = np.arange(len(lv.keys))
    win = fc.window_for(lv)
    out = {"machines": int(len(lv.keys)), "low_confidence_machines": int((lv.confidence == "Low").sum()),
           "products": int(len(ms.levels["app1"].keys)), "model_version": ms.version,
           "trained_until": ms.trained_until, "next_week_revenue_p50": None, "next_month_revenue_p50": None,
           "next_weeks": []}
    if win.max_weeks:
        b, _ = fc.compute(lv, rows, "week", min(8, win.max_weeks))
        agg = fc.aggregate_periods(b)
        out["next_week_revenue_p50"] = agg[0]["revenue_p50"]
        out["next_weeks"] = agg
    if win.max_months:
        bm, _ = fc.compute(lv, rows, "month", 1)
        out["next_month_revenue_p50"] = fc.aggregate_periods(bm)[0]["revenue_p50"]
        out["next_month_label"] = bm.meta[0]["period_label"]
    return out


# ---------------- generic
def _series(level, i, b, k, granularity, extra=None):
    return {"key": str(level.keys.iloc[i, -1] if level.name != "app2b" else f"{level.keys.at[i, 'Asset ID']}|{level.keys.at[i, 'Item']}"),
            "granularity": granularity, **fc.series_header(level, i), "history": level.history(i),
            "periods": fc.periods_for_row(b, k), **(extra or {})}


def _one(level, col, value):
    rows = level.rows_where(**{col: value})
    if not len(rows):
        raise not_found(f"{'Product' if col == 'Item' else 'Machine'} '{value}' was not found.",
                        "unknown_item" if col == "Item" else "unknown_machine")
    return int(rows[0])


# ---------------- App 1
def app1_products(granularity, horizon, service_level):
    lv = store.level("app1")
    rows = np.arange(len(lv.keys))
    b, _ = fc.compute(lv, rows, granularity, horizon, service_level)
    items = []
    for k, i in enumerate(rows):
        items.append({"item": lv.keys.at[i, "Item"], **fc.series_header(lv, i),
                      "first": fc.periods_for_row(b, k)[0], "sparkline": fc.sparkline(b, k)})
    return {"granularity": granularity, "periods": b.meta, "items": items}


def app1_forecast(item, granularity, horizon, service_level):
    lv = store.level("app1")
    i = _one(lv, "Item", item)
    b, _ = fc.compute(lv, [i], granularity, horizon, service_level)
    return _series(lv, i, b, 0, granularity, {"item": lv.keys.at[i, "Item"]})


def app1_summary(granularity, horizon, service_level, cut_step):
    lv = store.level("app1")
    rows = np.arange(len(lv.keys))
    b, _ = fc.compute(lv, rows, granularity, horizon, service_level)
    q0 = fc.cut_step_quantities(lv, b, 0)
    q = fc.cut_step_quantities(lv, b, cut_step)
    price = b.price[:, None]
    pr = lv.priority[rows]
    periods = []
    for j, m in enumerate(b.meta):
        by = {p: {"safe": int(q[pr == p, j].sum()), "revenue_safe": round(float((q[pr == p, j] * b.price[pr == p]).sum()), 2)}
              for p in ("High", "Medium", "Low")}
        periods.append({**m, "expected": round(float(b.p50[:, j].sum()), 1), "minimum": int(b.min_qty[:, j].sum()),
                        "safe": int(q[:, j].sum()), "safe_normal": int(q0[:, j].sum()),
                        "revenue_expected": round(float((b.p50[:, j] * b.price).sum()), 2),
                        "revenue_safe": round(float((q[:, j] * b.price).sum()), 2), "by_priority": by})
    u0, u1 = float(q0.sum()), float(q.sum())
    r0, r1 = float((q0 * price).sum()), float((q * price).sum())
    changed = [{"item": lv.keys.at[i, "Item"], "priority": pr[k], "normal_qty": int(q0[k].sum()), "cut_qty": int(q[k].sum())}
               for k, i in enumerate(rows) if q0[k].sum() != q[k].sum()]
    changed.sort(key=lambda r: r["normal_qty"] - r["cut_qty"], reverse=True)
    per_item = [{"item": lv.keys.at[i, "Item"], "priority": pr[k], "class": lv.cls[i],
                 "quantities": [int(v) for v in q[k]], "normal_quantities": [int(v) for v in q0[k]]}
                for k, i in enumerate(rows)]
    return {"cut_step": cut_step, "granularity": granularity, "periods": periods,
            "saved_vs_step0": {"units": int(u0 - u1), "revenue": round(r0 - r1, 2),
                               "pct_units": round((u0 - u1) / max(u0, 1e-9), 4), "pct_revenue": round((r0 - r1) / max(r0, 1e-9), 4)},
            "changed_items": changed, "items": per_item,
            "rules": {0: "Every product at its safe stock", 1: "Low priority reduced to its minimum",
                      2: "Also Medium priority reduced to 80% cover", 3: "Also Medium priority reduced to its minimum"}}


# ---------------- App 2a
def _breakdown_assets():
    return set(store.level("app2b").keys["Asset ID"].astype(str))


def app2a_machines(granularity, horizon, service_level):
    lv = store.level("app2a")
    rows = np.arange(len(lv.keys))
    b, _ = fc.compute(lv, rows, granularity, horizon, service_level)
    has = _breakdown_assets()
    out = []
    for k, i in enumerate(rows):
        aid = str(lv.keys.at[i, "Asset ID"])
        out.append({"asset_id": aid, "location": lv.location[i], "confidence": lv.confidence[i],
                    "has_product_breakdown": aid in has and lv.confidence[i] != "Low", **fc.series_header(lv, i),
                    "first": fc.periods_for_row(b, k)[0], "sparkline": fc.sparkline(b, k)})
    return {"granularity": granularity, "periods": b.meta, "machines": out}


def app2a_summary(granularity, horizon, service_level):
    """Fleet totals per period across all machines (same keys as the App 1 summary), for the summary cards."""
    lv = store.level("app2a")
    rows = np.arange(len(lv.keys))
    b, _ = fc.compute(lv, rows, granularity, horizon, service_level)
    periods = [{**m, "expected": round(float(b.p50[:, j].sum()), 1), "minimum": int(b.min_qty[:, j].sum()),
                "safe": int(b.safe_qty[:, j].sum()),
                "revenue_expected": round(float((b.p50[:, j] * b.price).sum()), 2),
                "revenue_safe": round(float((b.safe_qty[:, j] * b.price).sum()), 2)}
               for j, m in enumerate(b.meta)]
    return {"granularity": granularity, "machines": int(len(rows)), "periods": periods}


def app2a_forecast(asset_id, granularity, horizon, service_level):
    lv = store.level("app2a")
    i = _one(lv, "Asset ID", asset_id)
    b, _ = fc.compute(lv, [i], granularity, horizon, service_level)
    aid = str(lv.keys.at[i, "Asset ID"])
    return _series(lv, i, b, 0, granularity, {
        "asset_id": aid, "location": lv.location[i], "confidence": lv.confidence[i],
        "has_product_breakdown": aid in _breakdown_assets() and lv.confidence[i] != "Low"})


# ---------------- App 2b (data only)
def app2b_machine(asset_id, granularity, horizon, service_level):
    lv = store.level("app2b")
    rows = lv.rows_where(**{"Asset ID": asset_id})
    a2 = store.level("app2a")
    a2_rows = a2.rows_where(**{"Asset ID": asset_id})
    if not len(rows):
        if len(a2_rows):
            raise not_found("Product names are not recorded for this machine, so there is no product breakdown. "
                            "Use the machine total instead.", "no_product_breakdown")
        raise not_found(f"Machine '{asset_id}' was not found.", "unknown_machine")
    b, _ = fc.compute(lv, rows, granularity, horizon, service_level)
    products = [{"item": lv.keys.at[i, "Item"], **fc.series_header(lv, i), "periods": fc.periods_for_row(b, k)}
                for k, i in enumerate(rows)]
    products.sort(key=lambda p: -p["periods"][0]["p50"])
    app2a_total = []
    if len(a2_rows):
        b2, _ = fc.compute(a2, a2_rows[:1], granularity, horizon, service_level)
        app2a_total = fc.periods_for_row(b2, 0)
    loc = a2.location[a2_rows[0]] if len(a2_rows) else ""
    return {"asset_id": str(lv.keys.at[rows[0], "Asset ID"]), "location": loc, "granularity": granularity,
            "machine_total": fc.aggregate_periods(b, service_level), "app2a_total": app2a_total,
            "products": products,
            "note": "The machine total from App 2a also counts sales with no product name, so it is usually higher."}


def app2b_product(item, granularity, horizon, service_level):
    lv = store.level("app2b")
    rows = lv.rows_where(Item=item)
    if not len(rows):
        raise not_found(f"Product '{item}' is not forecast at any machine.", "unknown_item")
    b, _ = fc.compute(lv, rows, granularity, horizon, service_level)
    a2 = store.level("app2a")
    loc = dict(zip(a2.keys["Asset ID"].astype(str), a2.location))
    machines = [{"asset_id": str(lv.keys.at[i, "Asset ID"]), "location": loc.get(str(lv.keys.at[i, "Asset ID"]), ""),
                 **fc.series_header(lv, i), "periods": fc.periods_for_row(b, k)} for k, i in enumerate(rows)]
    machines.sort(key=lambda p: -p["periods"][0]["p50"])
    in_app1 = len(store.level("app1").rows_where(Item=item)) > 0
    return {"item": lv.keys.at[rows[0], "Item"], "granularity": granularity,
            "fleet_total": fc.aggregate_periods(b, service_level), "machines": machines, "in_app1": in_app1}


# ---------------- models
def model_metrics():
    ms = store.require()
    m = ms.metrics
    apps = {}
    for a in ("app1", "app2a", "app2b"):
        x = m.get(a) or {}
        pc = ((m.get("priority_and_calibration") or {}).get(a) or {})
        apps[a] = {"name": (m.get("names") or {}).get(a, a), "series": x.get("series"), "unit": x.get("unit"),
                   "method": x.get("selected_method"), "wape": x.get("WAPE"), "mase": x.get("MASE"), "bias": x.get("Bias"),
                   "best_baseline": x.get("best_baseline"), "gain_vs_baseline": x.get("MAE_improvement_vs_best_baseline"),
                   "coverage_p10_p90": x.get("coverage_P10_P90"), "share_below_p90": x.get("share_below_P90"),
                   "safe_stock_coverage_heldout": pc.get("coverage_heldout"),
                   "calibration_method": (pc.get("calibration") or {}).get("method"),
                   "priority_counts": pc.get("priority_counts"), "policy_simulation": x.get("policy"),
                   "all_models": x.get("all_models"), "top_features": x.get("top_features"),
                   "service_level_tradeoff": (m.get("service_level_tradeoff") or {}).get(a)}
    a3 = m.get("app3") or {}
    meth = a3.get("method")
    apps["app3"] = {"name": (m.get("names") or {}).get("app3", "app3"), "method": meth,
                    "training_sites": a3.get("training_sites"), "loso_summary": a3.get("loso_summary"),
                    "precision_at_10": ((a3.get("loso_summary") or {}).get(meth) or {}).get("P@10"),
                    "ndcg_at_10": ((a3.get("loso_summary") or {}).get(meth) or {}).get("NDCG@10"),
                    "quality_by_category": a3.get("quality_by_category"), "sites_per_category": a3.get("sites_per_category")}
    return {"model_version": ms.version, "trained_at": m.get("generated"), "data_window": m.get("data_window"),
            "forecast_start": m.get("forecast_start"), "backtest": m.get("backtest"), "apps": apps,
            "approach_comparison": m.get("approach_comparison"), "revenue_summary": m.get("revenue_summary"),
            "data_audit": m.get("data_audit"), "statement": "SmartStock recommends; people decide."}


def model_cards():
    ms = store.require()
    d = ms.dir / "docs"
    titles = {"app1": "App 1 - Warehouse demand", "app2a": "App 2a - Machine totals",
              "app2b": "App 2b - Product breakdown", "app3": "App 3 - New-site product recommendations"}
    cards = []
    for a, t in titles.items():
        p = d / f"model_card_{a}.md"
        if p.exists():
            cards.append({"app": a, "title": t, "markdown": p.read_text()})
    ds = d / "datasheet.md"
    fd = d / "feature_dictionary.md"
    return {"cards": cards, "datasheet_markdown": ds.read_text() if ds.exists() else "",
            "feature_dictionary_markdown": fd.read_text() if fd.exists() else ""}
