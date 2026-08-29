/* Admin panel: upload the schedule, map columns, manage the screen fleet
 * and branding. Talks to the JSON API in server.js. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let state = { config: null, screens: [], schedule: null };

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
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 5000);
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

  $('uploadBtn').addEventListener('click', async () => {
    const file = $('fileInput').files[0];
    if (!file) return setStatus('uploadStatus', 'Choose a file first.', 'error');
    const form = new FormData();
    form.append('file', file);
    setStatus('uploadStatus', 'Uploading…');
    try {
      const body = await api('/api/upload', { method: 'POST', body: form });
      state.schedule = body.schedule;
      state.config = body.config;
      setStatus('uploadStatus',
        `Loaded ${body.schedule.rows.length} rows from “${body.schedule.filename}”. All screens updated.`, 'ok');
      renderSchedule();
      renderScreens();
    } catch (err) {
      setStatus('uploadStatus', err.message, 'error');
    }
  });

  $('sheetPicker').addEventListener('change', async () => {
    try {
      const body = await api('/api/select-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet: $('sheetPicker').value })
      });
      state.schedule = body.schedule;
      state.config = body.config;
      renderSchedule();
      renderScreens();
    } catch (err) {
      setStatus('uploadStatus', err.message, 'error');
    }
  });

  /* ---------------------------------------------------------- mapping */

  function fillColumnSelect(select, value, allowNone) {
    select.innerHTML = '';
    if (allowNone !== false) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— none —';
      select.appendChild(opt);
    }
    for (const h of state.schedule ? state.schedule.headers : []) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      select.appendChild(opt);
    }
    select.value = value || '';
  }

  function renderSchedule() {
    const s = state.schedule;
    const has = !!(s && s.headers && s.headers.length);
    $('mappingCard').hidden = !has;
    $('previewCard').hidden = !has;
    $('sheetPickerWrap').hidden = !(has && s.sheetNames.length > 1);
    if (!has) return;

    if (s.sheetNames.length > 1) {
      const picker = $('sheetPicker');
      picker.innerHTML = '';
      for (const name of s.sheetNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        picker.appendChild(opt);
      }
      picker.value = s.sheet;
    }

    const m = state.config.mapping;
    fillColumnSelect($('mapDate'), m.dateCol);
    fillColumnSelect($('mapStart'), m.startCol);
    fillColumnSelect($('mapEnd'), m.endCol);
    fillColumnSelect($('mapMachine'), m.machineCol);
    fillColumnSelect($('mapTitle'), m.titleCol);
    $('mapDateFormat').value = m.dateFormat || 'auto';

    const wrap = $('displayCols');
    wrap.innerHTML = '';
    for (const h of s.headers) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = h;
      cb.checked = state.config.displayColumns.includes(h);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + h));
      wrap.appendChild(label);
    }

    $('previewMeta').textContent =
      `“${s.filename}” — sheet “${s.sheet}” — ${s.rows.length} rows — uploaded ${new Date(s.uploadedAt).toLocaleString()}`;
    const table = $('previewTable');
    table.innerHTML = '';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const h of s.headers) {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of s.rows.slice(0, 50)) {
      const tr = document.createElement('tr');
      for (const h of s.headers) {
        const td = document.createElement('td');
        td.textContent = String(row[h] ?? '');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  $('saveMappingBtn').addEventListener('click', async () => {
    const displayColumns = [...$('displayCols').querySelectorAll('input:checked')]
      .map((cb) => cb.value);
    try {
      const body = await api('/api/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapping: {
            dateCol: $('mapDate').value,
            startCol: $('mapStart').value,
            endCol: $('mapEnd').value,
            machineCol: $('mapMachine').value,
            titleCol: $('mapTitle').value,
            dateFormat: $('mapDateFormat').value
          },
          displayColumns
        })
      });
      state.config = body.config;
      setStatus('mappingStatus', 'Saved. Screens updated.', 'ok');
    } catch (err) {
      setStatus('mappingStatus', err.message, 'error');
    }
  });

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
