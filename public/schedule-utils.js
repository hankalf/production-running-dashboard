/* Shared client-side helpers for parsing schedule dates/times and
 * working out row status. All time maths happens in the browser so each
 * screen uses its own local clock/timezone, not the server's. */
(function () {
  'use strict';

  // Parse a time string ("06:00", "6:00 AM", "14:30", "0630") -> minutes
  // since midnight, or null.
  function parseTime(value) {
    if (value == null) return null;
    let s = String(value).trim().toLowerCase();
    if (!s) return null;
    // Take the time part out of a "YYYY-MM-DD HH:MM" combo cell.
    const combo = s.match(/^\d{4}-\d{2}-\d{2}[ t](\d{1,2}:\d{2})/);
    if (combo) s = combo[1];
    let ampm = null;
    const suffix = s.match(/(am|pm|a\.m\.|p\.m\.)\s*$/);
    if (suffix) {
      ampm = suffix[1][0];
      s = s.slice(0, suffix.index).trim();
    }
    let h, m;
    let match = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
    if (match) {
      h = +match[1]; m = +match[2];
    } else if ((match = s.match(/^(\d{1,2})(\d{2})$/))) {
      h = +match[1]; m = +match[2]; // "0630"
    } else if ((match = s.match(/^(\d{1,2})$/))) {
      h = +match[1]; m = 0;
    } else {
      return null;
    }
    if (ampm === 'p' && h < 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    if (h > 24 || m > 59) return null;
    return (h % 24) * 60 + m;
  }

  // Parse a date cell -> "YYYY-MM-DD" or null. format: 'auto'|'DMY'|'MDY'.
  function parseDate(value, format) {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      let day, month;
      if (format === 'DMY') { day = a; month = b; }
      else if (format === 'MDY') { month = a; day = b; }
      else if (a > 12) { day = a; month = b; }
      else if (b > 12) { month = a; day = b; }
      else { day = a; month = b; } // auto tie-break: assume day-first
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // "29 Aug 2026", "Aug 29" style
    const d = new Date(s);
    if (!isNaN(d.getTime()) && /[a-z]/i.test(s)) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return null;
  }

  // Sniff DMY vs MDY from the data when the mapping says 'auto'.
  function resolveDateFormat(rows, dateCol, format) {
    if (format && format !== 'auto') return format;
    for (const row of rows) {
      const m = String(row[dateCol] || '').match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
      if (!m) continue;
      if (+m[1] > 12) return 'DMY';
      if (+m[2] > 12) return 'MDY';
    }
    return 'DMY';
  }

  function todayStr(now) {
    const d = now || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Status of one row right now: 'running' | 'upcoming' | 'done' | 'none'.
  function rowStatus(row, mapping, now) {
    const start = mapping.startCol ? parseTime(row[mapping.startCol]) : null;
    let end = mapping.endCol ? parseTime(row[mapping.endCol]) : null;
    if (start == null && end == null) return 'none';
    const mins = (now || new Date()).getHours() * 60 + (now || new Date()).getMinutes();
    if (start != null && end != null) {
      if (end <= start) end += 24 * 60; // overnight run
      let t = mins;
      if (t < start && t + 24 * 60 <= end) t += 24 * 60;
      if (t >= start && t < end) return 'running';
      return t < start ? 'upcoming' : 'done';
    }
    if (start != null) return mins >= start ? 'running' : 'upcoming';
    return mins < end ? 'running' : 'done';
  }

  function formatTimeCell(value) {
    const mins = parseTime(value);
    if (mins == null) return String(value ?? '');
    const h = Math.floor(mins / 60) % 24;
    return `${String(h).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  window.ScheduleUtils = {
    parseTime, parseDate, resolveDateFormat, todayStr, rowStatus, formatTimeCell
  };
})();
