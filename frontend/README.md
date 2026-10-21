# SmartStock Frontend

Next.js (App Router, JavaScript) + Tailwind CSS frontend for the SmartStock FastAPI backend
(`../SmartStock_Backend`). Screens: Warehouse (App 1), Machines (App 2a/2b), New Installations (App 3).

## Run it

1. **Start the backend** (see its README; needs its own Python virtualenv):

   ```bash
   cd ../SmartStock_Backend
   python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
   ./run.sh                      # http://localhost:8000, wait for /health to say "ok"
   ```

2. **Start the frontend:**

   ```bash
   cp .env.example .env.local    # SMARTSTOCK_API_URL=http://localhost:8000/api/v1
   npm install
   npm run dev                   # http://localhost:3000
   ```

3. Sign in with the username and password from the **backend's** `.env` (`SMARTSTOCK_USERNAME` / `SMARTSTOCK_PASSWORD`).

## How it talks to the backend

- The browser never calls the backend. It calls this app's own routes, which add the session token:
  - `POST /api/auth/sign-in` → backend `/auth/login`; the token is kept in an **httpOnly cookie**.
  - `GET|POST /api/backend/<path>` → backend `/api/v1/<path>` (only the data endpoints the screens use).
- All page and API paths live in `config/paths.js`; server settings in `server/env.js`.
- Data hooks (TanStack Query, cached 5 min) are in `lib/queries.js`; every screen shows loading, error and retry states.
- The horizon picker follows the backend's limits from `/meta` (`max_horizon_weeks` / `max_horizon_months`).
- Detail pages have readable addresses: `/warehouse/mount-everest-water`, `/machines/castle-hill-tafe-100900`,
  `/machines/castle-hill-tafe-100900/bueno` (`lib/slug.js`, `config/paths.js`). The real product or machine is found again by
  looking the slug up in the cached lists (`lib/resolve.js`). Old-style addresses (an encoded name, a bare asset ID) still work and
  move to the readable address.
- Colour themes are CSS variable sets in `app/globals.css`, chosen in Settings > Appearance (`lib/theme.js`).

## Settings (side menu, above Logout)

- **General:** the data in use; upload new sales Excel files (checked before anything changes); start a Quick update or Full retrain and watch its progress; switch to the new model (or roll back) with a confirmation.
  Uploads go straight from the browser to the backend's one-time upload link, so the backend's `SMARTSTOCK_CORS_ORIGINS` must include this site's address and `SMARTSTOCK_PUBLIC_BASE_URL` must be reachable from the browser (both in the backend `.env`).
- **Appearance:** Dark, Light, Midnight, Ocean, or match your device. Remembered on this device.
- **Profile:** change the display name, pick one of 8 avatars, change the password. Stored by the backend (`data/state/profile.json`, password hashed).

## Menu

The side menu collapses to icons only (the arrow on its edge); the choice is remembered on this device. On a phone it is a slide-in drawer.

## Real sales, past data and last year in the charts

At the top right of the Forecast overview card there are two switches, for weeks and for months:
- **Show past data:** adds the last 12 weeks (or 6 months) of real sales before the forecast. In the Months view a month that is split between sources is stacked: August is real sales plus the one missing day, October is the missing days plus the weekly forecast for the rest of the month.
- **Compare with last year:** draws the same week (or month) from a year earlier as a dashed line, with a summary of the chosen period against last year. Not available for the Stock value measure.

The Forecast overview chart shows real sales for recent weeks next to the expected values. Weeks that have passed but have no real sales in the data yet (the gap since the last upload) show their expected value as hatched bars; once newer sales are uploaded and the model switched, those weeks show the real sales too. After newer sales are uploaded, the model retrained and switched to, weeks that an older model had forecast also show that earlier forecast against what really sold (Units tab), with the average error.

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm run lint`

## Not built yet (from the requirements spec)

Home summary, Model information, accuracy monitoring page, site-category rules, CSV export on the forecast tables, Units/$ toggle, service-level control, cut steps (App 1 order summary),
"Product across machines" (App 2b), and tests.
