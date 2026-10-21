# SmartStock Backend

FastAPI service that serves the SmartStock forecasts and recommendations to the frontend for
**A to Z Vending** (CDU PRT691, Group Sydney 06). It loads the models trained by the notebook
`training/SmartStock_v2_Training.ipynb`, forecasts from the **current week**, and adds priority, safe-stock,
revenue and cut-step rules on request. It also handles the single login, data uploads, retraining,
model versions, accuracy monitoring and the App 3 site-category rules.

> SmartStock recommends; people decide. Nothing here places orders or changes stock.

## Contents

```
SmartStock Backend/
├─ app/                     the API
│  ├─ main.py               routes, auth check, error format, CORS, security headers
│  ├─ forecasting.py        forecast engine (Apps 1, 2a, 2b): window from today, priority, service level, cut steps
│  ├─ services.py           builds every response
│  ├─ app3.py               new-site recommendations + editable category rules + refit
│  ├─ store.py              model versions on disk, loading, promotion
│  ├─ jobs.py               retraining jobs (runs the training notebook as a script)
│  ├─ uploads.py            one-time upload links, file checks, validation report
│  ├─ monitoring.py         forecast vs actual for later weeks
│  ├─ auth.py               single login, signed expiring tokens, sign-in rate limit
│  ├─ calendar_utils.py     current week (Australia/Sydney), labels, horizon confidence
│  └─ config.py / errors.py settings from .env; error shape
├─ smartstock_core.py       shared with the notebook (features, recursive forecast, calibration, App 3 rules)
├─ models/
│  ├─ active.json           which version is live
│  └─ versions/20261008-initial-full/   the trained models + evaluation + model cards
├─ training/
│  ├─ SmartStock_v2_Training.ipynb      the notebook (same one used in Colab)
│  ├─ smartstock_training.py            script version, used by retraining jobs
│  └─ notebook_to_script.py             regenerate the script after editing the notebook
├─ data/
│  ├─ dataset/              put the Excel exports here (needed only for retraining)
│  ├─ config/               App 3 keyword and override CSVs (created on first start)
│  └─ uploads/ jobs/ state/ dataset_backups/   created automatically
├─ scripts/import_version.py   add a version trained in Colab
├─ tests/test_api.py        end-to-end API tests (pytest)
├─ API.md                   endpoint reference
├─ requirements.txt  .env.example  run.sh
```

## 1. Set up (macOS)

Needs **Python 3.11 or newer** (`python3 --version`; if older, install from python.org or `brew install python@3.13`).

```bash
cd "~/Downloads/AI Practice files/SmartStock Backend"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then edit .env: set SMARTSTOCK_PASSWORD and SMARTSTOCK_SECRET_KEY
```

Generate a secret key with `python -c "import secrets; print(secrets.token_hex(32))"`.

## 2. Run

```bash
./run.sh                      # or: uvicorn app.main:app --port 8000
```

- Health: http://localhost:8000/health → `"status": "ok"` after a few seconds (models load in the background).
  `forecast_matches_notebook` should be `true` for every app, and `sklearn_match` should be `true`.
- Interactive docs: **http://localhost:8000/docs** (sign in with `/auth/login`, then "Authorize" with the token).

Quick check from a terminal:

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s localhost:8000/api/v1/meta -H "Authorization: Bearer $TOKEN"
curl -s "localhost:8000/api/v1/app2a/machines?horizon=4" -H "Authorization: Bearer $TOKEN" | head -c 600
```

## 3. Connect the frontend (Next.js)

The frontend's server side forwards browser requests to this API and adds the token.

- In the frontend `.env.local`: `SMARTSTOCK_API_URL=http://localhost:8000/api/v1`.
- Here, in `.env`: `SMARTSTOCK_CORS_ORIGINS=http://localhost:3000` (the frontend address) and
  `SMARTSTOCK_PUBLIC_BASE_URL=http://localhost:8000`. These are needed because data uploads go straight from
  the browser to this server through a one-time link.
- Endpoints and response shapes: see **API.md** (or /docs). Errors are always `{"detail", "code"}`.

## 4. How the forecasts work

- On start, the active version's models run the same recursive forecast as the notebook for the 26 weeks after
  the data ends (App 2b is then combined with the App 2a machine totals). `/health` confirms the result is
  identical to the notebook's own forecast.
- Each request takes the part of that window that starts at the **current week** (Australia/Sydney). Horizon:
  1–12 weeks or 1–6 complete months, limited to what is left of the 26 weeks. When the data is too old, upload
  new data and retrain.
- Rules applied per request: priority (ABC-XYZ, within each machine for App 2b), service level (High 95%,
  Medium 90%, Low 80%, or an override), the calibration chosen by the notebook (raw or conformal), minimum
  and safe stock, revenue = units × recent price (cashless only, current prices), and App 1 cut steps.
- **Demo tip:** set `SMARTSTOCK_TODAY=2026-09-01` in `.env` to show the forecasts as if the data were brand
  new (full 12 weeks / 6 months and "High" confidence for the first 4 weeks). Leave it empty in normal use.

## 5. Retraining and model versions

1. Put the Excel exports in `data/dataset/` (`CashlessMachines.xlsx`, `CashlessSalesAnalysis-<year>.xlsx`),
   or upload them in the app (Administration → Upload data).
2. Start a job (Upload data screen or `POST /api/v1/admin/retrain`):
   - **Full retrain:** the whole notebook, including the parameter search (about 10–25 min, depending on the computer).
   - **Quick update:** the same pipeline but reuses the current tuned parameters and skips the search.
     It is somewhat faster, mainly because a job that uses the same files again skips re-reading the Excel exports.
3. A successful job creates a **candidate** version with its metrics compared with the active one. Make it active
   (or roll back to any earlier version) in Administration → Model versions. Users see a change only then.
4. Retraining uses the current App 3 rule files, so keyword edits are also applied to the next model.

Trained in Colab instead? Copy the notebook's `smartstock_v2` output folder to this computer and run
`python scripts/import_version.py "/path/to/smartstock_v2" --activate`, then restart the server.
Colab's scikit-learn and pandas versions must match `requirements.txt` (check with `pip show scikit-learn pandas`).

Edited the notebook? Run `python training/notebook_to_script.py` so retraining jobs use the new version.

## 6. App 3 site-category rules

`data/config/site_category_keywords.csv` (Category, Keyword, Applies_to, Active, Note) and
`site_category_overrides.csv` (Location, Categories separated by `|`, Staff_area, Note) can be edited in the app
(Administration → Site-category rules) or directly. Then **Refit App 3** (seconds) applies them; the review
table shows every location with its categories and the matching keywords. Changes to staff-area keywords
(placement notes) apply at the next retraining, because placement notes are not kept after training.

## 7. Security and privacy

- **Profile (name, avatar, password):** can be changed in the app (Settings > Profile). It is stored in `data/state/profile.json`;
  the password is kept as a salted PBKDF2 hash. Until someone changes it, `SMARTSTOCK_PASSWORD` from `.env` is the password.
  To reset a forgotten password, delete `data/state/profile.json` (the `.env` password applies again).
- One login, set in `.env`. Tokens are signed (HMAC-SHA256) and expire (`SMARTSTOCK_TOKEN_HOURS`); five wrong
  passwords in a minute block sign-in for a minute.
- The machine "Place" notes (door codes, phone numbers) are dropped during training and never stored, returned or
  logged. Upload checks discard them too.
- Uploads: `.xlsx` only, size-limited, single-use links that expire after 10 minutes.
- **Do not commit client data.** `.gitignore` excludes `.env`, `data/dataset`, uploads, jobs and backups.
  `models/` contains forecasts and location names derived from client data, so keep any repository private.

## 8. Testing

```bash
pytest -q                     # end-to-end API tests (about a minute)
```

The tests sign in, call every endpoint, and check the error format, the service-level override, cut steps,
App 3, rule editing, refit and the single-use upload link. Retraining is not part of the tests because it takes
several minutes; try it once from the app, or with `POST /api/v1/admin/retrain {"mode":"quick"}`.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `/health` shows `sklearn_match: false` or loading fails | install the scikit-learn / pandas versions in requirements.txt, or retrain on this computer |
| 422 `data_too_old` | the newest sales are more than 26 weeks old: upload new exports and retrain |
| Upload rejected "would REPLACE the existing … file" | upload the full-year export for that year, not a partial one |
| 409 `job_running` | wait for the current job (Administration → Retraining jobs) |
| Browser upload blocked (CORS) | add the frontend address to `SMARTSTOCK_CORS_ORIGINS` |
| Sessions end after every restart | set `SMARTSTOCK_SECRET_KEY` in `.env` |
