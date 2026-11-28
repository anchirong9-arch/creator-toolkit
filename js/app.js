/* 크리에이터 툴킷 — core: 라우터 · 공용 UI · 이미지/ZIP 유틸 */
(function () {
  'use strict';
  const CT = window.CT = window.CT || {};
  CT.VERSION = '1.0.6';

  /* ---------- tiny helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  CT.$ = $; CT.$$ = $$;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  CT.esc = esc;

  CT.fmtBytes = function (n) {
    if (!isFinite(n) || n < 0) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  };

  let toastTimer;
  CT.toast = function (msg, ms) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2400);
  };

  CT.debounce = function (fn, wait) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), wait);
    };
  };

  CT.uuid = function () {
    return Math.random().toString(36).slice(2, 9);
  };

  /* ---------- download ---------- */
  CT.download = function (blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 8000);
  };

  CT.saveCanvas = async function (canvas, name, type, quality) {
    const blob = await new Promise((res) => canvas.toBlob(res, type || 'image/png', quality));
    if (!blob) throw new Error('이미지를 만들지 못했어요');
    CT.download(blob, name);
    return blob;
  };

  CT.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  /* ---------- image loading (EXIF orientation respected) ---------- */
  CT.loadImage = async function (fileOrBlob) {
    if (window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
        return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close && bmp.close() };
      } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(fileOrBlob);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('이미지를 열 수 없어요 (HEIC는 설정에서 JPG로 저장 후 사용)'));
        i.src = url;
      });
      return { src: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, close: () => URL.revokeObjectURL(url) };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  };

  CT.drawTo = function (canvas, src, w, h, opts) {
    const ctx = canvas.getContext('2d');
    const o = opts || {};
    if (o.clear !== false) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    return ctx;
  };

  CT.yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  CT.baseName = function (name) {
    return String(name || 'file').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'file';
  };

  /* ---------- ZIP (store only) ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  CT.zip = async function (entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    const local = [], central = [];
    let offset = 0;
    const used = Object.create(null);

    for (const e of entries) {
      let name = e.name, n = 2;
      while (used[name]) {
        name = e.name.replace(/(\.[^.]+)?$/, '-' + n + '$1');
        n++;
      }
      used[name] = 1;
      const data = new Uint8Array(await e.blob.arrayBuffer());
      const nb = enc.encode(name);
      const crc = crc32(data);

      const lh = new Uint8Array(30 + nb.length);
      const d1 = new DataView(lh.buffer);
      d1.setUint32(0, 0x04034b50, true); d1.setUint16(4, 20, true); d1.setUint16(6, 0x0800, true);
      d1.setUint16(8, 0, true); d1.setUint16(10, dosTime, true); d1.setUint16(12, dosDate, true);
      d1.setUint32(14, crc, true); d1.setUint32(18, data.length, true); d1.setUint32(22, data.length, true);
      d1.setUint16(26, nb.length, true); d1.setUint16(28, 0, true);
      lh.set(nb, 30);
      local.push(lh, data);

      const ch = new Uint8Array(46 + nb.length);
      const d2 = new DataView(ch.buffer);
      d2.setUint32(0, 0x02014b50, true); d2.setUint16(4, 20, true); d2.setUint16(6, 20, true);
      d2.setUint16(8, 0x0800, true); d2.setUint16(10, 0, true);
      d2.setUint16(12, dosTime, true); d2.setUint16(14, dosDate, true);
      d2.setUint32(16, crc, true); d2.setUint32(20, data.length, true); d2.setUint32(24, data.length, true);
      d2.setUint16(28, nb.length, true); d2.setUint16(30, 0, true); d2.setUint16(32, 0, true);
      d2.setUint16(34, 0, true); d2.setUint16(36, 0, true); d2.setUint32(38, 0, true);
      d2.setUint32(42, offset, true);
      ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + data.length;
    }

    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const eocd = new Uint8Array(22);
    const d3 = new DataView(eocd.buffer);
    d3.setUint32(0, 0x06054b50, true);
    d3.setUint16(8, entries.length, true); d3.setUint16(10, entries.length, true);
    d3.setUint32(12, cdSize, true); d3.setUint32(16, offset, true);

    const blob = new Blob([].concat(local, central, [eocd]), { type: 'application/zip' });
    return blob;
  };

  /* ---------- shared UI ---------- */
  const ICON = {
    upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>'
  };
  CT.ICON = ICON;

  CT.ui = {};

  /* dropzone — 파일 입력이 영역 전체를 덮어 실제 탭/드롭을 그대로 받습니다 */
  CT.ui.drop = function (opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'drop';
    wrap.innerHTML =
      ICON.upload +
      '<b>' + esc(o.label || '파일 선택') + '</b>' +
      '<span>' + (o.hint ? esc(o.hint) : '탭해서 고르거나 끌어다 놓기') + '</span>';

    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'drop-input';
    input.setAttribute('aria-label', o.label || '파일 선택');
    input.accept = o.accept || 'image/*';
    input.multiple = o.multiple !== false;
    wrap.appendChild(input);

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      if (files.length && o.onFiles) o.onFiles(files);
    });
    ['dragenter', 'dragover'].forEach((t) => wrap.addEventListener(t, () => wrap.classList.add('over')));
    ['dragleave', 'drop', 'dragend'].forEach((t) => wrap.addEventListener(t, () => wrap.classList.remove('over')));
    return wrap;
  };

  /* segmented control */
  CT.ui.seg = function (opts) {
    const o = opts || {};
    const el = document.createElement('div');
    el.className = 'seg' + (o.wrap ? ' wrap' : '');
    let value = o.value != null ? o.value : (o.items[0] && o.items[0].value);
    el.innerHTML = o.items.map((it) =>
      '<button type="button" data-v="' + esc(it.value) + '" class="' + (it.value === value ? 'on' : '') + '">' + esc(it.label) + '</button>'
    ).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      set(b.dataset.v);
    });
    function set(v) {
      value = v;
      $$('button[data-v]', el).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      if (o.onChange) o.onChange(v);
    }
    el.getValue = () => value;
    el.setValue = set;
    return el;
  };

  /* range with label value */
  CT.ui.range = function (opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML =
      '<div class="label"><span>' + esc(o.label || '') + '</span><b data-v></b></div>' +
      '<input type="range" min="' + o.min + '" max="' + o.max + '" step="' + (o.step || 1) + '" value="' + o.value + '">';
    const input = $('input', wrap);
    const out = $('b[data-v]', wrap);
    function paint() {
      const v = +input.value;
      out.textContent = o.format ? o.format(v) : v;
      input.style.setProperty('--p', ((v - o.min) / (o.max - o.min) * 100) + '%');
    }
    input.addEventListener('input', () => { paint(); if (o.onInput) o.onInput(+input.value); });
    paint();
    wrap.input = input;
    wrap.getValue = () => +input.value;
    return wrap;
  };

  /* select */
  CT.ui.select = function (opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML =
      (o.label ? '<div class="label"><span>' + esc(o.label) + '</span></div>' : '') +
      '<select>' + o.items.map((i) => '<option value="' + esc(i.value) + '">' + esc(i.label) + '</option>').join('') + '</select>';
    const sel = $('select', wrap);
    if (o.value != null) sel.value = o.value;
    if (o.onChange) sel.addEventListener('change', () => o.onChange(sel.value));
    wrap.getValue = () => sel.value;
    wrap.select = sel;
    return wrap;
  };

  /* copy to clipboard with fallback */
  CT.copy = async function (text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      CT.toast('복사했어요');
      return true;
    } catch (e) {
      CT.toast('복사 실패 — 길게 눌러 직접 복사해 주세요');
      return false;
    }
  };

  CT.progress = function (labelEl) {
    return {
      start(msg) { if (labelEl) labelEl.textContent = msg || '처리 중…'; },
      step(i, n, msg) { if (labelEl) labelEl.textContent = (msg || '처리 중') + ' ' + i + '/' + n; },
      done(msg) { if (labelEl) labelEl.textContent = msg || ''; }
    };
  };

  /* ---------- registry & router ---------- */
  CT.tools = [];
  CT.register = function (t) { CT.tools.push(t); };

  const VIEW = () => $('#view');
  const TITLE = () => $('#toolTitle');

  function buildNav() {
    const bar = $('#tabbar');
    const items = [{ id: 'home', name: '홈', icon: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>' }].concat(CT.tools);
    bar.innerHTML = items.map((t) =>
      '<a class="tab" data-id="' + esc(t.id) + '" href="' + (t.href ? esc(t.href) : '#/' + esc(t.id)) + '">' + t.icon + '<span>' + esc(t.short || t.name) + '</span></a>'
    ).join('');
  }

  function renderHome() {
    const v = VIEW();
    v.innerHTML =
      '<section class="home-hero">' +
      '<h1>폰 안에서 끝내는<br><span>8가지 크리에이터 도구</span></h1>' +
      '<p>사진·PDF·링크를 올리면 브라우저 안에서만 처리해요. 서버로 보내지 않아서 유출 걱정이 없고, 홈 화면에 추가하면 앱처럼 열립니다.</p>' +
      '<div class="hero-badges"><span class="pill">서버 전송 0</span><span class="pill">설치 없이 사용</span><span class="pill">오프라인 OK</span><span class="pill">무료</span></div>' +
      '</section>' +
      '<section class="home-grid">' +
      CT.tools.map((t, i) =>
        '<a class="tool-link" href="' + (t.href ? esc(t.href) : '#/' + esc(t.id)) + '">' +
        '<span class="tool-ico">' + t.icon + '</span>' +
        '<span class="tool-meta"><b>' + esc(t.name) + '</b><span>' + esc(t.desc) + '</span></span>' +
        '</a>'
      ).join('') +
      '</section>' +
      '<p class="home-foot">모든 처리는 이 브라우저(내 폰) 안에서만 이루어집니다.<br>사진·PDF는 어디에도 업로드되지 않아요.<br>아이폰은 공유 → ‘홈 화면에 추가’, 안드로이드는 메뉴 → ‘앱 설치’<br><span style="opacity:.6">v' + CT.VERSION + '</span></p>';
  }

  function render() {
    const id = (location.hash.replace(/^#\/?/, '') || 'home');
    let tool = CT.tools.filter((t) => t.id === id)[0];
    if (tool && tool.href) { location.replace(tool.href); return; }
    const v = VIEW();
    document.body.classList.toggle('not-home', !!tool);
    TITLE().textContent = tool ? tool.name : '8가지 유틸리티';
    $$('#tabbar .tab').forEach((a) => a.classList.toggle('on', a.dataset.id === (tool ? tool.id : 'home')));
    const active = $('#tabbar .tab.on');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });

    if (!tool) { renderHome(); window.scrollTo(0, 0); return; }
    v.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'tool-head';
    head.innerHTML = '<h2>' + esc(tool.name) + '</h2><p>' + esc(tool.desc) + '</p>';
    v.appendChild(head);
    const body = document.createElement('div');
    v.appendChild(body);
    try {
      tool.mount(body);
    } catch (e) {
      body.innerHTML = '<div class="card"><b>이 도구를 여는 데 문제가 생겼어요.</b><p class="note">' + esc(e.message || e) + '</p></div>';
      console.error(e);
    }
    window.scrollTo(0, 0);
  }

  CT.start = function () {
    buildNav();
    window.addEventListener('hashchange', render);
    render();

    // 페이지 다른 곳에 파일을 떨어뜨렸을 때 브라우저가 그 파일로 이동하는 것을 막습니다.
    document.addEventListener('dragover', (e) => {
      if (!e.target.closest || !e.target.closest('.drop')) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (!e.target.closest || !e.target.closest('.drop')) e.preventDefault();
    });
    // PWA
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
      });
    }
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferred = e;
      const b = $('#installBtn');
      if (b) {
        b.hidden = false;
        b.addEventListener('click', async () => {
          b.hidden = true;
          try { deferred.prompt(); await deferred.userChoice; } catch (err) {}
          deferred = null;
        }, { once: true });
      }
    });
    window.addEventListener('appinstalled', () => CT.toast('홈 화면에 추가했어요'));
  };
})();
