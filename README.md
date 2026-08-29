# Production Running Dashboard

Upload an Excel production schedule, and show **what's running right now** on
screens across the warehouse. Every screen updates the moment a new sheet is
uploaded — no touching the TVs.

## What it does

- **Excel in, dashboard out** — drag & drop your existing `.xlsx` / `.xls` /
  `.csv` schedule into the admin panel. No fixed template: you tag the columns
  directly on the sheet preview (click a tag, then click the column) to say
  which one is the date, start/end time, machine and product, and tick exactly
  which columns and rows should appear on screens. A header-row picker handles
  sheets where the titles aren't on the first row.
- **Screen fleet** — create one entry per physical screen (e.g. *Packing Line 1*,
  *Goods In*). Each gets its own URL to open on that TV. Screens can be filtered
  to a line/area column so each one only shows what's relevant there.
- **Allergen flagging** — built for food production: tag your sheet's
  allergen column and any run with allergens gets a bright hazard-yellow
  **⚠ ALLERGEN** badge naming them (e.g. "⚠ ALLERGEN: GLUTEN, MILK") on its
  card or table row. Values like "None" or blank don't flag.
- **Cell tags → info cards** — create your own tags (each gets a colour),
  hit *Select cells* and click any individual cells on the sheet to add them.
  Each tag renders as a card across the top of the screens showing its cells'
  values, in the order you set with ▲▼. Values are re-read from the same
  cells on every upload.
- **Machine board** — when a machine/line column is mapped, screens show one
  column per machine with that machine's jobs listed by time: the job running
  right now is highlighted green, upcoming ones are marked **Queued**, and
  finished ones fade out. A classic table layout is available per screen too.
- **Live status** — statuses are worked out from the screen's own clock, so
  they roll over as the day progresses. Long table lists rotate through pages
  automatically.
- **Branding** — company name, logo upload, accent colour, dark or light theme.
- **Instant updates** — uploading a new sheet (or changing any setting) pushes
  the change to every connected screen within a second, with a polling fallback.

## Running locally

```bash
npm install
npm start            # http://localhost:3000/admin
npm run sample       # generates sample/sample-schedule.xlsx to try it with
```

## Deploying on Railway

1. Create a new Railway project → **Deploy from GitHub repo** and pick this
   repository. Railway detects Node and uses `railway.json` automatically.
2. **Attach a volume** (service → right-click → *Attach Volume*), mount path
   `/data`, and set the environment variable `DATA_DIR=/data`.
   Without a volume, the uploaded schedule, logo and screen setup are lost on
   every redeploy/restart.
3. Set `ADMIN_PASSWORD` to protect the admin panel (recommended — the screens
   themselves never need a password).
4. Generate a public domain (service → Settings → Networking → Generate Domain).

| Variable | Purpose | Default |
|---|---|---|
| `ADMIN_PASSWORD` | Password for `/admin` (unset = open access) | *(unset)* |
| `DATA_DIR` | Where uploads/config are stored — point at the volume | `./data` |
| `PORT` | Listen port (Railway sets this) | `3000` |

## Setting up the warehouse screens

1. Open `https://your-app.up.railway.app/admin`, upload a schedule, and check
   the column tags on the preview (date / start / end / machine / product are
   auto-guessed — click a tag, then a column, to correct them). Untick any
   columns or rows you don't want on screens.
2. In **Screens**, add a screen per TV, set its filter (e.g. `Line = Line 1`),
   and copy its URL.
3. On each TV's device (smart TV browser, Chromecast, Raspberry Pi, mini PC…),
   open the screen URL and put the browser in kiosk/full-screen mode, e.g.:

   ```bash
   chromium --kiosk https://your-app.up.railway.app/screen/packing-line-1
   ```

4. To change what's running: just upload the new Excel sheet. Done.

## Excel format

Any tabular sheet works — first row with content is treated as headers. Handy
columns to have: a **date** column (`29/08/2026`, `2026-08-29`, `Aug 29` …),
**start** and **end** time columns (`06:00`, `6:00 AM`, Excel time cells), and
whatever else you want to show (product, order number, quantity, line, notes).
If the workbook has several sheets, pick the right one after uploading.
