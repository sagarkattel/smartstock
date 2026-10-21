# Model Card: App 2b - Product breakdown
*SmartStock v2, Group Sydney 06 (CDU PRT691). Generated 2026-10-08T14:25:12 by the training notebook.*

## Model details
- **Type:** scikit-learn HistGradientBoostingRegressor. Poisson loss for the point forecast (P50); quantile loss for P10 and P90.
- **Granularity:** weekly (Monday to Sunday), machine x product; 1,471 series; 147,613 training rows.
- **Features:** lags (1, 2, 4, 52 weeks), rolling means (4/8/13/26 weeks), rolling std (8 weeks), series age, ISO week, month, plus categorical IDs. Every feature uses only past weeks.
- **Hyperparameters:** {'learning_rate': 0.05, 'max_iter': 300, 'max_leaf_nodes': 63, 'min_samples_leaf': 40, 'l2_regularization': 1.0} (tuned on origins kept separate from evaluation).
- **Forecasting:** recursive. Each week's P50 is fed back as history for the next week.
- **Revenue:** forecast units x recent average price per unit (last 8 weeks, per series). This is cashless revenue only, assuming prices stay unchanged.
- **Final method:** 50% direct model + 50% top-down (product share of last 13 weeks x App 2a machine total). Adopted because it lowered WAPE from 66.2% to 65.1% and was better in 4/4 folds.

## Intended use
- **Purpose:** Weekly and monthly units per product for each machine, shown to route staff, who decide what to restock.
- **Users:** Route staff (restock drivers)
- **Decision support only.** A person reviews and approves every order or restock. Not for automatic ordering.

## Training and evaluation data
- Weekly unit sales per machine-product pair (current machine list, history restarted at relocation, at least 30 transactions and 15 active days).
- Window: 2023-09-04 to 2026-08-30 (complete weeks only).

## Evaluation (rolling-origin backtest: 4 folds x 4 weeks ahead, recursive)
| Metric | Value |
|---|---|
| WAPE | 65.1% |
| MASE (vs in-sample naive) | 0.973 |
| MAE | 1.304 units/week |
| MAE gain vs best baseline (Moving avg (4 wk)) | 9.3% |
| Bias (+ = over-forecast) | 2.6% |
| Actuals within P10-P90 (target 80%) | 74.1% |
| Actuals at or below P90 (target 90%) | 89.2% |

**Stocking-policy simulation (backtest weeks):** stocking to P90 gives a stockout rate of 4.7%, carrying 2.38x demand. A flat +20% gives 16.1% at 1.48x demand.

**Most influential features (permutation importance):** rm_4, asset, item, lag_1, rm_26.

**Priority and stocking quantities:** 879 High / 382 Medium / 210 Low (ABC-XYZ). Quantities use the **conformal** band (chosen on held-out coverage error: raw 6.2% vs conformal 1.1%). On held-out weeks, the 90% minimum held in 90.6% of cases and safe stock at 90% in 88.5%. Cut ladder: step 1 (Low at minimum) changes total stock by -4.5%, and step 3 (Low and Medium at minimum) by -18.1%. High-priority stockouts stay at 6.2%.

**26-week stability check** (point forecasts from 3 origins, WAPE for weeks 5-26): 2025-09-01: 75.0%; 2025-12-01: 76.0%; 2026-03-02: 73.8%. The recursive model was the most accurate method at every origin (vs moving average and scaled seasonal naive).

## Limitations and risks
- Trained on **realised cashless sales**. Demand during stockouts is unseen (censored), and cash sales are not included.
- No weather, academic calendar or promotion data.
- The monthly P90 assumes independent weekly errors, so it may understate the true range.
- Recursive forecasts become less accurate further ahead (see the error-by-horizon chart).
- Machines whose sales are mostly unnamed items get an incomplete product list; use the App 2a total for these.

## Ethical considerations
- No personal or customer data is used: only machine, product, time and price.
- **Fairness:** error is reported by volume band and machine type so that under-served segments are visible. Low-confidence machines are flagged in the interface rather than excluded.
- **Oversight:** quantities are recommendations. The client approves or overrides them.
