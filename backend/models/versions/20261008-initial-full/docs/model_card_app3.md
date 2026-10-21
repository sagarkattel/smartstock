# Model Card: App 3 - New-site product recommendations
*SmartStock v2, Group Sydney 06 (CDU PRT691). Generated 2026-10-08T14:25:12.*

## Model details
- **Task:** rank currently active products for a *new* site, given its site categories.
- **Selected method:** Category profile (chosen by leave-one-site-out evaluation against popularity and category-profile baselines).
- **Site categories:** derived automatically from location names by the editable keyword rules in `config/site_category_keywords.csv`, with per-location fixes in `config/site_category_overrides.csv`. Reviewed through `app3_site_categories_review.csv`. Multi-label, plus a *Staff area* flag from placement notes. 15 categories in total.
- **Target:** units per machine per week **while the product was stocked** at the site. *Regular seller* means at least 1 unit per machine-week.

## Intended use
- **Purpose:** decide what to stock first in a new machine, and which machine type suits a site (drink share of the expected best-sellers compared with the fleet average). Two lists are shown: *expected best-sellers* and *distinctive for this site type* (highest lift against the fleet average). Products stocked at fewer than 3 sites are not recommended.
- **Users:** operations manager.
- **Decision support only.** The first weeks of real sales should replace these estimates (App 2a/2b take over).

## Data
- 60 sites with at least 500 named-product sales and at least 10 stocked products; 3,071 site-product rows; 156 products.
- Training sites per category: Office & corporate 14, Staff area 9, Sports & fitness 8, Transport & transit 8, Other / unclassified 6, Education 6, Automotive 5, Hospitality & clubs 5, Retail 3, Healthcare & aged care 3, Industrial & logistics 3, Construction site 2, Student accommodation 1, Car park & storage 1.

## Evaluation (leave-one-site-out)
| Metric | Category profile |
|---|---|
| Precision@10 | 0.51 (random: 0.20) |
| NDCG@10 | 0.74 |
| Spearman rank correlation | 0.41 |
| AUC (regular seller) | 0.75 |

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
