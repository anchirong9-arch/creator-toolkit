/* ============================================================
   오피스 에디터 — 엑셀 그리드 엔진 (SheetJS)
   xlsx · xlsb · xls · csv 열기 / 셀·행·열·시트 편집 / xlsx·csv 저장
   전부 브라우저 안에서 처리합니다.
   ============================================================ */
(function () {
  'use strict';

  const ROW_H = 24;
  const HEAD_W = 52;
  const MIN_COLS = 12;
  const MIN_ROWS = 40;
  const MAX_ROWS = 20000;
  const MAX_COLS = 300;

  const $ = (id) => document.getElementById(id);

  const S = {
    sheets: [],        // [{name, rows, cols:[px], merges:[{s,e}], _cx}]
    active: 0,
    sel: { r: 0, c: 0 },
    selEnd: null,
    fileName: '제목 없음.xlsx',
    originalExt: 'xlsx',
    dirty: false,
    undo: [],
    redo: [],
    editing: false,
    find: { open: false, q: '', hits: [], idx: -1 },
    drag: null,
    clipboard: null,
    inited: false,
    onChange: null
  };

  const E = {};

  /* ── 작은 도구들 ───────────────────────────────────── */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const colName = (i) => XLSX.utils.encode_col(i);
  const cellRef = (r, c) => colName(c) + (r + 1);
  function fmtBytes(n) {
    if (!isFinite(n) || n < 0) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dateStr(d) {
    if (!(d instanceof Date) || isNaN(d)) return String(d);
    const t = d.getTime();
    const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
    const base = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    return hasTime ? base + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : base;
  }

  function cur() { return S.sheets[S.active] || null; }

  /* ── 모델 ──────────────────────────────────────────── */
  function blankSheet(name) {
    return { name: name, rows: [], cols: [], merges: [], _cx: null };
  }

  function rowCountOf(s) {
    let n = s.rows.length;
    while (n > 0) {
      const row = s.rows[n - 1];
      if (row && row.some((c) => c != null)) break;
      n--;
    }
    return Math.max(n, MIN_ROWS);
  }
  function colCountOf(s) {
    let m = 0;
    for (let i = 0; i < s.rows.length; i++) {
      const row = s.rows[i];
      if (row && row.length > m) {
        let len = row.length;
        while (len > 0 && row[len - 1] == null) len--;
        if (len > m) m = len;
      }
    }
    return Math.max(m, MIN_COLS);
  }
  function usedRange(s) {
    let mr = 0, mc = 0;
    for (let r = 0; r < s.rows.length; r++) {
      const row = s.rows[r]; if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (row[c] != null) { if (r + 1 > mr) mr = r + 1; if (c + 1 > mc) mc = c + 1; }
      }
    }
    return { rows: mr, cols: mc };
  }
  function cellAt(s, r, c) {
    const row = s.rows[r];
    return row ? row[c] : null;
  }
  function setCell(s, r, c, val) {
    while (s.rows.length <= r) s.rows.push([]);
    const row = s.rows[r];
    while (row.length <= c) row.push(null);
    row[c] = val;
    s._cx = null;
  }
  function colWidths(s, colCount) {
    const out = new Array(colCount);
    for (let i = 0; i < colCount; i++) {
      let w = s.cols && s.cols[i] ? s.cols[i] : 96;
      out[i] = clamp(w, 36, 480);
    }
    return out;
  }
  function colX(s, colCount) {
    if (s._cx && s._cx.length >= colCount) return s._cx;
    const w = colWidths(s, colCount);
    const xs = new Array(colCount + 1);
    xs[0] = 0;
    for (let i = 0; i < colCount; i++) xs[i + 1] = xs[i] + w[i];
    s._cx = xs;
    return xs;
  }
  function colIndexAt(xs, x) {
    let lo = 0, hi = xs.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return clamp(lo, 0, xs.length - 2);
  }

  /* ── 표시 문자열 ───────────────────────────────────── */
  function displayText(cell) {
    if (!cell) return '';
    if (cell.f != null) {
      if (cell.v == null) return '=' + cell.f;
      return valueText(cell);
    }
    return valueText(cell);
  }
  function valueText(cell) {
    const v = cell.v;
    if (v == null) return '';
    if (v instanceof Date) return dateStr(v);
    if (typeof v === 'number') {
      if (cell.w && /[%$€₩]|,/.test(cell.w)) return cell.w;
      if (cell.z && XLSX.SSF) {
        try {
          const f = XLSX.SSF.format(cell.z, v);
          if (f && f !== String(v) && !/^[0#?.,]+$/.test(f)) return f;
        } catch (e) { /* 무시 */ }
      }
      return String(+v.toFixed(10));
    }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  function isNumericCell(cell) {
    if (!cell) return false;
    if (cell.t === 'n' || isNum(cell.v)) return true;
    return false;
  }

  /* ── 파일 열기 ─────────────────────────────────────── */
  function readCsv(u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return XLSX.read(u8, { type: 'array', RAW: false });
    }
    let text = '';
    try { text = new TextDecoder('utf-8', { fatal: false }).decode(u8); } catch (e) { text = ''; }
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad > 0) {
      try { return XLSX.read(u8, { type: 'array', codepage: 949, raw: false }); } catch (e) { /* 무시 */ }
    }
    return XLSX.read(text, { type: 'string' });
  }

  async function openFile(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const ext = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    let wb;
    if (ext === 'csv' || ext === 'txt') {
      wb = readCsv(u8);
    } else {
      wb = XLSX.read(u8, { type: 'array', cellDates: true, cellNF: true, cellText: true, WTF: false });
    }
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error('시트를 찾지 못했어요. 파일이 손상되었거나 지원하지 않는 형식입니다.');

    S.sheets = wb.SheetNames.slice(0, 60).map((name) => sheetFromWs(wb.Sheets[name] || {}, name));
    S.active = 0;
    S.sel = { r: 0, c: 0 };
    S.selEnd = null;
    S.undo = []; S.redo = [];
    S.fileName = file.name;
    S.originalExt = ext || 'xlsx';
    S.dirty = false;
    S.find = { open: false, q: '', hits: [], idx: -1 };
    resetScroll();
    renderAll();
    return { name: file.name, size: file.size, ext: ext, sheets: S.sheets.length };
  }

  function sheetFromWs(ws, name) {
    const s = blankSheet(name);
    const rows = [];
    let maxR = 0, maxC = 0;
    Object.keys(ws).forEach((k) => {
      if (k.charCodeAt(0) === 33 /* ! */) return;
      const dec = XLSX.utils.decode_cell(k);
      if (dec.r > MAX_ROWS || dec.c > MAX_COLS) return;
      const src = ws[k];
      if (!src) return;
      while (rows.length <= dec.r) rows.push([]);
      const row = rows[dec.r];
      while (row.length <= dec.c) row.push(null);
      const cell = { v: src.v, t: src.t };
      if (src.f != null) cell.f = src.f;
      if (src.z != null) cell.z = src.z;
      if (src.w != null) cell.w = src.w;
      if (src.v instanceof Date) { cell.t = 'd'; cell.v = src.v; }
      row[dec.c] = cell;
      if (dec.r > maxR) maxR = dec.r;
      if (dec.c > maxC) maxC = dec.c;
    });
    s.rows = rows;
    if (ws['!cols']) {
      s.cols = ws['!cols'].map((c) => {
        if (!c) return 96;
        if (c.wpx) return Math.round(c.wpx);
        if (c.wch) return Math.round(c.wch * 7 + 6);
        if (c.width) return Math.round(c.width * 7 + 6);
        return 96;
      });
    }
    if (ws['!merges']) {
      s.merges = ws['!merges'].map((m) => ({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }));
    }
    return s;
  }

  function newBook() {
    S.sheets = [blankSheet('Sheet1')];
    S.active = 0;
    S.sel = { r: 0, c: 0 };
    S.selEnd = null;
    S.undo = []; S.redo = [];
    S.fileName = '새 엑셀.xlsx';
    S.originalExt = 'xlsx';
    S.dirty = false;
    S.find = { open: false, q: '', hits: [], idx: -1 };
    resetScroll();
    renderAll();
  }

  /* ── 렌더 ──────────────────────────────────────────── */
  function renderAll() {
    renderTabs();
    render();
    renderFx();
    renderSummary();
    syncDirty();
  }

  function resetScroll() {
    const v = E.cellView;
    if (v) { v.scrollTop = 0; v.scrollLeft = 0; }
  }

  function range() {
    const a = S.sel;
    const b = S.selEnd || a;
    return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
  }

  const paint = { key: '', raf: 0 };

  function scheduleRender() {
    if (paint.raf) return;
    paint.raf = requestAnimationFrame(() => { paint.raf = 0; render(); });
  }

  function render() {
    const s = cur();
    if (!s) return;
    const view = E.cellView;
    const vw = view.clientWidth || 900;
    const vh = view.clientHeight || 500;
    const rowCount = rowCountOf(s);
    const colCount = colCountOf(s);
    const xs = colX(s, colCount);
    const totalW = Math.max(xs[colCount], vw);
    const totalH = Math.max(rowCount * ROW_H, vh);

    E.cellInner.style.width = totalW + 'px';
    E.cellInner.style.height = totalH + 'px';

    const st = view.scrollTop, sl = view.scrollLeft;
    const r0 = clamp(Math.floor(st / ROW_H) - 1, 0, rowCount - 1);
    const r1 = clamp(Math.ceil((st + vh) / ROW_H) + 1, 0, rowCount - 1);
    const c0 = clamp(colIndexAt(xs, sl) - 1, 0, colCount - 1);
    const c1 = clamp(colIndexAt(xs, sl + vw) + 1, 0, colCount - 1);
    const rg = range();
    const find = S.find;
    const hitSet = find.hits.length ? hitIndex(find) : null;
    const key = [r0, r1, c0, c1, rg.r0, rg.c0, rg.r1, rg.c1, S.active, find.q, find.idx, S.editing ? 1 : 0].join('|');
    const same = key === paint.key;

    // 헤더 이동
    E.colheadTrack.style.transform = 'translateX(' + (-sl) + 'px)';
    E.rowheadTrack.style.transform = 'translateY(' + (-st) + 'px)';

    if (!same) {
      paint.key = key;

      // 열 헤더
      let h = '';
      for (let c = c0; c <= c1; c++) {
        const w = xs[c + 1] - xs[c];
        h += '<div class="ch' + (c >= rg.c0 && c <= rg.c1 ? ' active' : '') + '" style="left:' + xs[c] + 'px;width:' + w + 'px">' + colName(c) + '</div>';
      }
      E.colheadTrack.innerHTML = h;

      // 행 헤더
      h = '';
      for (let r = r0; r <= r1; r++) {
        h += '<div class="rh' + (r === S.sel.r ? ' active' : (r >= rg.r0 && r <= rg.r1 ? ' sel' : '')) + '" style="top:' + (r * ROW_H) + 'px;height:' + ROW_H + 'px">' + (r + 1) + '</div>';
      }
      E.rowheadTrack.innerHTML = h;

      // 셀
      const frag = document.createDocumentFragment();
      const merges = s.merges;
      const covered = new Set();
      if (merges.length) {
        merges.forEach((m) => {
          if (m.s.r >= r0 - 1 && m.s.r <= r1 + 1 && m.s.c >= c0 - 1 && m.s.c <= c1 + 1) {
            for (let rr = m.s.r; rr <= m.e.r; rr++) for (let cc = m.s.c; cc <= m.e.c; cc++) {
              if (rr === m.s.r && cc === m.s.c) continue;
              covered.add(rr + ':' + cc);
            }
          }
        });
      }

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (covered.has(r + ':' + c)) continue;
          const cell = cellAt(s, r, c);
          const isSel = r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1;
          const isActive = r === S.sel.r && c === S.sel.c;
          const div = document.createElement('div');
          const num = isNumericCell(cell);
          let cls = 'cell' + (num ? ' n' : '');
          if (isSel) cls += ' sel';
          if (isActive && !S.editing) cls += ' active';
          if (hitSet && hitSet.has(r + ':' + c)) {
            cls += ' hit';
            if (find.hits[find.idx] && find.hits[find.idx].r === r && find.hits[find.idx].c === c) cls += ' hit-cur';
          }
          div.className = cls;
          const m = merges.find((mm) => mm.s.r === r && mm.s.c === c);
          let w = xs[c + 1] - xs[c], hh = ROW_H;
          if (m) {
            w = xs[Math.min(m.e.c + 1, colCount)] - xs[c];
            hh = (Math.min(m.e.r + 1, rowCount) - r) * ROW_H;
          }
          div.style.left = xs[c] + 'px';
          div.style.top = (r * ROW_H) + 'px';
          div.style.width = w + 'px';
          div.style.height = hh + 'px';
          if (m) div.style.zIndex = 2;
          const txt = displayText(cell);
          if (cell && cell.f != null && cell.v == null) {
            const sp = document.createElement('span');
            sp.className = 'fx';
            sp.textContent = txt;
            div.appendChild(sp);
          } else {
            div.textContent = txt;
          }
          div.dataset.r = r;
          div.dataset.c = c;
          frag.appendChild(div);
        }
      }
      E.cellInner.innerHTML = '';
      E.cellInner.appendChild(frag);
      positionEditor();
    }

    // 요약
    renderSummary();
    updateToolbar();
  }

  function hitIndex(find) {
    const set = new Set();
    find.hits.forEach((p) => set.add(p.r + ':' + p.c));
    return set;
  }

  /* ── 시트 탭 ───────────────────────────────────────── */
  function renderTabs() {
    const box = E.sheetTabs;
    if (!box) return;
    box.innerHTML = '';
    S.sheets.forEach((s, i) => {
      const b = document.createElement('div');
      b.className = 'tab' + (i === S.active ? ' active' : '');
      b.dataset.i = i;
      b.textContent = s.name;
      b.title = s.name + ' (더블클릭으로 이름 변경)';
      b.addEventListener('click', () => { if (S.active !== i) { commitEdit(false); S.active = i; resetScroll(); paint.key = ''; renderAll(); renderTabs(); } });
      b.addEventListener('dblclick', (e) => { e.stopPropagation(); renameSheet(i); });
      box.appendChild(b);
    });
  }

  function renameSheet(i) {
    const tab = E.sheetTabs.querySelector('.tab[data-i="' + i + '"]');
    if (!tab) return;
    const old = S.sheets[i].name;
    tab.textContent = '';
    const inp = document.createElement('input');
    inp.value = old;
    inp.maxLength = 31;
    tab.appendChild(inp);
    inp.focus(); inp.select();
    const done = (ok) => {
      const v = inp.value.trim();
      if (ok && v) {
        const dup = S.sheets.some((s, k) => k !== i && s.name === v);
        if (dup) { toastMsg('같은 이름의 시트가 이미 있어요', 'err'); renderTabs(); return; }
        pushUndo();
        S.sheets[i].name = v;
        S.dirty = true;
      }
      renderTabs(); renderSummary(); syncDirty();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    inp.addEventListener('blur', () => done(true));
  }

  function addSheet() {
    pushUndo();
    let n = 1;
    while (S.sheets.some((s) => s.name === 'Sheet' + n)) n++;
    S.sheets.push(blankSheet('Sheet' + n));
    S.active = S.sheets.length - 1;
    S.dirty = true;
    resetScroll(); paint.key = '';
    renderAll(); renderTabs();
    E.sheetTabs.scrollLeft = E.sheetTabs.scrollWidth;
  }

  function deleteSheet(i) {
    if (S.sheets.length <= 1) { toastMsg('시트가 하나뿐이라 지울 수 없어요', 'err'); return; }
    const s = S.sheets[i];
    confirmBox('시트 삭제', '“' + s.name + '” 시트를 삭제할까요? 저장 전에는 되돌릴 수 있지만, 저장 후에는 복구되지 않습니다.').then((ok) => {
      if (!ok) return;
      pushUndo();
      S.sheets.splice(i, 1);
      S.active = Math.min(S.active, S.sheets.length - 1);
      S.dirty = true;
      resetScroll(); paint.key = '';
      renderAll(); renderTabs();
      toastMsg('시트를 삭제했어요', 'ok');
    });
  }

  /* ── 셀 선택 / 편집 ────────────────────────────────── */
  function select(r, c, extend) {
    const s = cur(); if (!s) return;
    const rowCount = rowCountOf(s), colCount = colCountOf(s);
    r = clamp(r, 0, rowCount - 1);
    c = clamp(c, 0, colCount - 1);
    if (extend) {
      if (!S.selEnd) S.selEnd = { r: S.sel.r, c: S.sel.c };
      S.selEnd = { r, c };
    } else {
      S.sel = { r, c };
      S.selEnd = null;
    }
    paint.key = '';
    render();
    renderFx();
  }

  function move(dr, dc) {
    select(S.sel.r + dr, S.sel.c + dc, false);
    scrollIntoView(S.sel.r, S.sel.c);
  }

  function scrollIntoView(r, c) {
    const s = cur(); if (!s) return;
    const view = E.cellView;
    const xs = colX(s, colCountOf(s));
    const top = r * ROW_H, bot = top + ROW_H;
    const left = xs[c], right = xs[c + 1];
    if (top < view.scrollTop) view.scrollTop = top;
    else if (bot > view.scrollTop + view.clientHeight) view.scrollTop = bot - view.clientHeight + 2;
    if (left < view.scrollLeft) view.scrollLeft = left;
    else if (right > view.scrollLeft + view.clientWidth) view.scrollLeft = right - view.clientWidth + 2;
    scheduleRender();
  }

  function startEdit(initial) {
    const s = cur(); if (!s) return;
    const { r, c } = S.sel;
    const cell = cellAt(s, r, c);
    const val = initial !== undefined ? initial : (cell ? (cell.f != null ? '=' + cell.f : (cell.v == null ? '' : valueText(cell))) : '');
    S.editing = true;
    paint.key = '';
    render();
    const ed = E.cellEditor;
    const xs = colX(s, colCountOf(s));
    ed.style.left = xs[c] + 'px';
    ed.style.top = (r * ROW_H) + 'px';
    ed.style.width = Math.max(xs[c + 1] - xs[c], 60) + 'px';
    ed.style.height = ROW_H + 'px';
    ed.value = val;
    ed.hidden = false;
    ed.focus();
    if (initial === undefined) { const n = ed.value.length; try { ed.setSelectionRange(n, n); } catch (e) {} }
    else { try { ed.setSelectionRange(ed.value.length, ed.value.length); } catch (e) {} }
  }

  function positionEditor() {
    const ed = E.cellEditor;
    if (ed && !ed.hidden && S.editing) {
      const s = cur(); if (!s) return;
      const xs = colX(s, colCountOf(s));
      const { r, c } = S.sel;
      ed.style.left = xs[c] + 'px';
      ed.style.top = (r * ROW_H) + 'px';
      ed.style.width = Math.max(xs[c + 1] - xs[c], 60) + 'px';
    }
  }

  function commitEdit(moveDown) {
    if (!S.editing) return;
    const s = cur(); if (!s) return;
    const ed = E.cellEditor;
    const raw = ed.value;
    const { r, c } = S.sel;
    S.editing = false;
    ed.hidden = true;
    applyValue(r, c, raw);
    paint.key = '';
    render();
    renderFx();
    renderSummary();
    if (moveDown) move(1, 0);
    E.cellView.focus({ preventScroll: true });
  }

  function cancelEdit() {
    if (!S.editing) return;
    S.editing = false;
    E.cellEditor.hidden = true;
    paint.key = '';
    render();
    E.cellView.focus({ preventScroll: true });
  }

  function parseInput(str) {
    if (str === '' || str == null) return null;
    if (str.charAt(0) === '=') return { f: str.slice(1), v: undefined, t: 'n' };
    const t = str.trim();
    if (t !== '' && /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) {
      const n = parseFloat(t);
      if (isFinite(n)) return { v: n, t: 'n' };
    }
    if (/^(true|false)$/i.test(t)) return { v: /^true$/i.test(t), t: 'b' };
    return { v: str, t: 's' };
  }

  function applyValue(r, c, raw) {
    const s = cur(); if (!s) return;
    const before = cellAt(s, r, c);
    const next = parseInput(raw);
    const same = (!before && !next) ||
      (before && next && before.f === next.f && String(before.v) === String(next.v) && before.f != null === next.f != null);
    if (same) return;
    pushUndo();
    if (!next) setCell(s, r, c, null);
    else setCell(s, r, c, next);
    S.dirty = true;
    syncDirty();
  }

  function clearSelection() {
    const s = cur(); if (!s) return;
    const rg = range();
    pushUndo();
    for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) setCell(s, r, c, null);
    S.dirty = true;
    paint.key = '';
    render(); renderFx(); syncDirty();
  }

  /* ── 실행 취소 ─────────────────────────────────────── */
  function snapshot() {
    const s = cur(); if (!s) return null;
    return {
      active: S.active,
      name: s.name,
      cols: s.cols.slice(),
      merges: s.merges.map((m) => ({ s: { ...m.s }, e: { ...m.e } })),
      rows: s.rows.map((row) => (row ? row.map((c) => (c ? { ...c } : null)) : row))
    };
  }
  function pushUndo() {
    const snap = snapshot();
    if (!snap) return;
    S.undo.push(snap);
    if (S.undo.length > 40) S.undo.shift();
    S.redo.length = 0;
    updateToolbar();
  }
  function restore(snap) {
    if (!snap) return;
    const s = S.sheets[snap.active] || S.sheets[0];
    const idx = S.sheets.indexOf(s);
    s.name = snap.name;
    s.cols = snap.cols;
    s.merges = snap.merges;
    s.rows = snap.rows.map((row) => (row ? row.map((c) => (c ? { ...c } : null)) : row));
    s._cx = null;
    S.active = idx < 0 ? 0 : idx;
    S.dirty = true;
    paint.key = '';
    renderAll(); renderTabs(); syncDirty();
  }
  function undo() {
    commitEdit(false);
    if (!S.undo.length) return;
    const snap = S.undo.pop();
    S.redo.push(snapshot());
    restore(snap);
    updateToolbar();
  }
  function redo() {
    if (!S.redo.length) return;
    const snap = S.redo.pop();
    S.undo.push(snapshot());
    restore(snap);
    updateToolbar();
  }

  /* ── 행 / 열 ───────────────────────────────────────── */
  function insertRow() {
    const s = cur(); if (!s) return;
    pushUndo();
    const at = S.sel.r;
    s.rows.splice(at, 0, []);
    s.merges.forEach((m) => {
      if (m.s.r >= at) { m.s.r++; m.e.r++; }
      else if (m.e.r >= at) m.e.r++;
    });
    S.dirty = true;
    paint.key = '';
    render(); syncDirty();
    toastMsg(at + 1 + '행 위에 행을 추가했어요');
  }
  function deleteRow() {
    const s = cur(); if (!s) return;
    pushUndo();
    const at = S.sel.r;
    s.rows.splice(at, 1);
    s.merges.forEach((m) => {
      if (m.s.r > at) { m.s.r--; m.e.r--; }
      else if (m.e.r >= at) m.e.r = Math.max(m.s.r, m.e.r - 1);
    });
    s.merges = s.merges.filter((m) => m.e.r >= m.s.r);
    S.dirty = true;
    paint.key = '';
    render(); syncDirty();
  }
  function insertCol() {
    const s = cur(); if (!s) return;
    pushUndo();
    const at = S.sel.c;
    for (let r = 0; r < s.rows.length; r++) {
      const row = s.rows[r];
      if (!row) continue;
      while (row.length < at) row.push(null);
      row.splice(at, 0, null);
    }
    s.cols.splice(at, 0, 96);
    s._cx = null;
    s.merges.forEach((m) => {
      if (m.s.c >= at) { m.s.c++; m.e.c++; }
      else if (m.e.c >= at) m.e.c++;
    });
    S.dirty = true;
    paint.key = '';
    render(); syncDirty();
  }
  function deleteCol() {
    const s = cur(); if (!s) return;
    pushUndo();
    const at = S.sel.c;
    for (let r = 0; r < s.rows.length; r++) {
      const row = s.rows[r];
      if (row && row.length > at) row.splice(at, 1);
    }
    s.cols.splice(at, 1);
    s._cx = null;
    s.merges.forEach((m) => {
      if (m.s.c > at) { m.s.c--; m.e.c--; }
      else if (m.e.c >= at) m.e.c = Math.max(m.s.c, m.e.c - 1);
    });
    s.merges = s.merges.filter((m) => m.e.c >= m.s.c);
    S.dirty = true;
    paint.key = '';
    render(); syncDirty();
  }

  /* ── 찾기 ──────────────────────────────────────────── */
  function search(q) {
    const s = cur(); if (!s) return;
    S.find.q = q;
    S.find.hits = [];
    S.find.idx = -1;
    const needle = q.toLowerCase();
    if (!needle) { paint.key = ''; render(); updateFindUI(); return; }
    for (let r = 0; r < s.rows.length; r++) {
      const row = s.rows[r]; if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]; if (!cell) continue;
        const t = displayText(cell).toLowerCase();
        if (t.indexOf(needle) >= 0) S.find.hits.push({ r, c });
      }
    }
    S.find.idx = S.find.hits.length ? 0 : -1;
    paint.key = '';
    render();
    updateFindUI();
    if (S.find.idx >= 0) gotoHit(0);
  }
  function gotoHit(i) {
    const hits = S.find.hits;
    if (!hits.length) return;
    S.find.idx = ((i % hits.length) + hits.length) % hits.length;
    const h = hits[S.find.idx];
    select(h.r, h.c, false);
    scrollIntoView(h.r, h.c);
    updateFindUI();
    paint.key = '';
    render();
  }
  function updateFindUI() {
    if (!E.findCount) return;
    const n = S.find.hits.length;
    E.findCount.textContent = n ? (S.find.idx + 1) + ' / ' + n : '0 / 0';
  }
  function toggleFind(open) {
    const on = open === undefined ? E.findbar.hidden : open;
    E.findbar.hidden = !on;
    S.find.open = on;
    if (on) { E.findInput.focus(); E.findInput.select(); }
    else { S.find.q = ''; S.find.hits = []; S.find.idx = -1; paint.key = ''; render(); }
    updateFindUI();
  }

  /* ── 클립보드 ──────────────────────────────────────── */
  async function copySel() {
    const s = cur(); if (!s) return;
    const rg = range();
    const lines = [];
    for (let r = rg.r0; r <= rg.r1; r++) {
      const cols = [];
      for (let c = rg.c0; c <= rg.c1; c++) {
        const cell = cellAt(s, r, c);
        cols.push(cell ? displayText(cell) : '');
      }
      lines.push(cols.join('\t'));
    }
    S.clipboard = lines.join('\n');
    try { await navigator.clipboard.writeText(S.clipboard); toastMsg('복사했어요', 'ok'); }
    catch (e) { toastMsg('클립보드에 복사했어요 (붙여넣기는 Ctrl+V)', 'ok'); }
  }
  function pasteText(text) {
    const s = cur(); if (!s || !text) return;
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    pushUndo();
    const { r: r0, c: c0 } = S.sel;
    rows.forEach((cols, i) => cols.forEach((v, j) => {
      const cell = parseInput(v);
      setCell(s, r0 + i, c0 + j, cell);
    }));
    S.dirty = true;
    S.selEnd = { r: r0 + rows.length - 1, c: c0 + (rows[0] ? rows[0].length - 1 : 0) };
    paint.key = '';
    render(); renderSummary(); syncDirty();
    toastMsg(rows.length + '행 붙여넣음', 'ok');
  }

  /* ── 저장 ──────────────────────────────────────────── */
  function buildWs(s) {
    const ws = {};
    let maxR = 0, maxC = 0;
    s.rows.forEach((row, r) => {
      if (!row) return;
      row.forEach((cell, c) => {
        if (!cell) return;
        const addr = XLSX.utils.encode_cell({ r, c });
        const out = {};
        if (cell.f != null) {
          out.f = cell.f;
          out.t = cell.t === 's' ? 's' : 'n';
          if (cell.v != null) out.v = cell.v;
        } else if (cell.v instanceof Date) {
          out.t = 'd'; out.v = cell.v; if (cell.z) out.z = cell.z;
        } else if (typeof cell.v === 'number') {
          out.t = 'n'; out.v = cell.v; if (cell.z) out.z = cell.z;
        } else if (typeof cell.v === 'boolean') {
          out.t = 'b'; out.v = cell.v;
        } else if (cell.v != null) {
          out.t = 's'; out.v = String(cell.v);
        } else {
          return;
        }
        ws[addr] = out;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    if (s.cols && s.cols.length) {
      ws['!cols'] = s.cols.map((px) => ({ wch: Math.max(4, Math.round((px - 6) / 7)) }));
    }
    if (s.merges && s.merges.length) {
      ws['!merges'] = s.merges.map((m) => ({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }));
    }
    return ws;
  }

  function baseName(name) {
    return String(name || '문서').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || '문서';
  }

  function saveXlsx() {
    commitEdit(false);
    const wb = XLSX.utils.book_new();
    S.sheets.forEach((s, i) => {
      const name = (s.name || 'Sheet' + (i + 1)).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, buildWs(s), name);
    });
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const name = baseName(S.fileName) + '.xlsx';
    downloadBlob(blob, name);
    S.dirty = false;
    syncDirty();
    return { name: name, size: blob.size };
  }

  function saveCsv() {
    commitEdit(false);
    const s = cur(); if (!s) return null;
    const ws = buildWs(s);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\r\n', blankrows: false });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const name = baseName(S.fileName) + '-' + s.name.replace(/[\\/:*?"<>|]+/g, '_') + '.csv';
    downloadBlob(blob, name);
    return { name: name, size: blob.size };
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 6000);
  }

  /* ── 상태 표시 ─────────────────────────────────────── */
  function renderFx() {
    const s = cur(); if (!s) return;
    const cell = cellAt(s, S.sel.r, S.sel.c);
    E.fxRef.textContent = cellRef(S.sel.r, S.sel.c);
    const v = cell ? (cell.f != null ? '=' + cell.f : (cell.v == null ? '' : valueText(cell))) : '';
    if (document.activeElement !== E.fxInput) E.fxInput.value = v;
  }

  function renderSummary() {
    const s = cur(); if (!s) return;
    const rg = range();
    const multi = rg.r0 !== rg.r1 || rg.c0 !== rg.c1;
    const parts = [];
    if (multi) {
      let n = 0, sum = 0, numCount = 0;
      for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) {
        const cell = cellAt(s, r, c);
        if (!cell) continue;
        n++;
        if (isNum(cell.v)) { sum += cell.v; numCount++; }
      }
      parts.push('선택 ' + (rg.r1 - rg.r0 + 1) + '×' + (rg.c1 - rg.c0 + 1) + ' · 값 ' + n + '개');
      if (numCount) {
        parts.push('합계 ' + (+sum.toFixed(10)).toLocaleString('ko-KR'));
        parts.push('평균 ' + (+(sum / numCount).toFixed(4)).toLocaleString('ko-KR'));
      }
    }
    const u = usedRange(s);
    parts.push('사용 범위 ' + (u.rows || 0) + '×' + (u.cols || 0));
    E.xSummary.textContent = parts.join('  ·  ');
    const dim = E.xDim;
    if (dim) dim.textContent = (u.rows || 0) + '행 × ' + (u.cols || 0) + '열';
  }

  function updateToolbar() {
    if (E.xUndo) E.xUndo.disabled = !S.undo.length;
    if (E.xRedo) E.xRedo.disabled = !S.redo.length;
  }

  function syncDirty() {
    document.body.classList.toggle('dirty', !!S.dirty);
    if (S.onChange) S.onChange({ dirty: S.dirty, name: S.fileName, sheets: S.sheets.length, active: cur() ? cur().name : '' });
  }

  function toastMsg(msg, kind) {
    if (window.OE && window.OE.toast) window.OE.toast(msg, kind);
  }
  function confirmBox(title, msg) {
    if (window.OE && window.OE.confirm) return window.OE.confirm(title, msg);
    return Promise.resolve(window.confirm(msg));
  }

  /* ── 이벤트 연결 ───────────────────────────────────── */
  function init(refs) {
    if (S.inited) return;
    S.inited = true;
    Object.assign(E, refs);

    const view = E.cellView;
    view.addEventListener('scroll', () => { scheduleRender(); }, { passive: true });

    view.addEventListener('mousedown', (e) => {
      const t = e.target.closest('.cell');
      if (!t) return;
      if (S.editing) commitEdit(false);
      const r = +t.dataset.r, c = +t.dataset.c;
      select(r, c, e.shiftKey);
      view.focus({ preventScroll: true });
      // 드래그 선택
      S.drag = { r, c, moved: false };
      e.preventDefault();
    });

    view.addEventListener('mousemove', (e) => {
      if (!S.drag) return;
      const t = e.target.closest && e.target.closest('.cell');
      if (!t) return;
      const r = +t.dataset.r, c = +t.dataset.c;
      if (r === S.drag.r && c === S.drag.c) return;
      S.drag.moved = true;
      S.selEnd = { r, c };
      paint.key = '';
      render();
    });

    window.addEventListener('mouseup', () => { S.drag = null; });

    view.addEventListener('dblclick', (e) => {
      const t = e.target.closest('.cell');
      if (!t) return;
      select(+t.dataset.r, +t.dataset.c, false);
      startEdit('');
    });

    view.addEventListener('keydown', onKey);
    E.cellEditor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(!e.shiftKey); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(false); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
    E.cellEditor.addEventListener('blur', () => { if (S.editing) commitEdit(false); });

    E.fxInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); applyValue(S.sel.r, S.sel.c, E.fxInput.value); paint.key = ''; render(); move(1, 0); }
      else if (e.key === 'Escape') { e.preventDefault(); renderFx(); E.cellView.focus({ preventScroll: true }); }
    });
    E.fxInput.addEventListener('focus', () => { E.fxInput.value = E.fxInput.value; });
    E.fxInput.addEventListener('blur', () => { renderFx(); });

    document.addEventListener('keydown', (e) => {
      if (!S.activeView) return;
      if (S.editing) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); copySel(); return; }
      if (meta && e.key.toLowerCase() === 'v') return; // paste 이벤트에서 처리
      if (meta) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1); }
      else if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === 'F2') { e.preventDefault(); startEdit(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSelection(); }
      else if (e.key === 'Escape') { if (!E.findbar.hidden) toggleFind(false); }
      else if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); startEdit(e.key); }
    });

    view.addEventListener('paste', (e) => {
      if (S.editing) return;
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (!text) return;
      e.preventDefault();
      pasteText(text);
    });

    // 툴바
    E.xUndo.addEventListener('click', undo);
    E.xRedo.addEventListener('click', redo);
    E.xRowAdd.addEventListener('click', insertRow);
    E.xRowDel.addEventListener('click', deleteRow);
    E.xColAdd.addEventListener('click', insertCol);
    E.xColDel.addEventListener('click', deleteCol);
    E.xSheetAdd.addEventListener('click', addSheet);
    E.xSheetRename.addEventListener('click', () => renameSheet(S.active));
    E.xSheetDel.addEventListener('click', () => deleteSheet(S.active));
    E.sheetAddBtn.addEventListener('click', addSheet);
    E.xFindToggle.addEventListener('click', () => toggleFind(E.findbar.hidden));
    E.findClose.addEventListener('click', () => toggleFind(false));
    E.findPrev.addEventListener('click', () => gotoHit(S.find.idx - 1));
    E.findNext.addEventListener('click', () => gotoHit(S.find.idx + 1));
    E.findInput.addEventListener('input', () => search(E.findInput.value));
    E.findInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); gotoHit(S.find.idx + (e.shiftKey ? -1 : 1)); }
      if (e.key === 'Escape') { e.preventDefault(); toggleFind(false); }
    });
  }

  function onKey(e) { /* 그리드 자체 키 이벤트는 document 핸들러에서 처리 */ }

  /* ── 공개 API ──────────────────────────────────────── */
  window.XL = {
    init,
    open: openFile,
    create: newBook,
    saveXlsx,
    saveCsv,
    hasChanges: () => S.dirty,
    getFileName: () => S.fileName,
    count: () => ({ sheets: S.sheets.length, active: cur() ? cur().name : '' }),
    setViewActive: (v) => {
      S.activeView = v;
      if (v) { E.cellView.focus({ preventScroll: true }); paint.key = ''; render(); }
      else { commitEdit(false); toggleFind(false); }
    },
    onChange: (fn) => { S.onChange = fn; },
    focusGrid: () => E.cellView && E.cellView.focus({ preventScroll: true })
  };
})();
