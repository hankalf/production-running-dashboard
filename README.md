# Production Running Dashboard

Upload an Excel production schedule, and show **what's running right now** on
screens across the warehouse. Every screen updates the moment a new sheet is
uploaded — no touching the TVs.

## What it does

- **Excel in, dashboard out** — upload your existing `.xlsx` / `.xls` / `.csv`
  schedule in the admin panel. No fixed template: you tell the dashboard which
  columns hold the date, start time and end time, and which columns to display.
- **Screen fleet** — create one entry per physical screen (e.g. *Packing Line 1*,
  *Goods In*). Each gets its own URL to open on that TV. Screens can be filtered
  to a line/area column so each one only shows what's relevant there.
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
   the column setup (date / start / end columns are auto-guessed).
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
