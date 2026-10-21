# Model Card: App 2a - Machine totals
*SmartStock v2, Group Sydney 06 (CDU PRT691). Generated 2026-10-08T14:25:12 by the training notebook.*

## Model details
- **Type:** scikit-learn HistGradientBoostingRegressor. Poisson loss for the point forecast (P50); quantile loss for P10 and P90.
- **Granularity:** weekly (Monday to Sunday), machine total (all transactions); 108 series; 11,071 training rows.
- **Features:** lags (1, 2, 4, 52 weeks), rolling means (4/8/13/26 weeks), rolling std (8 weeks), series age, ISO week, month, plus categorical IDs. Every feature uses only past weeks.
- **Hyperparameters:** {'learning_rate': 0.05, 'max_iter': 300, 'max_leaf_nodes': 31, 'min_samples_leaf': 40, 'l2_regularization': 1.0} (tuned on origins kept separate from evaluation).
- **Forecasting:** recursive. Each week's P50 is fed back as history for the next week.
- **Revenue:** forecast units x recent average price per unit (last 8 weeks, per series). This is cashless revenue only, assuming prices stay unchanged.
- **Final method:** HGB Poisson (alternatives in `approach_comparison.csv` did not meet the adoption rule).

## Intended use
- **Purpose:** Weekly total units per machine, including unnamed items, for route planning and for machines without product labels.
- **Users:** Route staff and operations manager
- **Decision support only.** A person reviews and approves every order or restock. Not for automatic ordering.

## Training and evaluation data
- Weekly total transactions per machine (all transactions, current machine list, history restarted at relocation).
- Window: 2023-09-04 to 2026-08-30 (complete weeks only).

## Evaluation (rolling-origin backtest: 4 folds x 4 weeks ahead, recursive)
| Metric | Value |
|---|---|
| WAPE | 25.5% |
| MASE (vs in-sample naive) | 0.883 |
| MAE | 12.887 units/week |
| MAE gain vs best baseline (Moving avg (4 wk)) | 17.1% |
| Bias (+ = over-forecast) | 1.1% |
| Actuals within P10-P90 (target 80%) | 69.1% |
| Actuals at or below P90 (target 90%) | 85.9% |

**Stocking-policy simulation (backtest weeks):** stocking to P90 gives a stockout rate of 12.5%, carrying 1.37x demand. A flat +20% gives 21.9% at 1.22x demand.

**Most influential features (permutation importance):** lag_1, asset, lag_52, rm_4, rm_13.

**Priority and stocking quantities:** 72 High / 18 Medium / 18 Low (ABC-XYZ). Quantities use the **raw** band (chosen on held-out coverage error: raw 2.8% vs conformal 3.6%). On held-out weeks, the 90% minimum held in 89.1% of cases and safe stock at 90% in 85.6%. Cut ladder: step 1 (Low at minimum) changes total stock by -4.1%, and step 3 (Low and Medium at minimum) by -11.0%. High-priority stockouts stay at 8.6%.

**26-week stability check** (point forecasts from 3 origins, WAPE for weeks 5-26): 2025-09-01: 35.9%; 2025-12-01: 38.6%; 2026-03-02: 33.2%. The recursive model was the most accurate method at every origin (vs moving average and scaled seasonal naive).

## Limitations and risks
- Trained on **realised cashless sales**. Demand during stockouts is unseen (censored), and cash sales are not included.
- No weather, academic calendar or promotion data.
- The monthly P90 assumes independent weekly errors, so it may understate the true range.
- Recursive forecasts become less accurate further ahead (see the error-by-horizon chart).
- Gives a total only, not a product mix.

## Ethical considerations
- No personal or customer data is used: only machine, product, time and price.
- **Fairness:** error is reported by volume band and machine type so that under-served segments are visible. Low-confidence machines are flagged in the interface rather than excluded.
- **Oversight:** quantities are recommendations. The client approves or overrides them.
