# Model Card: App 1 - Warehouse demand
*SmartStock v2, Group Sydney 06 (CDU PRT691). Generated 2026-10-08T14:25:12 by the training notebook.*

## Model details
- **Type:** scikit-learn HistGradientBoostingRegressor. Poisson loss for the point forecast (P50); quantile loss for P10 and P90.
- **Granularity:** weekly (Monday to Sunday), product (fleet-wide); 156 series; 22,640 training rows.
- **Features:** lags (1, 2, 4, 52 weeks), rolling means (4/8/13/26 weeks), rolling std (8 weeks), series age, ISO week, month, plus categorical IDs. Every feature uses only past weeks.
- **Hyperparameters:** {'learning_rate': 0.1, 'max_iter': 300, 'max_leaf_nodes': 31, 'min_samples_leaf': 40, 'l2_regularization': 1.0} (tuned on origins kept separate from evaluation).
- **Forecasting:** recursive. Each week's P50 is fed back as history for the next week.
- **Revenue:** forecast units x recent average price per unit (last 8 weeks, per series). This is cashless revenue only, assuming prices stay unchanged.
- **Final method:** HGB Poisson **with price features** (recent price, recent price change; future prices held at today's level). Adopted because it lowered WAPE from 26.2% to 25.7% and was better in 3/4 folds.

## Intended use
- **Purpose:** Weekly and monthly warehouse purchase quantities per product.
- **Users:** Operations manager / purchasing
- **Decision support only.** A person reviews and approves every order or restock. Not for automatic ordering.

## Training and evaluation data
- Fleet-wide weekly unit sales per product (named items only, products with at least 200 transactions, active in the last 8 weeks).
- Window: 2023-09-04 to 2026-08-30 (complete weeks only).

## Evaluation (rolling-origin backtest: 4 folds x 4 weeks ahead, recursive)
| Metric | Value |
|---|---|
| WAPE | 25.7% |
| MASE (vs in-sample naive) | 0.717 |
| MAE | 5.068 units/week |
| MAE gain vs best baseline (Moving avg (4 wk)) | 5.1% |
| Bias (+ = over-forecast) | 1.6% |
| Actuals within P10-P90 (target 80%) | 78.8% |
| Actuals at or below P90 (target 90%) | 88.3% |

**Stocking-policy simulation (backtest weeks):** stocking to P90 gives a stockout rate of 8.8%, carrying 1.45x demand. A flat +20% gives 20.4% at 1.25x demand.

**Most influential features (permutation importance):** lag_1, item, rm_26, rm_4, lag_2.

**Priority and stocking quantities:** 101 High / 18 Medium / 37 Low (ABC-XYZ). Quantities use the **raw** band (chosen on held-out coverage error: raw 2.6% vs conformal 6.6%). On held-out weeks, the 90% minimum held in 95.8% of cases and safe stock at 90% in 90.8%. Cut ladder: step 1 (Low at minimum) changes total stock by -3.2%, and step 3 (Low and Medium at minimum) by -9.4%. High-priority stockouts stay at 5.1%.

**26-week stability check** (point forecasts from 3 origins, WAPE for weeks 5-26): 2025-09-01: 34.6%; 2025-12-01: 47.0%; 2026-03-02: 61.0%. The recursive model was most accurate at 2 of 3 origins. Where it lost (2026-03-02, to Moving avg (4 wk)), the fleet was shrinking sharply (machines removed in early 2026), a structural break that lag features adapt to slowly.

## Limitations and risks
- Trained on **realised cashless sales**. Demand during stockouts is unseen (censored), and cash sales are not included.
- No weather, academic calendar or promotion data.
- The monthly P90 assumes independent weekly errors, so it may understate the true range.
- Recursive forecasts become less accurate further ahead (see the error-by-horizon chart).
- ~44% of transactions have no item name, so product-level totals undercount true fleet demand.

## Ethical considerations
- No personal or customer data is used: only machine, product, time and price.
- **Fairness:** error is reported by volume band and machine type so that under-served segments are visible. Low-confidence machines are flagged in the interface rather than excluded.
- **Oversight:** quantities are recommendations. The client approves or overrides them.
