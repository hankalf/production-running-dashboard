/* Warehouse display screen. Fetches its config + rows, re-renders on a
 * timer (statuses move with the clock) and instantly when the server
 * broadcasts an update (new Excel upload, branding or screen change). */
(function () {
  'use strict';

  const U = window.ScheduleUtils;
  const slug = decodeURIComponent(location.pathname.split('/').pop());
  const $ = (id) => document.getElementById(id);

  let data = null;
  let page = 0;
  let pageCount = 1;
  let lastError = null;

  /* ------------------------------------------------------------ fetch */

  async function refresh() {
    try {
      const res = await fetch(`/api/screen-data/${encodeURIComponent(slug)}`, {
        cache: 'no-store'
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      data = body;
      lastError = null;
    } catch (e) {
      lastError = e.message;
    }
    render();
  }

  /* ----------------------------------------------------------- render */

  function applyBranding(b) {
    document.body.dataset.theme = b.theme === 'light' ? 'light' : 'dark';
    document.documentElement.style.setProperty('--accent', b.primaryColor || '#f59e0b');
    $('companyName').textContent = b.companyName || '';
    const logo = $('logo');
    if (b.logoFile) {
      logo.src = '/logo?v=' + encodeURIComponent(b.logoFile);
      logo.hidden = false;
    } else {
      logo.hidden = true;
    }
    $('clock').style.display = b.showClock === false ? 'none' : '';
  }

  function visibleRows(now) {
    const { rows, mapping, screen } = data;
    const fmt = mapping.dateCol
      ? U.resolveDateFormat(rows, mapping.dateCol, mapping.dateFormat)
      : null;
    const today = U.todayStr(now);
    const out = [];
    for (const row of rows) {
      if (screen.todayOnly && mapping.dateCol) {
        const d = U.parseDate(row[mapping.dateCol], fmt);
        if (d && d !== today) continue;
      }
      const status = U.rowStatus(row, mapping, now);
      if (screen.hideCompleted && status === 'done') continue;
      out.push({ row, status });
    }
    // Keep sheet order but float running rows' sort stable: sort by start time
    // when we have one, otherwise leave the sheet's own order alone.
    if (mapping.startCol) {
      out.sort((a, b) => {
        const ta = U.parseTime(a.row[mapping.startCol]);
        const tb = U.parseTime(b.row[mapping.startCol]);
        if (ta == null || tb == null) return 0;
        return ta - tb;
      });
    }
    return out;
  }

  function showMessage(title, text) {
    $('board').innerHTML = '';
    const el = $('message');
    el.hidden = false;
    el.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = title;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(text));
    $('pageDots').innerHTML = '';
    pageCount = 1;
  }

  function render() {
    const now = new Date();
    $('clock').textContent =
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    $('dateLine').textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    if (!data) {
      if (lastError) showMessage('Screen unavailable', lastError);
      return;
    }

    applyBranding(data.branding);
    $('screenName').textContent = data.screen.name;
    renderTiles();
    $('updatedLine').textContent = data.uploadedAt
      ? `Schedule: ${data.filename || 'uploaded'} — updated ${new Date(data.uploadedAt).toLocaleString()}`
      : '';

    if (!data.rows.length) {
      showMessage('No schedule loaded',
        data.uploadedAt
          ? 'The uploaded schedule has no rows for this screen.'
          : 'Upload a production schedule in the admin panel to get started.');
      return;
    }

    const items = visibleRows(now);
    if (!items.length) {
      showMessage('Nothing scheduled',
        data.screen.todayOnly
          ? 'No production runs match this screen for today.'
          : 'No production runs match this screen.');
      return;
    }

    $('message').hidden = true;
    const layout = data.screen.layout || 'auto';
    const useMachines =
      layout === 'machines' || (layout !== 'table' && data.mapping.machineCol);
    if (useMachines) renderMachines(items);
    else renderTable(items);
  }

  // Named-cell cards, in the order set in the admin panel.
  function renderTiles() {
    const wrap = $('tiles');
    const tiles = (data.tiles || []).filter((t) => String(t.value).trim() !== '');
    wrap.hidden = tiles.length === 0;
    wrap.innerHTML = '';
    for (const t of tiles) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const label = document.createElement('div');
      label.className = 'tile-label';
      label.textContent = t.name;
      const value = document.createElement('div');
      value.className = 'tile-value';
      value.textContent = t.value;
      tile.append(label, value);
      wrap.appendChild(tile);
    }
  }

  /* ------------------------------------------- machine columns layout */

  function renderMachines(items) {
    const { mapping, screen } = data;
    const machineCol = mapping.machineCol;

    // Which machines, in which order: the screen's ticked filter values if
    // it filters on the machine column, otherwise the spreadsheet's own
    // order (items are time-sorted, so don't derive order from them).
    let machines;
    if (screen.filterCol === machineCol && screen.filterValues.length) {
      machines = screen.filterValues.slice(0, 8);
    } else {
      machines = [];
      const shownRows = new Set(items.map((it) => it.row));
      for (const row of data.rows) {
        if (!shownRows.has(row)) continue;
        const m = String(row[machineCol] ?? '').trim() || '—';
        if (!machines.includes(m)) machines.push(m);
        if (machines.length >= 8) break;
      }
    }

    const groups = new Map(machines.map((m) => [m, []]));
    for (const it of items) {
      const m = String(it.row[machineCol] ?? '').trim() || '—';
      if (groups.has(m)) groups.get(m).push(it);
    }

    // Fields for the job cards: mapped title column (or first suitable
    // display column) as the headline, the rest as a meta line.
    const columns = data.columns.length ? data.columns : data.headers;
    const skip = new Set([machineCol, mapping.dateCol, mapping.startCol, mapping.endCol]);
    const titleCol =
      (mapping.titleCol && data.headers.includes(mapping.titleCol) && mapping.titleCol) ||
      columns.find((c) => !skip.has(c)) || columns[0];
    const metaCols = columns.filter((c) => !skip.has(c) && c !== titleCol);

    const board = $('board');
    board.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'machine-grid';
    grid.style.gridTemplateColumns = `repeat(${machines.length || 1}, 1fr)`;

    const colHeight = board.clientHeight - window.innerHeight * 0.06;
    const cardHeight = window.innerHeight * 0.14;
    const maxCards = Math.max(2, Math.floor(colHeight / cardHeight));

    for (const machine of machines) {
      const col = document.createElement('div');
      col.className = 'machine-col';

      const head = document.createElement('div');
      head.className = 'machine-head';
      head.textContent = machine;
      col.appendChild(head);

      const jobs = groups.get(machine) || [];
      // Prioritise what matters on the floor: running first, then queued,
      // then the most recent finished jobs if there is room left.
      const running = jobs.filter((j) => j.status === 'running');
      const queued = jobs.filter((j) => j.status === 'upcoming' || j.status === 'none');
      const done = jobs.filter((j) => j.status === 'done');
      const shown = [...running, ...queued].slice(0, maxCards);
      for (const j of done.slice(-Math.max(0, maxCards - shown.length))) shown.push(j);
      shown.sort((a, b) => jobs.indexOf(a) - jobs.indexOf(b));

      if (!jobs.length) {
        const empty = document.createElement('div');
        empty.className = 'machine-empty';
        empty.textContent = 'Nothing scheduled';
        col.appendChild(empty);
      }

      for (const { row, status } of shown) {
        const card = document.createElement('div');
        card.className = 'job-card status-' + status;

        const top = document.createElement('div');
        top.className = 'job-top';
        const time = document.createElement('span');
        time.className = 'job-time';
        const start = mapping.startCol ? U.formatTimeCell(row[mapping.startCol]) : '';
        const end = mapping.endCol ? U.formatTimeCell(row[mapping.endCol]) : '';
        time.textContent = start && end ? `${start} – ${end}` : start || end;
        top.appendChild(time);
        if (status !== 'none') {
          const chip = document.createElement('span');
          chip.className = 'status-chip ' + status;
          chip.textContent =
            status === 'running' ? 'Running' : status === 'upcoming' ? 'Queued' : 'Done';
          top.appendChild(chip);
        }
        card.appendChild(top);

        const title = document.createElement('div');
        title.className = 'job-title';
        title.textContent = String(row[titleCol] ?? '');
        card.appendChild(title);

        const metaBits = metaCols
          .map((c) => ({ c, v: String(row[c] ?? '').trim() }))
          .filter((x) => x.v);
        if (metaBits.length) {
          const meta = document.createElement('div');
          meta.className = 'job-meta';
          meta.textContent = metaBits.map((x) => `${x.c}: ${x.v}`).join('   ·   ');
          card.appendChild(meta);
        }
        col.appendChild(card);
      }

      const hidden = jobs.length - shown.length;
      if (hidden > 0) {
        const more = document.createElement('div');
        more.className = 'machine-more';
        more.textContent = `+ ${hidden} more`;
        col.appendChild(more);
      }
      grid.appendChild(col);
    }

    board.appendChild(grid);
    $('pageDots').innerHTML = '';
    pageCount = 1;
  }

  /* --------------------------------------------------- table layout */

  function renderTable(items) {
    const columns = data.columns.length ? data.columns : data.headers.slice(0, 6);
    const { mapping } = data;
    const timeCols = new Set([mapping.startCol, mapping.endCol].filter(Boolean));
    const hasTimes = !!(mapping.startCol || mapping.endCol);

    // Paginate to fit: estimate rows per page from available height.
    const board = $('board');
    const rowHeight = window.innerHeight * 0.065; // matches td padding + font
    const headerHeight = window.innerHeight * 0.05;
    const perPage = Math.max(3, Math.floor((board.clientHeight - headerHeight) / rowHeight));
    pageCount = Math.max(1, Math.ceil(items.length / perPage));
    if (page >= pageCount) page = 0;
    const pageItems = items.slice(page * perPage, (page + 1) * perPage);

    const table = document.createElement('table');
    table.className = 'board';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = col;
      headRow.appendChild(th);
    }
    if (hasTimes) {
      const th = document.createElement('th');
      th.textContent = 'Status';
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const { row, status } of pageItems) {
      const tr = document.createElement('tr');
      tr.className = 'status-' + status;
      for (const col of columns) {
        const td = document.createElement('td');
        if (timeCols.has(col)) {
          td.textContent = U.formatTimeCell(row[col]);
          td.className = 'time-cell';
        } else {
          td.textContent = String(row[col] ?? '');
        }
        tr.appendChild(td);
      }
      if (hasTimes) {
        const td = document.createElement('td');
        if (status !== 'none') {
          const chip = document.createElement('span');
          chip.className = 'status-chip ' + status;
          chip.textContent =
            status === 'running' ? 'Running' : status === 'upcoming' ? 'Up next' : 'Done';
          td.appendChild(chip);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    board.innerHTML = '';
    board.appendChild(table);

    const dots = $('pageDots');
    dots.innerHTML = '';
    if (pageCount > 1) {
      for (let i = 0; i < pageCount; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot' + (i === page ? ' active' : '');
        dots.appendChild(dot);
      }
    }
  }

  /* ------------------------------------------------------- live wiring */

  function connectEvents() {
    const src = new EventSource('/api/events');
    src.onopen = () => {
      $('connState').textContent = 'Live';
      $('connState').classList.remove('offline');
    };
    src.onmessage = (e) => {
      try {
        if (JSON.parse(e.data).type === 'update') refresh();
      } catch {}
    };
    src.onerror = () => {
      $('connState').textContent = 'Reconnecting…';
      $('connState').classList.add('offline');
      // EventSource auto-reconnects; also refresh when it comes back.
    };
  }

  // Rotate pages when the list doesn't fit on one screen.
  setInterval(() => {
    if (pageCount > 1) { page = (page + 1) % pageCount; render(); }
  }, 12000);

  // Clock + status tick.
  setInterval(render, 30000);
  // Safety-net poll in case an SSE update is missed.
  setInterval(refresh, 5 * 60 * 1000);
  window.addEventListener('resize', render);

  refresh();
  connectEvents();
})();
