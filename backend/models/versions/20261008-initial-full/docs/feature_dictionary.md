# Feature dictionary (SmartStock v2)
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
