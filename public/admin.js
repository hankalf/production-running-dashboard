/* Admin panel: upload the schedule, tag columns directly on the sheet
 * preview, pick which columns/rows show on screens, manage the screen
 * fleet and branding. Talks to the JSON API in server.js. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let state = { config: null, screens: [], schedule: null };

  // Column roles the dashboard understands. Applied by clicking a chip,
  // then clicking a column in the preview grid.
  const ROLES = [
    { key: 'dateCol', label: 'Date', cls: 'role-date' },
    { key: 'startCol', label: 'Start time', cls: 'role-start' },
    { key: 'endCol', label: 'End time', cls: 'role-end' },
    { key: 'machineCol', label: 'Machine / line', cls: 'role-machine' },
    { key: 'titleCol', label: 'Item / product', cls: 'role-title' }
  ];
  const PREVIEW_MAX = 500;

  let armedRole = null;          // role key currently being "painted"
  let excluded = new Set();      // row indices hidden from screens

  /* -------------------------------------------------------------- api */

  async function api(url, options) {
    const res = await fetch(url, options);
    let body = {};
    try { body = await res.json(); } catch {}
    if (res.status === 401) { showLogin(); throw new Error(body.error || 'Not logged in'); }
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  }

  function setStatus(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = 'status-line' + (cls ? ' ' + cls : '');
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
  }

  /* ------------------------------------------------------------ login */

  function showLogin() {
    $('loginView').hidden = false;
    $('adminView').hidden = true;
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('loginPassword').value })
      });
      $('loginError').hidden = true;
      init();
    } catch (err) {
      $('loginError').textContent = err.message;
      $('loginError').hidden = false;
    }
  });

  /* ------------------------------------------------------------- tabs */

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.hidden = p.id !== 'tab-' + btn.dataset.tab;
      });
    });
  });

  /* ----------------------------------------------------------- upload */

  async function uploadFile(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setStatus('uploadStatus', `Uploading “${file.name}”…`);
    try {
      const body = await api('/api/upload', { method: 'POST', body: form });
      state.schedule = body.schedule;
      state.config = body.config;
      excluded = new Set(body.schedule.excluded || []);
      setStatus('uploadStatus',
        `Loaded ${body.schedule.rows.length} rows from “${body.schedule.filename}”. All screens updated.`, 'ok');
      renderSchedule();
      renderScreens();
    } catch (err) {
      setStatus('uploadStatus', err.message, 'error');
    }
  }

  const dropZone = $('dropZone');
  $('browseBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', () => {
    uploadFile($('fileInput').files[0]);
    $('fileInput').value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('over'); }));
  dropZone.addEventListener('drop', (e) => uploadFile(e.dataTransfer.files[0]));

  async function reparse() {
    const headerVal = $('headerRowPicker').value;
    try {
      const body = await api('/api/select-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: $('sheetPicker').value,
          headerRow: headerVal === '' ? null : Number(headerVal)
        })
      });
      state.schedule = body.schedule;
      state.config = body.config;
      excluded = new Set(body.schedule.excluded || []);
      renderSchedule();
      renderScreens();
    } catch (err) {
      setStatus('uploadStatus', err.message, 'error');
    }
  }
  $('sheetPicker').addEventListener('change', () => {
    $('headerRowPicker').value = ''; // new sheet: back to auto-detect
    reparse();
  });
  $('headerRowPicker').addEventListener('change', reparse);

  /* ------------------------------------------------- save view setup */

  let saveTimer = null;
  function saveViewSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const body = await api('/api/mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mapping: { ...state.config.mapping, dateFormat: $('mapDateFormat').value },
            displayColumns: state.config.displayColumns,
            excluded: [...excluded]
          })
        });
        state.config = body.config;
        if (body.schedule) state.schedule = body.schedule;
        setStatus('mappingStatus', 'Saved — screens updated.', 'ok');
      } catch (err) {
        setStatus('mappingStatus', err.message, 'error');
      }
    }, 500);
  }

  $('mapDateFormat').addEventListener('change', saveViewSoon);

  /* ------------------------------------------------------ role chips */

  function roleFor(header) {
    return ROLES.find((r) => state.config.mapping[r.key] === header) || null;
  }

  function renderChips() {
    const wrap = $('roleChips');
    wrap.innerHTML = '';
    for (const role of ROLES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip ${role.cls}` + (armedRole === role.key ? ' armed' : '');
      const assigned = state.config.mapping[role.key];
      chip.innerHTML = '';
      const name = document.createElement('span');
      name.textContent = role.label;
      chip.appendChild(name);
      const target = document.createElement('span');
      target.className = 'chip-target';
      target.textContent = assigned ? `→ ${assigned}` : 'click, then click a column';
      chip.appendChild(target);
      chip.addEventListener('click', () => {
        armedRole = armedRole === role.key ? null : role.key;
        renderChips();
        $('previewTable').classList.toggle('painting', !!armedRole);
      });
      wrap.appendChild(chip);
    }
  }

  function assignRole(header) {
    const m = state.config.mapping;
    const role = armedRole;
    if (!role) return false;
    // Clicking the column that already has this role removes it.
    m[role] = m[role] === header ? '' : header;
    // A column can hold only one role.
    for (const r of ROLES) {
      if (r.key !== role && m[r.key] === header && m[role] === header) m[r.key] = '';
    }
    armedRole = null;
    $('previewTable').classList.remove('painting');
    saveViewSoon();
    renderChips();
    renderGrid();
    return true;
  }

  /* ----------------------------------------------------- preview grid */

  function renderSchedule() {
    const s = state.schedule;
    const has = !!(s && s.headers && s.headers.length);
    $('previewCard').hidden = !has;
    $('parseOptions').hidden = !s;
    if (!s) return;

    // Sheet picker
    const picker = $('sheetPicker');
    picker.innerHTML = '';
    for (const name of s.sheetNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      picker.appendChild(opt);
    }
    picker.value = s.sheet;
    picker.parentElement.hidden = s.sheetNames.length < 2;

    // Header row picker: Auto + the sheet's first rows
    const hp = $('headerRowPicker');
    hp.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Auto-detect';
    hp.appendChild(auto);
    const maxRow = Math.max(Math.min(s.sheetRowCount || 20, 20), s.headerRow + 1);
    for (let i = 0; i < maxRow; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Row ${i + 1}`;
      hp.appendChild(opt);
    }
    hp.value = String(s.headerRow);

    if (has) {
      $('mapDateFormat').value = state.config.mapping.dateFormat || 'auto';
      renderChips();
      renderGrid();
    }
    renderCells();
  }

  function renderSummary() {
    const s = state.schedule;
    const shownRows = s.rows.length - excluded.size;
    $('selectionSummary').textContent =
      `Showing ${state.config.displayColumns.length} of ${s.headers.length} columns · ` +
      `${shownRows} of ${s.rows.length} rows on screens`;
  }

  function renderGrid() {
    const s = state.schedule;
    const cfg = state.config;
    const scroll = document.querySelector('.table-scroll.tall');
    const keepTop = scroll ? scroll.scrollTop : 0;
    const keepLeft = scroll ? scroll.scrollLeft : 0;

    const table = $('previewTable');
    table.innerHTML = '';
    const colShown = (h) => cfg.displayColumns.includes(h);

    /* header */
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');

    const corner = document.createElement('th');
    corner.className = 'corner';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.title = 'Show / hide all rows';
    allCb.checked = excluded.size === 0;
    allCb.addEventListener('change', () => {
      excluded = allCb.checked ? new Set() : new Set(s.rows.map((_, i) => i));
      saveViewSoon();
      renderGrid();
    });
    corner.appendChild(allCb);
    tr.appendChild(corner);

    s.headers.forEach((h) => {
      const th = document.createElement('th');
      const role = roleFor(h);
      th.className = (role ? role.cls : '') + (colShown(h) ? '' : ' col-off');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.title = 'Show this column on screens';
      cb.checked = colShown(h);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        cfg.displayColumns = cb.checked
          ? [...cfg.displayColumns, h].filter((c, i, a) => a.indexOf(c) === i)
          : cfg.displayColumns.filter((c) => c !== h);
        // Keep spreadsheet order.
        cfg.displayColumns.sort((a, b) => s.headers.indexOf(a) - s.headers.indexOf(b));
        saveViewSoon();
        renderGrid();
      });
      th.appendChild(cb);

      const name = document.createElement('span');
      name.className = 'col-name';
      name.textContent = h;
      th.appendChild(name);

      if (role) {
        const tag = document.createElement('span');
        tag.className = 'role-tag ' + role.cls;
        tag.textContent = role.label;
        tag.title = 'Click to remove this tag';
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          cfg.mapping[role.key] = '';
          saveViewSoon();
          renderChips();
          renderGrid();
        });
        th.appendChild(tag);
      }

      th.addEventListener('click', () => assignRole(h));
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    /* body */
    const tbody = document.createElement('tbody');
    s.rows.slice(0, PREVIEW_MAX).forEach((row, i) => {
      const trb = document.createElement('tr');
      if (excluded.has(i)) trb.className = 'row-off';

      const tdCb = document.createElement('td');
      tdCb.className = 'row-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.title = 'Show this row on screens';
      cb.checked = !excluded.has(i);
      cb.addEventListener('change', () => {
        if (cb.checked) excluded.delete(i); else excluded.add(i);
        trb.classList.toggle('row-off', !cb.checked);
        allCb.checked = excluded.size === 0;
        saveViewSoon();
        renderSummary();
      });
      tdCb.appendChild(cb);
      trb.appendChild(tdCb);

      s.headers.forEach((h) => {
        const td = document.createElement('td');
        const role = roleFor(h);
        td.className = (role ? role.cls : '') + (colShown(h) ? '' : ' col-off');
        td.textContent = String(row[h] ?? '');
        td.addEventListener('click', () => assignRole(h));
        trb.appendChild(td);
      });
      tbody.appendChild(trb);
    });
    table.appendChild(tbody);

    if (s.rows.length > PREVIEW_MAX) {
      const note = document.createElement('tfoot');
      const trf = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = s.headers.length + 1;
      td.className = 'muted';
      td.textContent = `Preview shows the first ${PREVIEW_MAX} of ${s.rows.length} rows. All ticked rows still appear on screens.`;
      trf.appendChild(td);
      note.appendChild(trf);
      table.appendChild(note);
    }

    renderSummary();
    if (scroll) { scroll.scrollTop = keepTop; scroll.scrollLeft = keepLeft; }
  }

  /* ------------------------------------------------------ named cells */

  const colLetter = (c) => {
    let s = '';
    c += 1;
    while (c > 0) { c -= 1; s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26); }
    return s;
  };
  const cellRef = (r, c) => colLetter(c) + (r + 1);

  let pendingCell = null; // {r, c} awaiting a name

  let cellsTimer = null;
  function saveCellsSoon() {
    clearTimeout(cellsTimer);
    cellsTimer = setTimeout(async () => {
      try {
        const body = await api('/api/cells', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cells: state.config.cells })
        });
        state.config = body.config;
        setStatus('mappingStatus', 'Saved — screens updated.', 'ok');
      } catch (err) {
        setStatus('mappingStatus', err.message, 'error');
      }
    }, 500);
  }

  function gridValue(r, c) {
    const g = (state.schedule && state.schedule.grid) || [];
    return String((g[r] || [])[c] ?? '');
  }

  function openCellNamer(r, c) {
    pendingCell = { r, c };
    $('cellNamer').hidden = false;
    $('cellNamerRef').textContent = cellRef(r, c);
    const v = gridValue(r, c);
    $('cellNamerValue').textContent = v ? `currently “${v}”` : 'currently empty';
    $('cellNamerInput').value = '';
    $('cellNamerInput').focus();
    renderCellGrid();
  }

  function closeCellNamer() {
    pendingCell = null;
    $('cellNamer').hidden = true;
    renderCellGrid();
  }

  function addPendingCell() {
    if (!pendingCell) return;
    const name = $('cellNamerInput').value.trim() || cellRef(pendingCell.r, pendingCell.c);
    state.config.cells.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      r: pendingCell.r,
      c: pendingCell.c,
      show: true
    });
    closeCellNamer();
    saveCellsSoon();
    renderCells();
  }

  $('cellNamerAdd').addEventListener('click', addPendingCell);
  $('cellNamerCancel').addEventListener('click', closeCellNamer);
  $('cellNamerInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPendingCell(); }
    if (e.key === 'Escape') closeCellNamer();
  });

  function renderCellList() {
    const list = $('cellList');
    list.innerHTML = '';
    if (!state.config.cells.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No tiles yet — open the sheet below and click a cell to add one.';
      list.appendChild(p);
      return;
    }
    for (const cell of state.config.cells) {
      const row = document.createElement('div');
      row.className = 'cell-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.title = 'Show this tile on screens';
      cb.checked = cell.show !== false;
      cb.addEventListener('change', () => { cell.show = cb.checked; saveCellsSoon(); });
      row.appendChild(cb);

      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'cell-name';
      name.value = cell.name;
      name.maxLength = 60;
      name.addEventListener('change', () => {
        cell.name = name.value.trim() || cellRef(cell.r, cell.c);
        saveCellsSoon();
      });
      row.appendChild(name);

      const ref = document.createElement('span');
      ref.className = 'cell-ref';
      ref.textContent = cellRef(cell.r, cell.c);
      row.appendChild(ref);

      const val = document.createElement('span');
      val.className = 'cell-value';
      const v = gridValue(cell.r, cell.c);
      val.textContent = v || '(empty)';
      row.appendChild(val);

      // Order on the screens = order in this list.
      const idx = state.config.cells.indexOf(cell);
      const up = document.createElement('button');
      up.className = 'btn small';
      up.textContent = '▲';
      up.title = 'Move up (earlier on screens)';
      up.disabled = idx === 0;
      up.addEventListener('click', () => {
        const cells = state.config.cells;
        [cells[idx - 1], cells[idx]] = [cells[idx], cells[idx - 1]];
        saveCellsSoon();
        renderCells();
      });
      row.appendChild(up);

      const down = document.createElement('button');
      down.className = 'btn small';
      down.textContent = '▼';
      down.title = 'Move down (later on screens)';
      down.disabled = idx === state.config.cells.length - 1;
      down.addEventListener('click', () => {
        const cells = state.config.cells;
        [cells[idx], cells[idx + 1]] = [cells[idx + 1], cells[idx]];
        saveCellsSoon();
        renderCells();
      });
      row.appendChild(down);

      const del = document.createElement('button');
      del.className = 'btn small danger';
      del.textContent = 'Remove';
      del.addEventListener('click', () => {
        state.config.cells = state.config.cells.filter((x) => x !== cell);
        saveCellsSoon();
        renderCells();
      });
      row.appendChild(del);

      list.appendChild(row);
    }
  }

  function renderCellGrid() {
    const s = state.schedule;
    const table = $('cellGrid');
    table.innerHTML = '';
    if (!s || !s.grid || !s.grid.length) return;
    const named = new Map(state.config.cells.map((cell) => [cell.r + ':' + cell.c, cell]));
    const cols = s.grid.reduce((m, r) => Math.max(m, r.length), 0);

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.appendChild(document.createElement('th'));
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th');
      th.textContent = colLetter(c);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    s.grid.forEach((rowCells, r) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = r + 1;
      tr.appendChild(th);
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td');
        td.textContent = String(rowCells[c] ?? '');
        const cell = named.get(r + ':' + c);
        if (cell) {
          td.className = 'named';
          td.title = `Tile “${cell.name}” — click to remove`;
        }
        if (pendingCell && pendingCell.r === r && pendingCell.c === c) {
          td.classList.add('pending');
        }
        td.addEventListener('click', () => {
          if (cell) {
            state.config.cells = state.config.cells.filter((x) => x !== cell);
            saveCellsSoon();
            renderCells();
          } else {
            openCellNamer(r, c);
          }
        });
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function renderCells() {
    $('cellsCard').hidden = !(state.schedule && state.schedule.grid && state.schedule.grid.length);
    if ($('cellsCard').hidden) return;
    renderCellList();
    renderCellGrid();
  }

  /* ---------------------------------------------------------- screens */

  $('addScreenBtn').addEventListener('click', async () => {
    try {
      const body = await api('/api/screens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: $('newScreenName').value })
      });
      $('newScreenName').value = '';
      state.screens = body.screens;
      renderScreens();
    } catch (err) {
      alert(err.message);
    }
  });

  async function saveScreen(id, patch) {
    const body = await api('/api/screens/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    state.screens = body.screens;
  }

  function distinctValues(col) {
    const seen = new Set();
    for (const row of state.schedule ? state.schedule.rows : []) {
      const v = String(row[col] ?? '').trim();
      if (v) seen.add(v);
      if (seen.size >= 200) break;
    }
    return [...seen].sort();
  }

  function renderScreens() {
    const list = $('screenList');
    list.innerHTML = '';
    if (!state.screens.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No screens yet — add your first one above.';
      list.appendChild(p);
      return;
    }
    for (const screen of state.screens) list.appendChild(screenCard(screen));
  }

  function screenCard(screen) {
    const card = document.createElement('div');
    card.className = 'card screen-card';
    const url = `${location.origin}/screen/${screen.slug}`;

    const head = document.createElement('div');
    head.className = 'screen-head';
    const title = document.createElement('h2');
    title.textContent = screen.name;
    const actions = document.createElement('div');
    actions.className = 'screen-actions';

    const urlEl = document.createElement('span');
    urlEl.className = 'screen-url';
    urlEl.textContent = url;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn small';
    copyBtn.textContent = 'Copy URL';
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); copyBtn.textContent = 'Copied!'; }
      catch { prompt('Copy this URL:', url); }
      setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 2000);
    });

    const openBtn = document.createElement('button');
    openBtn.className = 'btn small';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => window.open(url, '_blank'));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete screen “${screen.name}”?`)) return;
      const body = await api('/api/screens/' + screen.id, { method: 'DELETE' });
      state.screens = body.screens;
      renderScreens();
    });

    actions.append(copyBtn, openBtn, delBtn);
    head.append(title, urlEl, actions);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'mapping-grid';

    // Rename
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Screen name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = screen.name;
    nameInput.addEventListener('change', async () => {
      await saveScreen(screen.id, { name: nameInput.value });
      renderScreens();
    });
    nameLabel.appendChild(nameInput);
    grid.appendChild(nameLabel);

    // Filter column
    const filterLabel = document.createElement('label');
    filterLabel.textContent = 'Filter by column';
    const filterSel = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— show everything —';
    filterSel.appendChild(noneOpt);
    for (const h of state.schedule ? state.schedule.headers : []) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      filterSel.appendChild(opt);
    }
    filterSel.value = screen.filterCol || '';
    filterSel.addEventListener('change', async () => {
      await saveScreen(screen.id, { filterCol: filterSel.value, filterValues: [] });
      renderScreens();
    });
    filterLabel.appendChild(filterSel);
    grid.appendChild(filterLabel);

    // Layout
    const layoutLabel = document.createElement('label');
    layoutLabel.textContent = 'Layout';
    const layoutSel = document.createElement('select');
    for (const [value, text] of [
      ['auto', 'Auto (machine columns when a machine column is set)'],
      ['machines', 'Machine columns'],
      ['table', 'Table']
    ]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      layoutSel.appendChild(opt);
    }
    layoutSel.value = screen.layout || 'auto';
    layoutSel.addEventListener('change', () => saveScreen(screen.id, { layout: layoutSel.value }));
    layoutLabel.appendChild(layoutSel);
    grid.appendChild(layoutLabel);

    // Toggles
    const todayLabel = document.createElement('label');
    todayLabel.className = 'check-label';
    const todayCb = document.createElement('input');
    todayCb.type = 'checkbox';
    todayCb.checked = screen.todayOnly;
    todayCb.addEventListener('change', () => saveScreen(screen.id, { todayOnly: todayCb.checked }));
    todayLabel.append(todayCb, document.createTextNode(" Only show today's rows"));
    grid.appendChild(todayLabel);

    const doneLabel = document.createElement('label');
    doneLabel.className = 'check-label';
    const doneCb = document.createElement('input');
    doneCb.type = 'checkbox';
    doneCb.checked = screen.hideCompleted;
    doneCb.addEventListener('change', () => saveScreen(screen.id, { hideCompleted: doneCb.checked }));
    doneLabel.append(doneCb, document.createTextNode(' Hide finished runs'));
    grid.appendChild(doneLabel);

    const tilesLabel = document.createElement('label');
    tilesLabel.className = 'check-label';
    const tilesCb = document.createElement('input');
    tilesCb.type = 'checkbox';
    tilesCb.checked = screen.showTiles !== false;
    tilesCb.addEventListener('change', () => saveScreen(screen.id, { showTiles: tilesCb.checked }));
    tilesLabel.append(tilesCb, document.createTextNode(' Show info tiles'));
    grid.appendChild(tilesLabel);

    card.appendChild(grid);

    // Filter values
    if (screen.filterCol && state.schedule) {
      const values = distinctValues(screen.filterCol);
      const h3 = document.createElement('h3');
      h3.textContent = `Show only these “${screen.filterCol}” values (none ticked = show all)`;
      card.appendChild(h3);
      const wrap = document.createElement('div');
      wrap.className = 'filter-values';
      for (const v of values) {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = v;
        cb.checked = screen.filterValues.includes(v);
        cb.addEventListener('change', () => {
          const ticked = [...wrap.querySelectorAll('input:checked')].map((c) => c.value);
          saveScreen(screen.id, { filterValues: ticked });
        });
        label.append(cb, document.createTextNode(' ' + v));
        wrap.appendChild(label);
      }
      card.appendChild(wrap);
    }

    // Per-screen column override
    if (state.schedule) {
      const h3 = document.createElement('h3');
      h3.textContent = 'Columns on this screen (none ticked = use defaults)';
      card.appendChild(h3);
      const wrap = document.createElement('div');
      wrap.className = 'check-grid';
      for (const h of state.schedule.headers) {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = h;
        cb.checked = screen.columns.includes(h);
        cb.addEventListener('change', () => {
          const ticked = [...wrap.querySelectorAll('input:checked')].map((c) => c.value);
          saveScreen(screen.id, { columns: ticked });
        });
        label.append(cb, document.createTextNode(' ' + h));
        wrap.appendChild(label);
      }
      card.appendChild(wrap);
    }

    return card;
  }

  /* --------------------------------------------------------- branding */

  function renderBranding() {
    const b = state.config.branding;
    $('brandName').value = b.companyName || '';
    $('brandColor').value = /^#[0-9a-f]{6}$/i.test(b.primaryColor) ? b.primaryColor : '#f59e0b';
    $('brandTheme').value = b.theme || 'dark';
    $('brandClock').checked = b.showClock !== false;
    const img = $('brandLogoPreview');
    if (b.logoFile) {
      img.src = '/logo?v=' + Date.now();
      img.hidden = false;
      $('removeLogoBtn').hidden = false;
    } else {
      img.hidden = true;
      $('removeLogoBtn').hidden = true;
    }
  }

  let removeLogo = false;
  $('removeLogoBtn').addEventListener('click', () => {
    removeLogo = true;
    $('brandLogoPreview').hidden = true;
    $('removeLogoBtn').hidden = true;
    setStatus('brandingStatus', 'Logo will be removed when you save.');
  });

  $('saveBrandingBtn').addEventListener('click', async () => {
    const form = new FormData();
    form.append('companyName', $('brandName').value);
    form.append('primaryColor', $('brandColor').value);
    form.append('theme', $('brandTheme').value);
    form.append('showClock', String($('brandClock').checked));
    if (removeLogo) form.append('removeLogo', 'true');
    const logo = $('logoInput').files[0];
    if (logo) form.append('logo', logo);
    try {
      const body = await api('/api/branding', { method: 'POST', body: form });
      state.config = body.config;
      removeLogo = false;
      $('logoInput').value = '';
      renderBranding();
      setStatus('brandingStatus', 'Saved. Screens updated.', 'ok');
    } catch (err) {
      setStatus('brandingStatus', err.message, 'error');
    }
  });

  /* ------------------------------------------------------------- init */

  async function init() {
    const body = await api('/api/admin-state');
    state = body;
    excluded = new Set((state.schedule && state.schedule.excluded) || []);
    $('loginView').hidden = true;
    $('adminView').hidden = false;
    renderSchedule();
    renderScreens();
    renderBranding();
  }

  (async () => {
    try {
      const session = await api('/api/session');
      if (session.authed) await init();
      else showLogin();
    } catch (err) {
      showLogin();
      if (!/log in/i.test(err.message || '')) {
        $('loginError').textContent = err.message;
        $('loginError').hidden = false;
      }
    }
  })();
})();
