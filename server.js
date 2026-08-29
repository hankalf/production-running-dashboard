/*
 * Production Running Dashboard
 *
 * - Admin uploads an Excel production schedule and maps its columns.
 * - Screens across the warehouse each get a URL (/screen/<slug>) showing
 *   what is running today / right now, filtered per screen.
 * - Uploading a new sheet pushes an update to every connected screen (SSE).
 *
 * Storage is plain JSON files in DATA_DIR (mount a Railway volume there).
 */

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_ROWS = 2000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------------------------------------------------------- storage */

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

const DEFAULT_CONFIG = {
  branding: {
    companyName: 'Production Dashboard',
    primaryColor: '#f59e0b',
    theme: 'dark',
    logoFile: '',
    showClock: true
  },
  mapping: {
    dateCol: '',
    startCol: '',
    endCol: '',
    machineCol: '',
    titleCol: '',
    dateFormat: 'auto'
  },
  displayColumns: [],
  cells: [] // named single cells shown as info tiles: {id, name, r, c, show}
};

const getConfig = () => {
  const cfg = readJson('config.json', null);
  if (!cfg) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return {
    branding: { ...DEFAULT_CONFIG.branding, ...(cfg.branding || {}) },
    mapping: { ...DEFAULT_CONFIG.mapping, ...(cfg.mapping || {}) },
    displayColumns: Array.isArray(cfg.displayColumns) ? cfg.displayColumns : [],
    cells: Array.isArray(cfg.cells) ? cfg.cells : []
  };
};
const setConfig = (cfg) => writeJson('config.json', cfg);
const getScreens = () => readJson('screens.json', []);
const setScreens = (s) => writeJson('screens.json', s);
const getSchedule = () => readJson('schedule.json', null);
const setSchedule = (s) => writeJson('schedule.json', s);

/* ------------------------------------------------------------------- auth */

const AUTH_SALT = 'prd-dash-v1';
const authToken = () =>
  crypto.createHash('sha256').update(ADMIN_PASSWORD + '|' + AUTH_SALT).digest('hex');

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function isAuthed(req) {
  if (!ADMIN_PASSWORD) return true;
  return getCookie(req, 'pd_auth') === authToken();
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not authorised. Log in first.' });
}

/* ------------------------------------------------------------- Excel load */

const pad2 = (n) => String(n).padStart(2, '0');

// Normalise a parsed cell into a display/parse-friendly primitive.
function normCell(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const y = v.getFullYear();
    const dateStr = `${y}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    const timeStr = `${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
    if (y <= 1900) return timeStr; // Excel time-only cell (epoch-era date)
    if (timeStr === '00:00' && v.getSeconds() === 0) return dateStr;
    return `${dateStr} ${timeStr}`;
  }
  if (typeof v === 'number') {
    if (v > 0 && v < 1) {
      const mins = Math.round(v * 24 * 60); // Excel time fraction
      return `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`;
    }
    return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  }
  return String(v).trim();
}

function parseWorkbookFile(filePath, sheetName, headerRow) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = wb.SheetNames;
  const sheet = sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  // blankrows kept so row numbers line up with what Excel shows.
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
    header: 1,
    defval: '',
    blankrows: true
  });

  // Header row: caller's choice (0-based), or the first row with at
  // least 2 non-empty cells.
  let headerIdx;
  if (Number.isInteger(headerRow) && headerRow >= 0 && headerRow < aoa.length) {
    headerIdx = headerRow;
  } else {
    headerIdx = aoa.findIndex(
      (r) => r.filter((c) => String(c).trim() !== '').length >= 2
    );
    if (headerIdx < 0) headerIdx = 0;
  }

  const headerCells = (aoa[headerIdx] || []).map((h, i) => {
    const name = String(normCell(h)).trim();
    return name || `Column ${i + 1}`;
  });
  // De-duplicate header names so rows keyed by header don't collide.
  const seen = {};
  const headers = headerCells.map((h) => {
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h} (${seen[h]})` : h;
  });

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length && rows.length < MAX_ROWS; i++) {
    const cells = aoa[i];
    if (!cells.some((c) => String(c).trim() !== '')) continue;
    const row = {};
    headers.forEach((h, c) => { row[h] = normCell(cells[c]); });
    rows.push(row);
  }

  // Raw cell grid (capped) so single cells can be picked and named in
  // the admin, and their values re-read on every upload.
  const gridCols = Math.min(
    aoa.reduce((m, r) => Math.max(m, r.length), 0), 40);
  const grid = aoa.slice(0, 200).map((r) => {
    const out = [];
    for (let c = 0; c < gridCols; c++) out.push(normCell(r[c]));
    return out;
  });

  return {
    sheetNames, sheet, headers, rows, grid,
    headerRow: headerIdx, sheetRowCount: aoa.length
  };
}

// Guess column roles from header names after an upload.
function guessMapping(headers, mapping) {
  const find = (patterns) =>
    headers.find((h) => patterns.some((p) => h.toLowerCase().includes(p))) || '';
  const next = { ...mapping };
  if (!headers.includes(next.dateCol)) next.dateCol = find(['date', 'day']);
  if (!headers.includes(next.startCol)) next.startCol = find(['start', 'from', 'begin']);
  if (!headers.includes(next.endCol)) next.endCol = find(['end', 'finish', 'to', 'until']);
  if (!headers.includes(next.machineCol)) {
    next.machineCol = find(['machine', 'line', 'cell', 'area', 'work cent', 'workcent', 'resource']);
  }
  if (!headers.includes(next.titleCol)) {
    next.titleCol = find(['product', 'item', 'job', 'description', 'sku', 'order']);
  }
  return next;
}

/* -------------------------------------------------------------------- SSE */

let sseClients = [];

function broadcast(type) {
  const msg = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
  sseClients = sseClients.filter((res) => {
    try { res.write(msg); return true; } catch { return false; }
  });
}

setInterval(() => broadcast('ping'), 25000).unref();

/* ------------------------------------------------------------- middleware */

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

/* ------------------------------------------------------------------ pages */

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/screen/:slug', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'screen.html')));

app.get('/logo', (req, res) => {
  const { logoFile } = getConfig().branding;
  const file = logoFile && path.join(UPLOAD_DIR, path.basename(logoFile));
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

/* ------------------------------------------------------------------- auth */

app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.json({ ok: true, open: true });
  if ((req.body.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.setHeader('Set-Cookie',
    `pd_auth=${authToken()}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) =>
  res.json({ authed: isAuthed(req), passwordRequired: !!ADMIN_PASSWORD }));

/* -------------------------------------------------------------- admin API */

app.get('/api/admin-state', requireAuth, (req, res) => {
  res.json({ config: getConfig(), screens: getScreens(), schedule: getSchedule() });
});

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const stored = path.join(UPLOAD_DIR, 'schedule.xlsx');
  fs.writeFileSync(stored, req.file.buffer);
  let parsed;
  try {
    parsed = parseWorkbookFile(stored, req.body.sheet);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read that file as a spreadsheet: ' + e.message });
  }
  const schedule = {
    ...parsed,
    excluded: [],
    filename: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  setSchedule(schedule);

  const cfg = getConfig();
  cfg.mapping = guessMapping(parsed.headers, cfg.mapping);
  cfg.displayColumns = cfg.displayColumns.filter((c) => parsed.headers.includes(c));
  if (!cfg.displayColumns.length) cfg.displayColumns = parsed.headers.slice(0, 6);
  setConfig(cfg);

  broadcast('update');
  res.json({ schedule, config: cfg });
});

app.post('/api/select-sheet', requireAuth, (req, res) => {
  const stored = path.join(UPLOAD_DIR, 'schedule.xlsx');
  const prev = getSchedule();
  if (!prev || !fs.existsSync(stored)) {
    return res.status(400).json({ error: 'Upload a spreadsheet first' });
  }
  let parsed;
  try {
    const headerRow = Number.isInteger(req.body.headerRow) ? req.body.headerRow : undefined;
    parsed = parseWorkbookFile(stored, req.body.sheet, headerRow);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const schedule = { ...prev, ...parsed, excluded: [] };
  setSchedule(schedule);
  const cfg = getConfig();
  cfg.mapping = guessMapping(parsed.headers, cfg.mapping);
  cfg.displayColumns = cfg.displayColumns.filter((c) => parsed.headers.includes(c));
  if (!cfg.displayColumns.length) cfg.displayColumns = parsed.headers.slice(0, 6);
  setConfig(cfg);
  broadcast('update');
  res.json({ schedule, config: cfg });
});

app.post('/api/mapping', requireAuth, (req, res) => {
  const cfg = getConfig();
  const { mapping, displayColumns, excluded } = req.body;
  if (mapping) cfg.mapping = { ...cfg.mapping, ...mapping };
  if (Array.isArray(displayColumns)) cfg.displayColumns = displayColumns.map(String);
  setConfig(cfg);
  let schedule = getSchedule();
  if (Array.isArray(excluded) && schedule) {
    schedule.excluded = [...new Set(
      excluded.filter((i) => Number.isInteger(i) && i >= 0 && i < schedule.rows.length)
    )].sort((a, b) => a - b);
    setSchedule(schedule);
  }
  broadcast('update');
  res.json({ config: cfg, schedule });
});

app.post('/api/cells', requireAuth, (req, res) => {
  const cfg = getConfig();
  if (!Array.isArray(req.body.cells)) {
    return res.status(400).json({ error: 'cells must be an array' });
  }
  cfg.cells = req.body.cells
    .filter((cell) => cell && Number.isInteger(cell.r) && Number.isInteger(cell.c)
      && cell.r >= 0 && cell.c >= 0)
    .slice(0, 50)
    .map((cell) => ({
      id: String(cell.id || crypto.randomUUID()),
      name: String(cell.name || '').trim().slice(0, 60) || 'Untitled',
      r: cell.r,
      c: cell.c,
      show: cell.show !== false
    }));
  setConfig(cfg);
  broadcast('update');
  res.json({ config: cfg });
});

app.post('/api/branding', requireAuth, upload.single('logo'), (req, res) => {
  const cfg = getConfig();
  const b = cfg.branding;
  for (const key of ['companyName', 'primaryColor', 'theme']) {
    if (req.body[key] !== undefined) b[key] = String(req.body[key]).slice(0, 200);
  }
  if (req.body.showClock !== undefined) b.showClock = req.body.showClock === 'true';
  if (req.body.removeLogo === 'true') {
    if (b.logoFile) { try { fs.unlinkSync(path.join(UPLOAD_DIR, b.logoFile)); } catch {} }
    b.logoFile = '';
  }
  if (req.file) {
    const ext = (path.extname(req.file.originalname) || '.png').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
      return res.status(400).json({ error: 'Logo must be an image file' });
    }
    const name = 'logo' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.file.buffer);
    b.logoFile = name;
  }
  setConfig(cfg);
  broadcast('update');
  res.json({ config: cfg });
});

/* ---------------------------------------------------------- screens fleet */

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  || 'screen';

app.post('/api/screens', requireAuth, (req, res) => {
  const screens = getScreens();
  const name = String(req.body.name || '').trim() || `Screen ${screens.length + 1}`;
  let slug = slugify(name);
  while (screens.some((s) => s.slug === slug)) slug += '-' + Math.floor(Math.random() * 900 + 100);
  const screen = {
    id: crypto.randomUUID(),
    name,
    slug,
    filterCol: '',
    filterValues: [],
    columns: [],
    layout: 'auto',
    todayOnly: true,
    hideCompleted: false,
    showTiles: true,
    createdAt: new Date().toISOString()
  };
  screens.push(screen);
  setScreens(screens);
  broadcast('update');
  res.json({ screen, screens });
});

app.put('/api/screens/:id', requireAuth, (req, res) => {
  const screens = getScreens();
  const screen = screens.find((s) => s.id === req.params.id);
  if (!screen) return res.status(404).json({ error: 'Screen not found' });
  const b = req.body;
  if (b.name !== undefined) screen.name = String(b.name).trim().slice(0, 100) || screen.name;
  if (b.filterCol !== undefined) screen.filterCol = String(b.filterCol);
  if (Array.isArray(b.filterValues)) screen.filterValues = b.filterValues.map(String);
  if (Array.isArray(b.columns)) screen.columns = b.columns.map(String);
  if (['auto', 'machines', 'table'].includes(b.layout)) screen.layout = b.layout;
  if (b.todayOnly !== undefined) screen.todayOnly = !!b.todayOnly;
  if (b.hideCompleted !== undefined) screen.hideCompleted = !!b.hideCompleted;
  if (b.showTiles !== undefined) screen.showTiles = !!b.showTiles;
  setScreens(screens);
  broadcast('update');
  res.json({ screen, screens });
});

app.delete('/api/screens/:id', requireAuth, (req, res) => {
  const screens = getScreens().filter((s) => s.id !== req.params.id);
  setScreens(screens);
  broadcast('update');
  res.json({ screens });
});

/* ------------------------------------------------------------ screen feed */

app.get('/api/screen-data/:slug', (req, res) => {
  const config = getConfig();
  const screens = getScreens();
  const screen = screens.find((s) => s.slug === req.params.slug);
  if (!screen) return res.status(404).json({ error: 'Unknown screen. Check the URL or set it up in the admin panel.' });

  const schedule = getSchedule();
  const excluded = new Set((schedule && schedule.excluded) || []);
  let rows = schedule ? schedule.rows.filter((_, i) => !excluded.has(i)) : [];
  if (screen.filterCol && screen.filterValues.length) {
    rows = rows.filter((r) =>
      screen.filterValues.includes(String(r[screen.filterCol] ?? '')));
  }
  const columns = (screen.columns.length ? screen.columns : config.displayColumns)
    .filter((c) => !schedule || schedule.headers.includes(c));

  // Named single cells -> info tiles, values re-read from the current sheet.
  const grid = (schedule && schedule.grid) || [];
  const tiles = screen.showTiles === false ? [] :
    config.cells
      .filter((cell) => cell.show !== false)
      .map((cell) => ({
        id: cell.id,
        name: cell.name,
        value: String((grid[cell.r] || [])[cell.c] ?? '')
      }));

  res.json({
    branding: config.branding,
    mapping: config.mapping,
    screen,
    columns,
    headers: schedule ? schedule.headers : [],
    rows,
    tiles,
    uploadedAt: schedule ? schedule.uploadedAt : null,
    filename: schedule ? schedule.filename : null
  });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('data: {"type":"hello"}\n\n');
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter((c) => c !== res); });
});

/* ------------------------------------------------------------------ start */

app.listen(PORT, () => {
  console.log(`Production dashboard running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (!ADMIN_PASSWORD) {
    console.log('WARNING: no ADMIN_PASSWORD set - the admin panel is open to anyone with the URL.');
  }
});
