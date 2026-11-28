/* ============================================================
   오피스 에디터 — 화면 컨트롤러
   파일 열기(형식 자동 판별) · 드래그 앤 드롭 · 모드 전환 · 저장 · 단축키
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OE = window.OE = window.OE || {};

  const refs = {};
  let mode = 'empty';        // empty | excel | pptx
  let busy = false;
  let toastTimer = null;

  /* ── 공용 UI ───────────────────────────────────────── */
  OE.toast = function (msg, kind) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 3600 : 2400);
  };

  OE.confirm = function (title, msg) {
    return new Promise((resolve) => {
      const modal = $('confirmModal');
      $('confirmTitle').textContent = title || '확인';
      $('confirmMsg').textContent = msg || '';
      modal.hidden = false;
      const done = (v) => {
        modal.hidden = true;
        $('confirmYes').removeEventListener('click', yes);
        $('confirmNo').removeEventListener('click', no);
        modal.removeEventListener('click', backdrop);
        document.removeEventListener('keydown', key, true);
        resolve(v);
      };
      const yes = () => done(true);
      const no = () => done(false);
      const backdrop = (e) => { if (e.target === modal) done(false); };
      const key = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.stopPropagation(); done(true); }
      };
      $('confirmYes').addEventListener('click', yes);
      $('confirmNo').addEventListener('click', no);
      modal.addEventListener('click', backdrop);
      document.addEventListener('keydown', key, true);
      setTimeout(() => $('confirmYes').focus(), 30);
    });
  };

  function fmtBytes(n) {
    if (!isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }

  /* ── 화면 전환 ─────────────────────────────────────── */
  function setMode(next) {
    if (mode === next) return;
    if (mode === 'excel' && next !== 'excel') window.XL.setViewActive(false);
    if (mode === 'pptx' && next !== 'pptx') window.PPTX.setViewActive(false);
    mode = next;
    document.body.dataset.mode = next;
    $('landingView').hidden = next !== 'empty';
    $('excelView').hidden = next !== 'excel';
    $('pptView').hidden = next !== 'pptx';
    $('docChip').hidden = next === 'empty';
    if (next === 'excel') {
      $('chipMode').textContent = '엑셀';
      window.XL.setViewActive(true);
      setTimeout(() => window.XL.focusGrid(), 30);
    } else if (next === 'pptx') {
      $('chipMode').textContent = '파워포인트';
      window.PPTX.setViewActive(true);
    }
    updateSaveMenu();
  }

  function updateSaveMenu() {
    const m = $('saveMenu');
    if (!m) return;
    m.querySelectorAll('[data-save]').forEach((b) => {
      const k = b.dataset.save;
      b.hidden = (k === 'pptx') ? mode !== 'pptx' : mode !== 'excel';
    });
  }

  function setChip(name, size) {
    $('chipName').textContent = name || '';
    $('chipSize').textContent = size ? fmtBytes(size) : '';
    $('docChip').hidden = mode === 'empty';
  }

  /* ── 파일 열기 ─────────────────────────────────────── */
  function fileKind(file) {
    const ext = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    if (ext === 'pptx' || ext === 'pptm' || ext === 'ppsx') return 'pptx';
    if (['xlsx', 'xlsb', 'xls', 'csv', 'txt', 'xlsm'].indexOf(ext) >= 0) return 'excel';
    return null;
  }

  async function guardUnsaved() {
    const dirty = (mode === 'excel' && window.XL.hasChanges()) || (mode === 'pptx' && window.PPTX.hasChanges());
    if (!dirty) return true;
    return OE.confirm('저장하지 않은 변경', '저장하지 않은 편집 내용이 있어요. 지금 열면 사라집니다. 계속할까요?');
  }

  async function openFile(file) {
    if (!file) return;
    const kind = fileKind(file);
    if (!kind) {
      OE.toast('지원하지 않는 형식이에요 · .xlsx .xlsb .xls .csv .pptx', 'err');
      return;
    }
    if (!(await guardUnsaved())) return;
    if (busy) return;
    busy = true;
    OE.toast(kind === 'excel' ? '엑셀 파일을 읽는 중…' : 'PPT 파일을 읽는 중…');
    try {
      if (kind === 'excel') {
        const info = await window.XL.open(file);
        setMode('excel');
        setChip(info.name, info.size);
        OE.toast('엑셀 문서를 열었어요 · 시트 ' + info.sheets + '개', 'ok');
      } else {
        const info = await window.PPTX.open(file);
        setMode('pptx');
        setChip(info.name, info.size);
        OE.toast('슬라이드 ' + info.slides + '장을 열었어요', 'ok');
      }
    } catch (e) {
      console.error(e);
      OE.toast('파일을 열지 못했어요 · ' + (e && e.message ? e.message : '알 수 없는 오류'), 'err');
    } finally {
      busy = false;
    }
  }

  async function newExcel() {
    if (!(await guardUnsaved())) return;
    window.XL.create();
    setMode('excel');
    setChip('새 엑셀.xlsx', 0);
    OE.toast('빈 엑셀 문서를 만들었어요', 'ok');
  }

  async function newPpt() {
    if (!(await guardUnsaved())) return;
    if (busy) return;
    busy = true;
    OE.toast('빈 프레젠테이션을 준비하는 중…');
    try {
      const info = await window.PPTX.createBlank('office/blank.pptx');
      setMode('pptx');
      setChip('새 프레젠테이션.pptx', info.size);
      OE.toast('빈 프레젠테이션을 만들었어요', 'ok');
    } catch (e) {
      console.error(e);
      OE.toast('새 PPT를 만들지 못했어요 · ' + (e && e.message ? e.message : ''), 'err');
    } finally {
      busy = false;
    }
  }

  /* ── 저장 ──────────────────────────────────────────── */
  async function save(kind) {
    if (mode === 'empty') { OE.toast('먼저 파일을 열거나 새 문서를 만들어 주세요'); return; }
    try {
      if (kind === 'csv') {
        const out = window.XL.saveCsv();
        if (out) OE.toast(out.name + ' 저장했어요 (' + fmtBytes(out.size) + ')', 'ok');
        return;
      }
      if (kind === 'pptx') {
        OE.toast('pptx를 만드는 중…');
        const out = await window.PPTX.save();
        setChip(out.name, out.size);
        OE.toast(out.name + ' 저장했어요 (' + fmtBytes(out.size) + ')', 'ok');
        return;
      }
      if (mode === 'pptx') {
        OE.toast('pptx를 만드는 중…');
        const out = await window.PPTX.save();
        setChip(out.name, out.size);
        OE.toast(out.name + ' 저장했어요 (' + fmtBytes(out.size) + ')', 'ok');
        return;
      }
      const out = window.XL.saveXlsx();
      setChip(out.name, out.size);
      OE.toast(out.name + ' 저장했어요 (' + fmtBytes(out.size) + ')', 'ok');
    } catch (e) {
      console.error(e);
      OE.toast('저장하지 못했어요 · ' + (e && e.message ? e.message : ''), 'err');
    }
  }

  /* ── 드래그 앤 드롭 ────────────────────────────────── */
  function initDrop() {
    let depth = 0;
    const overlay = $('dropOverlay');
    const show = (on) => { overlay.hidden = !on; };
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      depth++;
      show(true);
      e.preventDefault();
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    window.addEventListener('dragleave', (e) => {
      depth = Math.max(0, depth - 1);
      if (!depth) show(false);
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      depth = 0; show(false);
      openFile(e.dataTransfer.files[0]);
    });
    $('dropzone').addEventListener('click', () => $('fileInput').click());
    $('dropzone').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); }
    });
    $('fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) openFile(f);
    });
  }

  /* ── 메뉴 / 버튼 ───────────────────────────────────── */
  function initMenus() {
    const pairs = [
      [$('btnNew'), $('newMenu')],
      [$('btnSave'), $('saveMenu')]
    ];
    pairs.forEach(([btn, menu]) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        pairs.forEach(([, m]) => { m.hidden = true; });
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        updateSaveMenu();
      });
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-wrap')) pairs.forEach(([, m]) => { m.hidden = true; });
    });
    $('newMenu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-new]');
      if (!b) return;
      $('newMenu').hidden = true;
      if (b.dataset.new === 'xlsx') newExcel(); else newPpt();
    });
    $('saveMenu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-save]');
      if (!b) return;
      $('saveMenu').hidden = true;
      save(b.dataset.save);
    });

    $('btnOpen').addEventListener('click', () => $('fileInput').click());
    $('btnSave').addEventListener('click', (e) => {
      // 메뉴가 열려 있으면 첫 항목 실행, 아니면 주 동작
      if (!$('saveMenu').hidden) return;
      save(mode === 'pptx' ? 'pptx' : 'xlsx');
    });
    $('heroNewX').addEventListener('click', newExcel);
    $('heroNewP').addEventListener('click', newPpt);
    $('btnHelp').addEventListener('click', () => { $('helpModal').hidden = false; });
    $('helpClose').addEventListener('click', () => { $('helpModal').hidden = true; });
    $('helpModal').addEventListener('click', (e) => { if (e.target === $('helpModal')) $('helpModal').hidden = true; });
    $('cmpModal').addEventListener('click', (e) => { if (e.target === $('cmpModal')) $('cmpModal').hidden = true; });
  }

  /* ── 단축키 ────────────────────────────────────────── */
  function initKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!$('saveMenu').hidden) return;
        save(mode === 'pptx' ? 'pptx' : 'xlsx');
        return;
      }
      if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput').click(); return; }
      if (meta) return;
      if (e.key === 'Escape') {
        if (!$('helpModal').hidden) { $('helpModal').hidden = true; return; }
        if (!$('cmpModal').hidden) { $('cmpModal').hidden = true; return; }
        if (!$('newMenu').hidden) { $('newMenu').hidden = true; return; }
        if (!$('saveMenu').hidden) { $('saveMenu').hidden = true; return; }
      }
      if (mode === 'pptx' && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (typing) return;
        document.getElementById(e.key === 'ArrowUp' ? 'pUp' : 'pDown').click();
      }
    });
  }

  /* ── 시작 ──────────────────────────────────────────── */
  function boot() {
    Object.assign(refs, {
      landingView: $('landingView'), excelView: $('excelView'), pptView: $('pptView')
    });

    window.XL.init({
      cellView: $('cellView'), cellInner: $('cellInner'), cellEditor: $('cellEditor'),
      colheadView: $('colheadView'), colheadTrack: $('colheadTrack'),
      rowheadView: $('rowheadView'), rowheadTrack: $('rowheadTrack'),
      sheetTabs: $('sheetTabs'), sheetAddBtn: $('sheetAddBtn'),
      fxRef: $('fxRef'), fxInput: $('fxInput'),
      xSummary: $('xSummary'), xDim: $('xDim'),
      xUndo: $('xUndo'), xRedo: $('xRedo'),
      xRowAdd: $('xRowAdd'), xRowDel: $('xRowDel'), xColAdd: $('xColAdd'), xColDel: $('xColDel'),
      xSheetAdd: $('xSheetAdd'), xSheetRename: $('xSheetRename'), xSheetDel: $('xSheetDel'),
      xFindToggle: $('xFindToggle'), findbar: $('findbar'), findInput: $('findInput'),
      findCount: $('findCount'), findPrev: $('findPrev'), findNext: $('findNext'), findClose: $('findClose')
    });

    window.PPTX.init({
      thumbs: $('thumbs'), stageScroll: $('stageScroll'), canvasHold: $('canvasHold'),
      slideCanvas: $('slideCanvas'), inlineEditor: $('inlineEditor'),
      inspector: $('inspector'), inspHead: $('inspHead'), inspBody: $('inspBody'),
      pAdd: $('pAdd'), pDup: $('pDup'), pDel: $('pDel'), pUp: $('pUp'), pDown: $('pDown'),
      pPos: $('pPos'), pSizeInfo: $('pSizeInfo'), pCompress: $('pCompress'),
      cmpModal: $('cmpModal'), cmpClose: $('cmpClose'), cmpCancel: $('cmpCancel'),
      cmpApply: $('cmpApply'), cmpMax: $('cmpMax'), cmpQuality: $('cmpQuality'),
      cmpQLabel: $('cmpQLabel'), cmpList: $('cmpList'), cmpTotal: $('cmpTotal'),
      cmpFootInfo: $('cmpFootInfo')
    });

    window.XL.onChange((s) => {
      if (mode !== 'excel') return;
      setChip(s.name, null);
      if (!window.XL.hasChanges()) return;
    });
    window.PPTX.onChange((s) => {
      if (mode !== 'pptx') return;
      setChip(s.name, s.fileSize);
    });

    initDrop();
    initMenus();
    initKeys();
    setMode('empty');

    window.addEventListener('beforeunload', (e) => {
      const dirty = (mode === 'excel' && window.XL.hasChanges()) || (mode === 'pptx' && window.PPTX.hasChanges());
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });

    // 다른 페이지에서 파일을 넘겨받는 경우 (?open=... 는 쓰지 않음)
    if (window.__OE_ERRORS__ && window.__OE_ERRORS__.length) {
      console.warn('초기 오류:', window.__OE_ERRORS__);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
