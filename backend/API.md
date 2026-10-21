# SmartStock API reference

Base URL: `http://localhost:8000/api/v1` (the prefix can be changed with `SMARTSTOCK_API_PREFIX`).
Interactive documentation, generated from the code: **http://localhost:8000/docs**.

- JSON everywhere. Dates are `YYYY-MM-DD`; money is AUD (cashless sales only, at current prices).
- Every endpoint except **Sign in**, **Health** and the **one-time upload link** needs
  `Authorization: Bearer <token>`.
- Errors always have the shape `{"detail": "human-readable message", "code": "machine_code"}`.

| Status | When | Example `code` |
|---|---|---|
| 401 | not signed in, bad or expired token, wrong password | `not_authenticated`, `session_expired`, `wrong_credentials` |
| 403 | upload link expired or already used | `invalid_upload_ticket` |
| 404 | unknown product, machine, job, version | `unknown_item`, `unknown_machine`, `no_product_breakdown` |
| 409 | a retraining job is already running | `job_running` |
| 413 | uploaded file too large | `file_too_large` |
| 422 | invalid input (horizon too long, bad service level, bad rules) | `invalid_input`, `horizon_too_long`, `data_too_old`, `invalid_rules` |
| 429 | too many failed sign-ins (5 per minute) | `too_many_attempts` |
| 503 | models still loading or failed to load | `models_not_loaded` |

## Common query parameters (forecast endpoints)

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `granularity` | `week` \| `month` | `week` | weeks are Monday to Sunday; months are complete calendar months, starting with the current month (days already passed count as expected); add `skip_current=true` to start with the next month instead |
| `horizon` | weeks 1–12, months 1–6 | 4 weeks / 6 months (or the maximum allowed) | capped by `max_horizon_weeks` / `max_horizon_months` from `/meta` |
| `service_level` | 0.5, 0.6, 0.7, 0.8, 0.9, 0.95 | by priority (High 0.95, Medium 0.9, Low 0.8) | optional override; recomputes `safe_qty` |
| `cut_step` | 0–3 | 0 | App 1 summary only |

**Forecasts always start at the current week** (Australia/Sydney). The models forecast 26 weeks after
the last week of data, so the further the current week is from the data end, the shorter the allowed
horizon. When it reaches 0, forecast endpoints return 422 `data_too_old`.

## The `ForecastPeriod` object (used everywhere)

```json
{ "period_start": "2026-10-05", "period_label": "5 – 11 Oct 2026",
  "p10": 64.0, "p50": 81.0, "p90": 101.3,          // p10 is null for months
  "min_qty": 62, "safe_qty": 105, "service_level": 0.95,
  "revenue_p50": 326.55, "revenue_p90": 408.31, "revenue_min": 249.84, "revenue_safe": 423.12,
  "horizon_confidence": "Medium" }                  // High (wk 1-4) | Medium (5-12) | Planning estimate (13-26)
```
- `p50` expected; `p10`–`p90` likely range (8 in 10); `min_qty` = 90% sure at least this many sell;
  `safe_qty` = enough to cover demand at `service_level`.
- Totals across several rows (`machine_total`, `fleet_total`, `next_weeks`) use the same shape, with
  `min_qty`/`safe_qty` for the **total** (at the service level, default 0.9) plus `sum_of_safe_qty`
  (if every row were stocked at its own safe level).

## Endpoints

### Public
| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/health` (also `/api/v1/health`) | – | `{status: ok\|loading\|error, models: {version, sklearn_match, forecast_matches_notebook, …}, warnings}` |
| POST | `/auth/login` | `{username, password}` | `{token, name, expires_at}` |
| POST | `/admin/upload/{ticket}` | multipart `files` (up to 10 `.xlsx`, ≤ 50 MB each) | UploadReport (below) |

### System
| GET | `/auth/me` | – | `{name, username, avatar, expires_at}` |
|---|---|---|---|
| GET | `/meta` | – | `{data_start, data_end, forecast_start, current_week_start, data_age_weeks, max_horizon_weeks, max_horizon_months, model_version, trained_until, default_service_levels, allowed_service_levels, currency, revenue_note, named_sales_share}` |
| GET | `/home/summary` | – | `{next_week_revenue_p50, next_month_revenue_p50, next_month_label, machines, low_confidence_machines, products, model_version, trained_until, next_weeks: ForecastPeriod[]}` |

| PUT | `/auth/profile` | `{display_name (1-60), avatar: "avatar-1".."avatar-8" \| null}` | `{name, avatar}` – the name and avatar shown in the app |
| POST | `/auth/password` | `{current_password, new_password (8-200)}` | `{ok: true}` – 422 `wrong_password` if the current one is wrong. Stored as a salted hash in `data/state/profile.json`; until changed, `.env` is used |
| GET | `/forecast/missed` | `app` (app1\|app2a), optional `asset_id` (app2a) | `{app, asset_id, weeks: [{period_start, period_label, horizon_confidence, expected, revenue_expected}]}` – expected sales for weeks that have passed but have no real sales in the data yet (between the data end and the current week) |
| GET | `/history/fleet` | `app` (app1\|app2a), `granularity` (week\|month), `weeks` (1-160, default 12) or `months` (1-60 complete months, default 24), optional `asset_id` (app2a: one machine) | weekly: `{weeks: [{week_start, units, revenue}]}`; monthly: `{months: [{period_start, period_label, units, revenue}]}` – actual sales for the charts. Monthly values spread each week evenly over its days, and only months fully covered by the data are returned |

### App 1 – Warehouse demand
| GET | `/app1/products` | common | `{granularity, periods: [{period_start, period_label, horizon_confidence}], items: [{item, ptype, priority, class, price_recent, first: ForecastPeriod, sparkline: number[]}]}` |
|---|---|---|---|
| GET | `/app1/forecast` | `item` + common | `{key, item, granularity, priority, class, ptype, price_recent, history: [{week_start, units}] (last 12 weeks), periods: ForecastPeriod[]}` |
| GET | `/app1/summary` | common + `cut_step` | `{cut_step, periods: [{period_label, expected, minimum, safe, safe_normal, revenue_expected, revenue_safe, by_priority: {High\|Medium\|Low: {safe, revenue_safe}}}], saved_vs_step0: {units, revenue, pct_units, pct_revenue}, changed_items: [{item, priority, normal_qty, cut_qty}], items: [{item, priority, class, quantities[], normal_quantities[]}], rules}` |

Cut steps (High priority is never cut): 0 normal; 1 Low → minimum; 2 also Medium → 80% cover; 3 also Medium → minimum.

### App 2a – Machine totals
| GET | `/app2a/summary` | common | `{granularity, machines, periods: [{period_start, period_label, horizon_confidence, expected, minimum, safe, revenue_expected, revenue_safe}]}` – fleet totals per period |
| GET | `/app2a/machines` | common | `{granularity, periods, machines: [{asset_id, location, confidence, has_product_breakdown, priority, class, price_recent, first, sparkline}]}` |
|---|---|---|---|
| GET | `/app2a/forecast` | `asset_id` + common | ForecastSeries + `{asset_id, location, confidence, has_product_breakdown}` |

`confidence` = how much of the machine's recent sales have product names (High ≤ 20% unnamed, Medium ≤ 50%, Low > 50%). Low-confidence machines report `has_product_breakdown: false`.

### App 2b – Product breakdown (data only)
| GET | `/app2b/machine` | `asset_id` + common | `{asset_id, location, granularity, machine_total: ForecastPeriod[], app2a_total: ForecastPeriod[], products: [{item, ptype, priority, class, price_recent, periods}], note}` |
|---|---|---|---|
| GET | `/app2b/product` | `item` + common | `{item, granularity, fleet_total, machines: [{asset_id, location, priority, class, price_recent, periods}], in_app1}` |

A machine with no product names returns 404 `no_product_breakdown`. Priority in App 2b is ranked within each machine.

### App 3 – New-site recommendations
| GET | `/app3/categories` | – | `{categories: [{name, training_sites}], method}` |
|---|---|---|---|
| POST | `/app3/categorize` | `{text}` | `{categories, matched_keywords, source: keyword\|override\|none}` |
| POST | `/app3/recommend` | `{categories: string[], staff_area: bool, text?: string, top?: int (default 10; null = all)}` | `{meta: {categories, similar_training_sites, overall_confidence, machine_hint, drink_share, fleet_drink_share, method, warning}, best_sellers: Recommendation[], distinctive: Recommendation[]}` |

`Recommendation` = `{rank, item, ptype, price, likelihood_regular_seller (0-1), expected_units_per_machine_week, expected_revenue_per_machine_week, lift_vs_fleet, similar_sites_with_product, confidence}`.
`top` limits both lists (default 10; `null` = all). `distinctive` only holds Medium/High-confidence products.
If `categories` is empty and `text` is given, categories are detected from the text.

### Model information
| GET | `/models/metrics` | – | per app: method, WAPE, MASE, bias, gain vs best baseline, P10–P90 coverage, held-out safe-stock coverage, policy simulation, all models compared; App 3 leave-one-site-out results; approach comparison; data audit |
|---|---|---|---|
| GET | `/models/cards` | – | `{cards: [{app, title, markdown}], datasheet_markdown, feature_dictionary_markdown}` |

### Administration
| Method | Path | Body / params | Returns |
|---|---|---|---|
| POST | `/admin/upload-ticket` | – | `{upload_url, ticket, expires_at, max_file_mb, accepted}` (single use, 10 min) |
| GET | `/admin/uploads/{upload_id}` | – | UploadReport |
| POST | `/admin/retrain` | `{upload_id?: string, mode: "quick"\|"full"}` | `{job_id}` |
| GET | `/admin/jobs` | – | `{jobs: Job[]}` |
| GET | `/admin/jobs/{job_id}` | – | Job (with `log_tail`) – poll every 5 s while running |
| GET | `/admin/models` | – | `{versions: ModelVersion[], active_version}` |
| POST | `/admin/models/{version}/promote` | – | `{active_version}` (also used to roll back) |
| GET | `/admin/monitoring/accuracy` | `app` (app1\|app2a\|app2b), `from`, `to` | `{app, weeks: [{week_start, actual, forecast_p50, safe_qty, wape, within_safe_stock, series, forecast_version}], wape, within_safe_stock, backtest_wape, drift_threshold, drift, note?}` |
| GET / PUT | `/admin/site-categories/keywords` | PUT `{rows: [{category, keyword, applies_to, active, note}]}` (whole table) | `{rows, updated_at}` |
| GET / PUT | `/admin/site-categories/overrides` | PUT `{rows: [{location, categories[], staff_area: bool\|null, note}]}` | `{rows, updated_at}` |
| GET | `/admin/site-categories/review` | – | `{rows: [{location, categories, matched_keywords, source, staff_area, machines, named_sales, used_in_training}], refit_at}` |
| POST | `/admin/site-categories/test` | `{text}` | categories for a name using the saved rule files |
| POST | `/admin/app3/refit` | – | `{status, training_sites, unclassified, categories, refit_at, note}` |

**UploadReport:** `{upload_id, files: [{name, kind, rows, date_min, date_max, replaces_existing, dataset_file}], gap_weeks, overlap_weeks, dropped: {duplicates, partial_weeks, warehouse_test_vends}, unnamed_share, machines: {new, removed, relocated}, errors[], warnings[], can_train}`.

**Job:** `{job_id, mode, status: queued|running|succeeded|failed, step, percent, started_at, finished_at, started_by, upload_id, result_version, error, duration_seconds, comparison, log_tail[]}`.

**ModelVersion:** `{version, trained_at, data_end, mode, status: active|candidate|archived, job_id, metrics: {app1|app2a|app2b: {wape, gain_vs_baseline}, app3: {precision_at_10}}, better_than_active, comparison}`.

## Upload flow (large files go straight to the backend)

1. `POST /admin/upload-ticket` (signed in) → `upload_url`.
2. Browser sends the files to `upload_url` as multipart form data (field name `files`) → UploadReport.
3. If `can_train`, `POST /admin/retrain {upload_id, mode}` → poll `/admin/jobs/{job_id}`.
4. On success the job creates a **candidate** version and copies the uploaded files into `data/dataset`.
   Nothing changes for users until someone makes that version active (`/admin/models/{version}/promote`).

A sales file **replaces** the dataset file of the same year (`CashlessSalesAnalysis-<year>.xlsx`), so
upload full-year exports. A file that would delete earlier sales of that year is rejected.
