/* ============================================================
   오피스 에디터 — 파워포인트 엔진 (JSZip)
   pptx 열기 · 슬라이드/텍스트 편집 · 순서·복제·삭제 · 이미지 압축 · 저장
   XML은 DOM으로 다뤄 서식을 건드리지 않고 <a:t> 글자만 바꿉니다.
   ============================================================ */
(function () {
  'use strict';

  const NS = {
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
    ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
    mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006'
  };
  const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
  const PT = 12700;

  const $ = (id) => document.getElementById(id);

  const S = {
    zip: null,
    presDoc: null,
    presRels: null,
    ctDoc: null,
    slides: [],
    sldSz: { cx: 12192000, cy: 6858000 },
    active: 0,
    fileName: '프레젠테이션.pptx',
    fileSize: 0,
    dirty: false,
    nextSlideNum: 1,
    media: {},          // path -> {url, type, size}
    mediaUrls: [],
    sel: -1,            // 선택된 텍스트 상자 인덱스
    canvasW: 900,
    cmp: null,
    inited: false,
    onChange: null,
    inline: null
  };

  const E = {};

  /* ── 공통 유틸 ─────────────────────────────────────── */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function fmtBytes(n) {
    if (!isFinite(n) || n < 0) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.getElementsByTagName('parsererror');
    if (err && err.length) throw new Error('pptx 내부 XML을 읽지 못했어요');
    return doc;
  }
  function serializeXml(doc) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + new XMLSerializer().serializeToString(doc);
  }
  function dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function resolvePath(base, target) {
    if (!target) return '';
    if (target.charAt(0) === '/') return target.slice(1);
    const parts = (base ? base.split('/') : []).concat(target.split('/'));
    const out = [];
    parts.forEach((seg) => {
      if (!seg || seg === '.') return;
      if (seg === '..') out.pop(); else out.push(seg);
    });
    return out.join('/');
  }
  function relsPathFor(part) {
    const d = dirOf(part);
    const f = part.slice(d ? d.length + 1 : 0);
    return (d ? d + '/' : '') + '_rels/' + f + '.rels';
  }
  function kids(el) { return el ? Array.from(el.children || []) : []; }
  function child(el, ns, name) {
    if (!el) return null;
    for (const c of kids(el)) if (c.namespaceURI === ns && c.localName === name) return c;
    return null;
  }
  function findAll(el, ns, name) {
    return el ? Array.from(el.getElementsByTagNameNS(ns, name)) : [];
  }
  function first(el, ns, name) {
    if (!el) return null;
    const list = el.getElementsByTagNameNS(ns, name);
    return list && list.length ? list[0] : null;
  }
  function numAttr(el, name, def) {
    if (!el) return def;
    const v = el.getAttribute(name);
    const n = parseFloat(v);
    return isFinite(n) ? n : def;
  }

  async function loadRels(part) {
    const f = S.zip.file(relsPathFor(part));
    if (!f) return null;
    return parseXml(await f.async('string'));
  }
  function relMap(relsDoc, baseDir) {
    const map = {};
    if (!relsDoc) return map;
    findAll(relsDoc, NS.rel, 'Relationship').forEach((r) => {
      map[r.getAttribute('Id')] = {
        target: resolvePath(baseDir, r.getAttribute('Target')),
        type: r.getAttribute('Type') || '',
        mode: r.getAttribute('TargetMode') || ''
      };
    });
    return map;
  }
  function ridOf(el) {
    return el && (el.getAttributeNS(NS.r, 'id') || el.getAttribute('r:embed') || el.getAttribute('r:id'));
  }

  /* ── 열기 ──────────────────────────────────────────── */
  async function openFile(file) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    if (!zip.file('ppt/presentation.xml')) throw new Error('pptx 파일이 아니에요 (ppt/presentation.xml 없음)');
    clearMedia();
    S.zip = zip;
    S.ctDoc = null;
    S.fileName = file.name;
    S.fileSize = file.size;
    S.dirty = false;
    S.sel = -1;
    S.presDoc = parseXml(await zip.file('ppt/presentation.xml').async('string'));
    S.presRels = await loadRels('ppt/presentation.xml');

    const sldSz = first(S.presDoc, NS.p, 'sldSz');
    if (sldSz) S.sldSz = { cx: numAttr(sldSz, 'cx', 12192000), cy: numAttr(sldSz, 'cy', 6858000) };

    const rmap = relMap(S.presRels, 'ppt');
    const sldIds = findAll(S.presDoc, NS.p, 'sldId');
    S.slides = [];
    let maxNum = 0;
    for (const el of sldIds) {
      const rid = ridOf(el);
      const rel = rmap[rid];
      if (!rel || !rel.target) continue;
      const part = rel.target;
      const f = zip.file(part);
      if (!f) continue;
      const doc = parseXml(await f.async('string'));
      const relsDoc = await loadRels(part);
      const m = part.match(/slide(\d+)\.xml$/);
      if (m) maxNum = Math.max(maxNum, +m[1]);
      S.slides.push({
        part, doc, relsDoc, relsMap: relMap(relsDoc, dirOf(part)),
        sldIdEl: el, rid, dirty: false, layoutMap: null, uiShapes: []
      });
    }
    S.nextSlideNum = maxNum + 1;
    if (!S.slides.length) throw new Error('슬라이드를 찾지 못했어요');
    S.active = 0;
    await preloadMedia();
    renderAll();
    return { name: file.name, size: file.size, slides: S.slides.length };
  }

  async function createBlank(tplUrl) {
    const res = await fetch(tplUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('빈 문서 템플릿을 불러오지 못했어요 (' + res.status + ')');
    const blob = await res.blob();
    const file = new File([blob], '새 프레젠테이션.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const info = await openFile(file);
    S.fileName = '새 프레젠테이션.pptx';
    S.dirty = false;
    syncDirty();
    return info;
  }

  /* ── 이미지 미리 읽기 ──────────────────────────────── */
  function clearMedia() {
    (S.mediaUrls || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    S.mediaUrls = [];
    S.media = {};
  }

  function guessType(path) {
    const ext = (path.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
    return 'application/octet-stream';
  }

  async function preloadMedia() {
    const want = new Set();
    S.slides.forEach((s) => {
      Object.keys(s.relsMap).forEach((rid) => {
        const rel = s.relsMap[rid];
        if (/\/image$/.test(rel.type) && !rel.mode) want.add(rel.target);
      });
    });
    for (const path of want) {
      if (S.media[path]) continue;
      const f = S.zip.file(path);
      if (!f) continue;
      const blob = await f.async('blob');
      const type = guessType(path);
      if (type === 'application/octet-stream') continue;
      const url = URL.createObjectURL(new Blob([blob], { type }));
      S.media[path] = { url, type, size: blob.size };
      S.mediaUrls.push(url);
    }
  }

  /* ── 렌더 ──────────────────────────────────────────── */
  function slideBg(slide) {
    const bg = first(slide.doc, NS.p, 'bg');
    if (!bg) return null;
    const clr = first(bg, NS.a, 'srgbClr');
    if (clr) return '#' + clr.getAttribute('val');
    return null;
  }

  function xfrmOf(el) {
    if (!el) return null;
    const spPr = child(el, NS.p, 'spPr') || child(el, NS.p, 'grpSpPr') || child(el, NS.p, 'xfrm');
    let xf = null;
    if (spPr) {
      if (spPr.localName === 'xfrm') xf = spPr;
      else xf = first(spPr, NS.a, 'xfrm');
    }
    if (!xf) {
      const all = first(el, NS.p, 'xfrm') || first(el, NS.a, 'xfrm');
      if (all) xf = all;
    }
    if (!xf) return null;
    const off = child(xf, NS.a, 'off');
    const ext = child(xf, NS.a, 'ext');
    const chOff = child(xf, NS.a, 'chOff');
    const chExt = child(xf, NS.a, 'chExt');
    return {
      x: numAttr(off, 'x', 0), y: numAttr(off, 'y', 0),
      w: numAttr(ext, 'cx', 0), h: numAttr(ext, 'cy', 0),
      chx: numAttr(chOff, 'x', 0), chy: numAttr(chOff, 'y', 0),
      chw: numAttr(chExt, 'cx', 0), chh: numAttr(chExt, 'cy', 0),
      rot: numAttr(xf, 'rot', 0) / 60000
    };
  }

  async function layoutXfrm(slide) {
    if (slide.layoutMap) return slide.layoutMap;
    slide.layoutMap = {};
    const rel = Object.keys(slide.relsMap).map((k) => slide.relsMap[k]).filter((r) => /\/slideLayout$/.test(r.type))[0];
    if (!rel) return slide.layoutMap;
    const f = S.zip.file(rel.target);
    if (!f) return slide.layoutMap;
    try {
      const doc = parseXml(await f.async('string'));
      findAll(doc, NS.p, 'sp').forEach((sp) => {
        const ph = first(sp, NS.p, 'ph');
        if (!ph) return;
        const key = ph.getAttribute('idx') || 't:' + (ph.getAttribute('type') || 'body');
        const xf = xfrmOf(sp);
        if (xf) slide.layoutMap[key] = xf;
      });
    } catch (e) { /* 레이아웃을 못 읽어도 계속 */ }
    return slide.layoutMap;
  }

  async function precomputeLayouts() {
    for (const s of S.slides) await layoutXfrm(s);
  }

  function phKey(el) {
    const ph = first(el, NS.p, 'ph');
    if (!ph) return null;
    return ph.getAttribute('idx') || 't:' + (ph.getAttribute('type') || 'body');
  }

  function colorOf(fillEl) {
    if (!fillEl) return null;
    const srgb = first(fillEl, NS.a, 'srgbClr');
    if (srgb) {
      const alpha = first(srgb, NS.a, 'alpha');
      if (alpha) return 'rgba(' + hex2rgb(srgb.getAttribute('val')) + ',' + (numAttr(alpha, 'val', 100000) / 100000) + ')';
      return '#' + srgb.getAttribute('val');
    }
    const scheme = first(fillEl, NS.a, 'schemeClr');
    if (scheme) {
      const v = scheme.getAttribute('val');
      const map = { bg1: '#ffffff', bg2: '#f2f2f2', tx1: '#000000', tx2: '#333333', dk1: '#000000', lt1: '#ffffff', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1' };
      if (map[v]) return map[v];
    }
    return null;
  }
  function hex2rgb(h) {
    h = String(h || '000000');
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0].join(',');
  }

  function renderSlideInto(container, slide, width, interactive) {
    const { cx, cy } = S.sldSz;
    const scale = width / cx;
    const pxPerPt = scale * PT;
    container.style.width = Math.round(width) + 'px';
    container.style.height = Math.round(cy * scale) + 'px';
    container.style.background = slideBg(slide) || '#ffffff';
    container.innerHTML = '';
    slide.uiShapes = [];
    const tree = first(slide.doc, NS.p, 'spTree');
    if (!tree) return;
    const ctx = { ax: 0, ay: 0, kx: 1, ky: 1 };
    renderChildren(tree, container, ctx, slide, scale, pxPerPt, interactive);
  }

  function renderChildren(parent, box, ctx, slide, scale, pxPerPt, interactive) {
    kids(parent).forEach((el) => {
      const ns = el.namespaceURI, ln = el.localName;
      if (ns === NS.mc && ln === 'AlternateContent') {
        const fb = child(el, NS.mc, 'Fallback') || child(el, NS.mc, 'Choice');
        if (fb) renderChildren(fb, box, ctx, slide, scale, pxPerPt, interactive);
        return;
      }
      if (ns !== NS.p) return;
      if (ln === 'sp') renderSp(el, box, ctx, slide, scale, pxPerPt, interactive);
      else if (ln === 'pic') renderPic(el, box, ctx, slide, scale);
      else if (ln === 'graphicFrame') renderFrame(el, box, ctx, slide, scale, pxPerPt);
      else if (ln === 'grpSp') renderGroup(el, box, ctx, slide, scale, pxPerPt, interactive);
      else if (ln === 'cxnSp') renderCxn(el, box, ctx, slide, scale);
    });
  }

  function place(el, box, ctx, slide, scale, xf) {
    const px = (v) => Math.round(v * scale * 100) / 100;
    const left = px(ctx.ax + xf.x * ctx.kx);
    const top = px(ctx.ay + xf.y * ctx.ky);
    const w = px(xf.w * ctx.kx);
    const h = px(xf.h * ctx.ky);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = Math.max(w, 1) + 'px';
    el.style.height = Math.max(h, 1) + 'px';
    if (xf.rot) el.style.transform = 'rotate(' + xf.rot + 'deg)';
    return { left, top, w, h };
  }

  function shapeBox(el, parent, ctx, slide, scale) {
    const xf = xfrmOf(el) || (function () {
      const k = phKey(el);
      return k && slide.layoutMap ? slide.layoutMap[k] : null;
    })();
    if (!xf) return null;
    const box = document.createElement('div');
    box.className = 'shape';
    place(box, parent, ctx, slide, scale, xf);
    parent.appendChild(box);
    return box;
  }

  function fillOf(el) {
    const spPr = child(el, NS.p, 'spPr');
    if (!spPr) return null;
    const solid = child(spPr, NS.a, 'solidFill');
    if (solid) return colorOf(solid);
    return null;
  }
  function strokeOf(el) {
    const spPr = child(el, NS.p, 'spPr');
    if (!spPr) return null;
    const ln = child(spPr, NS.a, 'ln');
    if (!ln) return null;
    const sf = child(ln, NS.a, 'solidFill');
    if (!sf) return null;
    return { color: colorOf(sf), width: numAttr(ln, 'w', 9525) / 12700 };
  }

  function renderSp(el, parent, ctx, slide, scale, pxPerPt, interactive) {
    const box = shapeBox(el, parent, ctx, slide, scale);
    if (!box) return;
    const ph = first(el, NS.p, 'ph');
    const geom = first(el, NS.a, 'prstGeom');
    const prst = geom ? geom.getAttribute('prst') : '';
    const fill = fillOf(el);
    const stroke = strokeOf(el);
    if (fill) box.style.background = fill;
    if (stroke && stroke.color) box.style.border = Math.max(1, Math.round(stroke.width * scale * 2)) + 'px solid ' + stroke.color;
    if (prst === 'ellipse') box.style.borderRadius = '50%';
    else if (prst === 'roundRect') box.style.borderRadius = Math.round(12 * scale * 100) + 'px';
    else if (prst === 'triangle') box.style.clipPath = 'polygon(50% 0,100% 100%,0 100%)';

    const txBody = child(el, NS.p, 'txBody');
    const texts = txBody ? findAll(txBody, NS.a, 't') : [];
    if (!texts.length) return;
    box.classList.add('text');
    box.style.overflow = 'hidden';
    fillTextBox(el, box, txBody, scale, pxPerPt);

    // 목록·선택용
    const idx = slide.uiShapes.length;
    box.dataset.si = String(idx);
    box.__xml = el;
    const paras = findAll(txBody, NS.a, 'p').map((p, pi) => ({ i: pi, text: findAll(p, NS.a, 't').map((t) => t.textContent).join('') }));
    slide.uiShapes.push({
      el, box, idx, paras,
      label: (ph && (ph.getAttribute('type') || 'placeholder')) || ('텍스트 상자 ' + (idx + 1))
    });
    if (interactive) attachShapeEvents(box, slide, idx);
  }

  function fillTextBox(shapeEl, box, txBody, scale, pxPerPt) {
    const bodyPr = first(txBody, NS.a, 'bodyPr');
    const anchor = bodyPr ? (bodyPr.getAttribute('anchor') || 't') : 't';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
    const lIns = numAttr(bodyPr, 'lIns', 91440) * scale;
    const rIns = numAttr(bodyPr, 'rIns', 91440) * scale;
    const tIns = numAttr(bodyPr, 'tIns', 45720) * scale;
    const bIns = numAttr(bodyPr, 'bIns', 45720) * scale;
    box.style.padding = Math.round(tIns) + 'px ' + Math.round(rIns) + 'px ' + Math.round(bIns) + 'px ' + Math.round(lIns) + 'px';
    const wrap = bodyPr ? (bodyPr.getAttribute('wrap') || 'square') : 'square';
    box.style.whiteSpace = wrap === 'none' ? 'nowrap' : 'normal';
    if (bodyPr && bodyPr.getAttribute('vert')) box.style.writingMode = 'vertical-rl';

    const pPrDefault = first(txBody, NS.a, 'lstStyle');
    const paras = findAll(txBody, NS.a, 'p');
    paras.forEach((p) => {
      const pPr = child(p, NS.a, 'pPr');
      const algn = pPr ? (pPr.getAttribute('algn') || 'l') : 'l';
      const div = document.createElement('div');
      div.className = 'para';
      div.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';
      const spcAft = pPr ? first(pPr, NS.a, 'spcAft') : null;
      if (spcAft) {
        const pts = first(spcAft, NS.a, 'spcPts');
        if (pts) div.style.marginBottom = Math.round(numAttr(pts, 'val', 0) / 100 * pxPerPt) + 'px';
      }
      const lnSpc = pPr ? first(pPr, NS.a, 'lnSpc') : null;
      if (lnSpc) {
        const pct = first(lnSpc, NS.a, 'spcPct');
        if (pct) div.style.lineHeight = String(clamp(numAttr(pct, 'val', 100000) / 100000, 0.6, 3));
      }
      let wrote = false;
      kids(p).forEach((r) => {
        if (r.namespaceURI !== NS.a) return;
        if (r.localName === 'r' || r.localName === 'fld') {
          const t = child(r, NS.a, 't');
          const text = t ? t.textContent : '';
          const span = document.createElement('span');
          span.textContent = text;
          const rPr = child(r, NS.a, 'rPr');
          if (rPr) {
            const sz = numAttr(rPr, 'sz', 0);
            if (sz) span.style.fontSize = (sz / 100 * pxPerPt).toFixed(2) + 'px';
            if (rPr.getAttribute('b') === '1') span.style.fontWeight = '700';
            if (rPr.getAttribute('i') === '1') span.style.fontStyle = 'italic';
            const u = rPr.getAttribute('u');
            if (u && u !== 'none') span.style.textDecoration = 'underline';
            const sf = child(rPr, NS.a, 'solidFill');
            const col = sf ? colorOf(sf) : null;
            if (col) span.style.color = col;
            const latin = child(rPr, NS.a, 'latin');
            const face = latin && latin.getAttribute('typeface');
            if (face && face.charAt(0) !== '+') span.style.fontFamily = '"' + face + '", sans-serif';
          }
          div.appendChild(span);
          wrote = true;
        } else if (r.localName === 'br') {
          div.appendChild(document.createElement('br'));
          wrote = true;
        }
      });
      if (!wrote) div.appendChild(document.createTextNode('\u200b'));
      box.appendChild(div);
    });
  }

  function renderPic(el, parent, ctx, slide, scale) {
    const xf = xfrmOf(el);
    if (!xf) return;
    const box = document.createElement('div');
    box.className = 'shape pic';
    place(box, parent, ctx, slide, scale, xf);
    box.style.overflow = 'hidden';
    const blip = first(el, NS.a, 'blip');
    const rid = blip ? ridOf(blip) : null;
    const rel = rid ? slide.relsMap[rid] : null;
    const media = rel ? S.media[rel.target] : null;
    if (media) {
      const img = document.createElement('img');
      img.src = media.url;
      img.alt = '';
      img.draggable = false;
      img.style.objectFit = 'fill';
      box.appendChild(img);
    } else {
      box.style.background = 'rgba(124,139,255,.10)';
      box.style.border = '1px dashed rgba(124,139,255,.5)';
      box.style.display = 'grid';
      box.style.placeItems = 'center';
      box.style.fontSize = Math.max(9, scale * 90000) + 'px';
      box.style.color = '#7c8bff';
      box.textContent = rel ? '이미지' : '';
    }
    parent.appendChild(box);
  }

  function renderGroup(el, parent, ctx, slide, scale, pxPerPt, interactive) {
    const xf = xfrmOf(el);
    let childCtx = ctx;
    if (xf && xf.chw && xf.chh) {
      const kx = (xf.w / xf.chw) * ctx.kx;
      const ky = (xf.h / xf.chh) * ctx.ky;
      childCtx = {
        ax: ctx.ax + (xf.x - xf.chx * (xf.w / xf.chw)) * ctx.kx,
        ay: ctx.ay + (xf.y - xf.chy * (xf.h / xf.chh)) * ctx.ky,
        kx, ky
      };
    } else if (xf) {
      childCtx = { ax: ctx.ax + xf.x * ctx.kx, ay: ctx.ay + xf.y * ctx.ky, kx: ctx.kx, ky: ctx.ky };
    }
    renderChildren(el, parent, childCtx, slide, scale, pxPerPt, interactive);
  }

  function renderFrame(el, parent, ctx, slide, scale, pxPerPt) {
    const xf = xfrmOf(el);
    if (!xf) return;
    const box = document.createElement('div');
    box.className = 'shape frame';
    place(box, parent, ctx, slide, scale, xf);
    box.style.overflow = 'hidden';
    const tbl = first(el, NS.a, 'tbl');
    if (tbl) {
      const table = document.createElement('table');
      findAll(tbl, NS.a, 'tr').forEach((tr) => {
        const row = document.createElement('tr');
        findAll(tr, NS.a, 'tc').forEach((tc) => {
          const td = document.createElement('td');
          const tcPr = child(tc, NS.a, 'tcPr');
          if (tcPr) {
            const sf = child(tcPr, NS.a, 'solidFill');
            const col = sf ? colorOf(sf) : null;
            if (col) td.style.background = col;
          }
          const tx = child(tc, NS.a, 'txBody');
          if (tx) {
            const texts = findAll(tx, NS.a, 't').map((t) => t.textContent).join('');
            td.textContent = texts;
            const rPr = first(tx, NS.a, 'rPr');
            if (rPr) {
              const sz = numAttr(rPr, 'sz', 0);
              if (sz) td.style.fontSize = (sz / 100 * pxPerPt).toFixed(2) + 'px';
              if (rPr.getAttribute('b') === '1') td.style.fontWeight = '700';
              const sf2 = child(rPr, NS.a, 'solidFill');
              const col2 = sf2 ? colorOf(sf2) : null;
              if (col2) td.style.color = col2;
            }
          }
          row.appendChild(td);
        });
        table.appendChild(row);
      });
      box.appendChild(table);
      box.dataset.tbl = '1';
    } else {
      box.style.border = '1px dashed rgba(124,139,255,.45)';
      box.style.display = 'grid';
      box.style.placeItems = 'center';
      box.style.color = '#7c8bff';
      box.style.fontSize = Math.max(10, scale * 100000) + 'px';
      box.textContent = first(el, NS.p, 'graphic') ? '차트 · 개체' : '';
    }
    parent.appendChild(box);
  }

  function renderCxn(el, parent, ctx, slide, scale) {
    const xf = xfrmOf(el);
    if (!xf) return;
    const box = document.createElement('div');
    box.className = 'shape cxn';
    place(box, parent, ctx, slide, scale, xf);
    const stroke = strokeOf(el);
    box.style.borderTop = '2px solid ' + (stroke && stroke.color ? stroke.color : '#888');
    parent.appendChild(box);
  }

  function attachShapeEvents(box, slide, idx) {
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      selectShape(idx);
    });
    box.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const para = e.target.closest && e.target.closest('.para');
      const pIdx = para ? Array.prototype.indexOf.call(box.querySelectorAll('.para'), para) : 0;
      selectShape(idx);
      startInline(idx, Math.max(0, pIdx));
    });
  }

  /* ── 화면 조립 ─────────────────────────────────────── */
  function canvasWidth() {
    const stage = E.stageScroll;
    const w = stage ? stage.clientWidth - 6 : 900;
    return Math.max(320, Math.min(w, 1180));
  }

  function renderAll() {
    renderThumbs();
    renderCanvas();
    renderInspector();
    renderToolbar();
    renderPreview();
    syncDirty();
  }

  function slideRatioLabel() {
    const r = S.sldSz.cx / S.sldSz.cy;
    if (Math.abs(r - 16 / 9) < 0.02) return '16:9';
    if (Math.abs(r - 4 / 3) < 0.02) return '4:3';
    if (Math.abs(r - 16 / 10) < 0.02) return '16:10';
    return (S.sldSz.cx / 914400).toFixed(2) + '×' + (S.sldSz.cy / 914400).toFixed(2) + 'in';
  }

  function renderPreview() {
    if (!E.pvBar) return;
    if (!S.slides.length) { E.pvBar.hidden = true; return; }
    E.pvBar.hidden = false;
    E.pvName.textContent = S.fileName;
    E.pvMeta.textContent = '슬라이드 ' + S.slides.length + '장 · ' + fmtBytes(S.fileSize) + ' · ' + slideRatioLabel() +
      ' · 텍스트 상자 ' + (S.slides[S.active] ? S.slides[S.active].uiShapes.length : 0) + '개';
    if (E.stageCap) {
      const sel = S.sel >= 0 && S.slides[S.active] && S.slides[S.active].uiShapes[S.sel];
      E.stageCap.textContent = sel
        ? '“' + (shPreviewText(sel) || sel.label) + '” 선택됨 · 오른쪽에서 문단 편집'
        : '텍스트를 클릭해 선택 · 더블클릭하면 그 자리에서 수정';
    }
  }

  function shPreviewText(sh) {
    const t = sh.paras.map((p) => p.text).join(' ').trim();
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }

  function renderThumbs() {
    const box = E.thumbs;
    if (!box) return;
    box.innerHTML = '';
    S.slides.forEach((slide, i) => {
      const t = document.createElement('div');
      t.className = 'thumb' + (i === S.active ? ' active' : '');
      t.dataset.i = i;
      const no = document.createElement('div');
      no.className = 'thumb-no';
      no.textContent = i + 1;
      const tb = document.createElement('div');
      tb.className = 'thumb-box';
      const cv = document.createElement('div');
      cv.className = 'slide-canvas';
      cv.style.pointerEvents = 'none';
      tb.appendChild(cv);
      t.appendChild(no); t.appendChild(tb);
      t.addEventListener('click', () => { if (S.active !== i) { commitInline(); S.active = i; S.sel = -1; renderAll(); } });
      box.appendChild(t);
      slide.thumbCanvas = cv;
    });
    // 썸네일은 조금씩 그려 화면이 멈추지 않게
    let i = 0;
    const step = () => {
      const max = Math.min(i + 3, S.slides.length);
      for (; i < max; i++) {
        const s = S.slides[i];
        if (s.thumbCanvas) renderSlideInto(s.thumbCanvas, s, 128, false);
      }
      if (i < S.slides.length) setTimeout(step, 12);
    };
    step();
  }

  function renderCanvas() {
    const slide = S.slides[S.active];
    const cv = E.slideCanvas;
    if (!slide || !cv) return;
    const w = canvasWidth();
    S.canvasW = w;
    renderSlideInto(cv, slide, w, true);
    applySelection();
    E.pPos.textContent = (S.active + 1) + ' / ' + S.slides.length;
    if (E.pSizeInfo) E.pSizeInfo.textContent = fmtBytes(S.fileSize);
  }

  function onCanvasClick(e) {
    if (e.target === E.slideCanvas) { S.sel = -1; applySelection(); renderInspector(); }
  }

  function applySelection() {
    const slide = S.slides[S.active];
    if (!slide) return;
    slide.uiShapes.forEach((s) => s.box.classList.toggle('selected', s.idx === S.sel));
    renderPreview();
  }

  function selectShape(idx) {
    commitInline();
    S.sel = idx;
    applySelection();
    renderInspector();
    const sh = S.slides[S.active].uiShapes[idx];
    if (sh) {
      E.inspBody.scrollTop = 0;
      const ta = E.inspBody.querySelector('textarea');
      if (ta) { ta.focus(); const n = ta.value.length; try { ta.setSelectionRange(n, n); } catch (e) {} }
    }
  }

  /* ── 텍스트 편집 ───────────────────────────────────── */
  function paragraphNodes(xmlEl) {
    const tx = child(xmlEl, NS.p, 'txBody');
    return tx ? findAll(tx, NS.a, 'p') : [];
  }

  function ensureRun(p) {
    const doc = p.ownerDocument;
    let run = child(p, NS.a, 'r');
    if (run) return run;
    run = doc.createElementNS(NS.a, 'a:r');
    const end = child(p, NS.a, 'endParaRPr');
    const pPr = child(p, NS.a, 'pPr');
    const defRPr = pPr ? child(pPr, NS.a, 'defRPr') : null;
    const template = end || defRPr;
    if (template) {
      const rPr = doc.createElementNS(NS.a, 'a:rPr');
      Array.from(template.attributes).forEach((a) => {
        if (a.name === 'lang') return;
        try { rPr.setAttribute(a.name, a.value); } catch (e) {}
      });
      run.appendChild(rPr);
    }
    const t = doc.createElementNS(NS.a, 'a:t');
    t.setAttribute('xml:space', 'preserve');
    run.appendChild(t);
    const endEl = child(p, NS.a, 'endParaRPr');
    if (endEl) p.insertBefore(run, endEl); else p.appendChild(run);
    return run;
  }

  function setParagraphText(xmlEl, pIdx, text) {
    const paras = paragraphNodes(xmlEl);
    const p = paras[pIdx];
    if (!p) return false;
    const run = ensureRun(p);
    // 문단 안의 나머지 런·개행 제거 (첫 런의 서식 유지)
    kids(p).forEach((n) => {
      if (n.namespaceURI !== NS.a) return;
      if (n === run) return;
      if (n.localName === 'r' || n.localName === 'br' || n.localName === 'fld') p.removeChild(n);
    });
    let t = child(run, NS.a, 't');
    if (!t) {
      t = p.ownerDocument.createElementNS(NS.a, 'a:t');
      run.appendChild(t);
    }
    Array.from(run.getElementsByTagNameNS(NS.a, 't')).slice(1).forEach((x) => x.parentNode.removeChild(x));
    t.textContent = text;
    t.setAttribute('xml:space', 'preserve');
    return true;
  }

  function markDirty(slide) {
    S.dirty = true;
    if (slide) slide.dirty = true;
    syncDirty();
  }

  function refreshSlide(slide, activeCanvas) {
    // 편집한 슬라이드의 썸네일과 캔버스를 다시 그립니다
    const i = S.slides.indexOf(slide);
    if (slide.thumbCanvas) renderSlideInto(slide.thumbCanvas, slide, 128, false);
    if (activeCanvas && i === S.active) {
      renderSlideInto(E.slideCanvas, slide, S.canvasW, true);
      applySelection();
    }
    if (i === S.active) renderInspector();
  }

  function startInline(idx, pIdx) {
    const slide = S.slides[S.active];
    const sh = slide.uiShapes[idx];
    if (!sh) return;
    const paras = paragraphNodes(sh.el);
    if (!paras[pIdx]) return;
    const paraEls = sh.box.querySelectorAll('.para');
    const target = paraEls[pIdx];
    if (!target) return;
    const cvRect = E.slideCanvas.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const ed = E.inlineEditor;
    const cs = window.getComputedStyle(target);
    ed.style.left = (r.left - cvRect.left) + 'px';
    ed.style.top = (r.top - cvRect.top) + 'px';
    ed.style.width = Math.max(r.width + 8, 60) + 'px';
    ed.style.height = Math.max(r.height + 4, 22) + 'px';
    ed.style.fontSize = cs.fontSize;
    ed.style.fontFamily = cs.fontFamily;
    ed.style.fontWeight = cs.fontWeight;
    ed.style.color = cs.color;
    ed.style.textAlign = cs.textAlign;
    ed.value = sh.paras[pIdx] ? sh.paras[pIdx].text : '';
    ed.hidden = false;
    ed.focus();
    try { ed.setSelectionRange(ed.value.length, ed.value.length); } catch (e) {}
    S.inline = { idx, pIdx };
  }

  function commitInline() {
    if (!S.inline) return;
    const { idx, pIdx } = S.inline;
    const ed = E.inlineEditor;
    const text = ed.value.replace(/\r?\n/g, ' ');
    S.inline = null;
    ed.hidden = true;
    const slide = S.slides[S.active];
    const sh = slide && slide.uiShapes[idx];
    if (!sh) return;
    if (sh.paras[pIdx] && sh.paras[pIdx].text === text) return;
    setParagraphText(sh.el, pIdx, text);
    markDirty(slide);
    refreshSlide(slide, true);
  }

  /* ── 인스펙터 ──────────────────────────────────────── */
  function renderInspector() {
    const body = E.inspBody;
    const head = E.inspHead;
    if (!body) return;
    const slide = S.slides[S.active];
    if (!slide) { body.innerHTML = ''; return; }
    const shapes = slide.uiShapes;
    if (S.sel >= 0 && shapes[S.sel]) {
      head.textContent = '텍스트 편집';
      const sh = shapes[S.sel];
      let html = '<div class="selected-head"><span class="kind">' + escapeHtml(sh.label) + '</span>' +
        '<span class="name">문단 ' + sh.paras.length + '개</span>' +
        '<button class="x" data-close="1" aria-label="선택 해제">✕</button></div>';
      if (!sh.paras.length) html += '<p class="insp-hint">이 상자에는 아직 글자가 없어요.</p>';
      html += '<div class="para-list">';
      sh.paras.forEach((p) => {
        html += '<label class="para-block"><span>문단 ' + (p.i + 1) + '</span>' +
          '<textarea data-p="' + p.i + '" rows="2" placeholder="글자를 입력하세요">' + escapeHtml(p.text) + '</textarea></label>';
      });
      html += '</div><p class="insp-hint" style="margin-top:12px">입력하면 슬라이드에 바로 반영됩니다. 글꼴·크기·색은 원본 그대로 유지돼요.<br>캔버스에서 <b>더블클릭</b>하면 그 자리에서 바로 고칠 수 있습니다.</p>';
      body.innerHTML = html;
      body.querySelectorAll('textarea').forEach((ta) => {
        const p = +ta.dataset.p;
        ta.addEventListener('input', () => {
          const txt = ta.value.replace(/\r?\n/g, ' ');
          const xmlEl = sh.el;
          setParagraphText(xmlEl, p, txt);
          markDirty(slide);
          if (sh.paras[p]) sh.paras[p].text = txt;
          if (slide.thumbCanvas) renderSlideInto(slide.thumbCanvas, slide, 128, false);
          renderSlideInto(E.slideCanvas, slide, S.canvasW, true);
          applySelection();
          const fresh = slide.uiShapes.filter((x) => x.el === xmlEl)[0];
          if (fresh && fresh.paras[p]) fresh.paras[p].text = txt;
        });
        ta.addEventListener('keydown', (e) => { e.stopPropagation(); });
      });
      body.querySelector('[data-close]').addEventListener('click', () => { S.sel = -1; applySelection(); renderInspector(); });
      return;
    }

    head.textContent = '텍스트 상자';
    if (!shapes.length) {
      body.innerHTML = '<p class="insp-hint">이 슬라이드에는 텍스트 상자가 없어요.<br>다른 슬라이드를 고르거나, 복제해서 글자를 넣어 보세요.</p>';
      return;
    }
    let html = '<p class="insp-sub">슬라이드 ' + (S.active + 1) + ' · 텍스트 상자 ' + shapes.length + '개</p><div class="tb-list">';
    shapes.forEach((s) => {
      const prev = s.paras.map((p) => p.text).join(' ').trim() || '(빈 상자)';
      html += '<button class="tb-item" data-s="' + s.idx + '"><span class="tb-name">' + escapeHtml(s.label) + '</span>' +
        '<span class="tb-prev">' + escapeHtml(prev.slice(0, 60)) + '</span></button>';
    });
    html += '</div><p class="insp-hint" style="margin-top:12px">상자를 고르면 문단별로 고칠 수 있어요. 캔버스에서 직접 <b>더블클릭</b>해도 됩니다.</p>';
    body.innerHTML = html;
    body.querySelectorAll('.tb-item').forEach((b) => b.addEventListener('click', () => selectShape(+b.dataset.s)));
  }

  function renderToolbar() {
    if (E.pPos) E.pPos.textContent = (S.active + 1) + ' / ' + S.slides.length;
    if (E.pUp) E.pUp.disabled = S.active <= 0;
    if (E.pDown) E.pDown.disabled = S.active >= S.slides.length - 1;
    if (E.pDel) E.pDel.disabled = S.slides.length <= 1;
  }

  function syncDirty() {
    document.body.classList.toggle('dirty', !!S.dirty);
    if (S.onChange) S.onChange({ dirty: S.dirty, name: S.fileName, slides: S.slides.length, fileSize: S.fileSize });
  }

  /* ── 슬라이드 조작 ─────────────────────────────────── */
  function syncSldIdOrder() {
    const lst = first(S.presDoc, NS.p, 'sldIdLst');
    if (!lst) return;
    S.slides.forEach((s) => lst.appendChild(s.sldIdEl));
  }

  function nextRelId() {
    let max = 0;
    if (!S.presRels) return 'rId1';
    findAll(S.presRels, NS.rel, 'Relationship').forEach((r) => {
      const m = (r.getAttribute('Id') || '').match(/^rId(\d+)$/);
      if (m) max = Math.max(max, +m[1]);
    });
    return 'rId' + (max + 1);
  }

  async function ensureCt() {
    if (S.ctDoc) return S.ctDoc;
    const f = S.zip.file('[Content_Types].xml');
    if (!f) return null;
    S.ctDoc = parseXml(await f.async('string'));
    return S.ctDoc;
  }

  function addOverride(partName, ct) {
    const doc = S.ctDoc;
    if (!doc) return;
    const pn = '/' + partName;
    const exists = findAll(doc, NS.ct, 'Override').some((o) => o.getAttribute('PartName') === pn);
    if (exists) return;
    const el = doc.createElementNS(NS.ct, 'Override');
    el.setAttribute('PartName', pn);
    el.setAttribute('ContentType', ct);
    doc.documentElement.appendChild(el);
  }
  function removeOverride(partName) {
    const doc = S.ctDoc;
    if (!doc) return;
    const pn = '/' + partName;
    findAll(doc, NS.ct, 'Override').forEach((o) => {
      if (o.getAttribute('PartName') === pn) o.parentNode.removeChild(o);
    });
  }
  function ensureDefault(ext, ct) {
    const doc = S.ctDoc;
    if (!doc) return;
    const exists = findAll(doc, NS.ct, 'Default').some((d) => (d.getAttribute('Extension') || '').toLowerCase() === ext.toLowerCase());
    if (exists) return;
    const el = doc.createElementNS(NS.ct, 'Default');
    el.setAttribute('Extension', ext);
    el.setAttribute('ContentType', ct);
    doc.documentElement.insertBefore(el, doc.documentElement.firstChild);
  }

  function cloneSlideXml(srcDoc) {
    return parseXml(serializeXml(srcDoc));
  }

  async function addSlide(blank) {
    commitInline();
    const src = S.slides[S.active];
    const num = S.nextSlideNum++;
    const part = 'ppt/slides/slide' + num + '.xml';
    const doc = cloneSlideXml(src.doc);
    if (blank) {
      const tree = first(doc, NS.p, 'spTree');
      if (tree) {
        kids(tree).forEach((k) => {
          if (k.namespaceURI === NS.p && ['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].indexOf(k.localName) >= 0) tree.removeChild(k);
        });
      }
    }
    S.zip.file(part, serializeXml(doc));
    let relsDoc = null;
    let rmap = {};
    if (src.relsDoc) {
      relsDoc = parseXml(serializeXml(src.relsDoc));
      findAll(relsDoc, NS.rel, 'Relationship').forEach((r) => {
        if (/\/notesSlide$/.test(r.getAttribute('Type') || '')) r.parentNode.removeChild(r);
      });
      S.zip.file(relsPathFor(part), serializeXml(relsDoc));
      rmap = relMap(relsDoc, 'ppt/slides');
    }
    const ct = await ensureCt();
    if (ct) addOverride(part, SLIDE_CT);
    const rid = nextRelId();
    const relEl = S.presRels.createElementNS(NS.rel, 'Relationship');
    relEl.setAttribute('Id', rid);
    relEl.setAttribute('Type', NS.r + '/slide');
    relEl.setAttribute('Target', 'slides/slide' + num + '.xml');
    S.presRels.documentElement.appendChild(relEl);

    let maxId = 255;
    S.slides.forEach((s) => { const v = +s.sldIdEl.getAttribute('id'); if (isFinite(v)) maxId = Math.max(maxId, v); });
    const sldIdEl = S.presDoc.createElementNS(NS.p, 'p:sldId');
    sldIdEl.setAttribute('id', String(maxId + 1));
    sldIdEl.setAttributeNS(NS.r, 'r:id', rid);
    const lst = first(S.presDoc, NS.p, 'sldIdLst');
    if (lst) lst.appendChild(sldIdEl);

    const slide = {
      part, doc, relsDoc, relsMap: rmap, sldIdEl, rid, dirty: true, layoutMap: null, uiShapes: []
    };
    S.slides.splice(S.active + 1, 0, slide);
    S.active = S.slides.indexOf(slide);
    S.sel = -1;
    S.dirty = true;
    syncSldIdOrder();
    await preloadMedia();
    renderAll();
    E.thumbs.scrollTop = E.thumbs.scrollHeight;
    return slide;
  }

  function moveSlide(dir) {
    const to = S.active + dir;
    if (to < 0 || to >= S.slides.length) return;
    commitInline();
    const [s] = S.slides.splice(S.active, 1);
    S.slides.splice(to, 0, s);
    S.active = to;
    S.dirty = true;
    syncSldIdOrder();
    renderAll();
    toast('슬라이드를 ' + (to + 1) + '번째로 옮겼어요');
  }

  async function deleteSlide() {
    commitInline();
    if (S.slides.length <= 1) { toast('슬라이드가 하나뿐이라 지울 수 없어요', 'err'); return; }
    const ok = await confirmBox('슬라이드 삭제', '슬라이드 ' + (S.active + 1) + '을(를) 삭제할까요? 저장 전에는 되돌릴 수 없습니다.');
    if (!ok) return;
    const idx = S.active;
    const s = S.slides[idx];
    // 연결 해제
    if (s.sldIdEl && s.sldIdEl.parentNode) s.sldIdEl.parentNode.removeChild(s.sldIdEl);
    findAll(S.presRels, NS.rel, 'Relationship').forEach((r) => {
      if (r.getAttribute('Id') === s.rid) r.parentNode.removeChild(r);
    });
    // 노트·원본 파트 정리
    Object.keys(s.relsMap).forEach((rid) => {
      const rel = s.relsMap[rid];
      if (/\/notesSlide$/.test(rel.type)) {
        S.zip.remove(rel.target);
        S.zip.remove(relsPathFor(rel.target));
        removeOverride(rel.target);
      }
    });
    S.zip.remove(s.part);
    S.zip.remove(relsPathFor(s.part));
    removeOverride(s.part);
    S.slides.splice(idx, 1);
    S.active = Math.min(idx, S.slides.length - 1);
    S.sel = -1;
    S.dirty = true;
    renderAll();
    toast('슬라이드를 삭제했어요', 'ok');
  }

  /* ── 이미지 압축 ───────────────────────────────────── */
  function loadBitmap(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).catch(() => loadImg(blob));
    }
    return loadImg(blob);
  }
  function loadImg(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없어요')); };
      img.src = url;
    });
  }
  function hasAlpha(img) {
    try {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) { return true; }
    return false;
  }
  function toBlob(canvas, mime, q) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, q));
  }

  async function mediaFiles() {
    const out = [];
    const paths = Object.keys(S.zip.files).filter((p) => /^ppt\/media\//i.test(p) && !S.zip.files[p].dir);
    for (const p of paths) {
      const ext = (p.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
      if (['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'].indexOf(ext) < 0) continue;
      const blob = await S.zip.file(p).async('blob');
      out.push({ path: p, ext, oldSize: blob.size, blob });
    }
    out.sort((a, b) => b.oldSize - a.oldSize);
    return out;
  }

  async function analyzeCompression(maxDim, quality, prevSel) {
    const files = await mediaFiles();
    const items = [];
    for (const f of files) {
      const item = {
        path: f.path, ext: f.ext, oldSize: f.oldSize, name: f.path.split('/').pop(),
        w: 0, h: 0, newW: 0, newH: 0, newSize: f.oldSize, mime: '', newBlob: null,
        selected: prevSel && f.path in prevSel ? prevSel[f.path] : true, note: ''
      };
      try {
        const img = await loadBitmap(f.blob);
        item.w = img.width; item.h = img.height;
        const maxSide = Math.max(img.width, img.height);
        const ratio = maxDim > 0 && maxSide > maxDim ? maxDim / maxSide : 1;
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        item.newW = w; item.newH = h;
        const alpha = f.ext === 'png' ? hasAlpha(img) : false;
        const mime = (f.ext === 'jpg' || f.ext === 'jpeg') ? 'image/jpeg' : (alpha ? 'image/png' : 'image/jpeg');
        item.mime = mime;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        if (img.close) img.close();
        const outBlob = await toBlob(canvas, mime, quality / 100);
        if (outBlob) {
          item.newBlob = outBlob;
          item.newSize = outBlob.size;
        }
      } catch (e) {
        item.note = '변환 불가';
        item.selected = false;
      }
      items.push(item);
    }
    return items;
  }

  function cmpTotals(items) {
    let before = 0, after = 0;
    items.forEach((it) => {
      before += it.oldSize;
      after += it.selected && it.newBlob && it.newSize < it.oldSize ? it.newSize : it.oldSize;
    });
    return { before, after, saved: before - after };
  }

  function renderCmpList() {
    const list = E.cmpList;
    if (!list) return;
    const items = S.cmp ? S.cmp.items : [];
    if (!items.length) {
      list.innerHTML = '<p class="insp-hint">압축할 사진이 없어요. (EMF·WMF 같은 벡터 이미지는 건너뜁니다)</p>';
      return;
    }
    let html = '<div class="cmp-row head"><span></span><span>파일</span><span class="sz">해상도</span><span class="sz">용량</span><span class="mv">절감</span></div>';
    items.forEach((it, i) => {
      const est = it.newBlob && it.newSize < it.oldSize ? it.newSize : it.oldSize;
      const ratio = it.oldSize ? Math.round((1 - est / it.oldSize) * 100) : 0;
      const cls = ratio > 0 ? 'good' : 'flat';
      const label = ratio > 0 ? '-' + ratio + '%' : '그대로';
      html += '<div class="cmp-row">' +
        '<input type="checkbox" data-i="' + i + '"' + (it.selected ? ' checked' : '') + (it.newBlob ? '' : ' disabled') + '>' +
        '<span class="nm">' + escapeHtml(it.name) + '<small>' + (it.ext === 'png' && it.mime === 'image/png' ? 'PNG' : (it.mime === 'image/jpeg' ? 'JPG' : it.ext.toUpperCase())) + '</small></span>' +
        '<span class="sz">' + it.w + '×' + it.h + ' → ' + it.newW + '×' + it.newH + '</span>' +
        '<span class="sz">' + fmtBytes(it.oldSize) + ' → ' + fmtBytes(est) + '</span>' +
        '<span class="mv ' + cls + '">' + label + '</span>' +
        '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const it = items[+cb.dataset.i];
        it.selected = cb.checked;
        updateCmpSummary();
      });
    });
  }

  function updateCmpSummary() {
    if (!S.cmp) return;
    const t = cmpTotals(S.cmp.items);
    const pct = t.before ? Math.round((t.saved / t.before) * 100) : 0;
    E.cmpTotal.textContent = fmtBytes(t.after) + ' (-' + fmtBytes(t.saved) + ', ' + pct + '%)';
    const applied = S.cmp.items.filter((i) => i.selected && i.newBlob && i.newSize < i.oldSize).length;
    E.cmpFootInfo.textContent = applied + '개 적용 예정 · 전체 ' + S.cmp.items.length + '개 중';
    E.cmpApply.disabled = applied === 0;
    E.cmpApply.textContent = applied ? '압축 적용 (' + applied + '개)' : '압축 적용';
  }

  async function openCmpModal() {
    if (!S.slides.length) return;
    E.cmpModal.hidden = false;
    E.cmpApply.disabled = true;
    E.cmpTotal.textContent = '계산 중…';
    E.cmpList.innerHTML = '<p class="insp-hint">이미지를 읽는 중…</p>';
    await runAnalyze();
  }

  async function runAnalyze() {
    const maxDim = +E.cmpMax.value || 0;
    const quality = +E.cmpQuality.value;
    E.cmpQLabel.textContent = quality + '%';
    E.cmpQuality.style.setProperty('--p', Math.round((quality - 50) / 40 * 100) + '%');
    const prevSel = {};
    if (S.cmp) S.cmp.items.forEach((it) => { prevSel[it.path] = it.selected; });
    const items = await analyzeCompression(maxDim, quality, prevSel);
    const before = items.reduce((a, b) => a + b.oldSize, 0);
    S.cmp = { maxDim, quality, items, before, base: S.fileSize };
    renderCmpList();
    updateCmpSummary();
  }

  async function updateRelsForMedia(renames) {
    const relFiles = Object.keys(S.zip.files).filter((p) => /(^|\/)_rels\/[^/]*\.rels$/i.test(p));
    for (const rp of relFiles) {
      const f = S.zip.file(rp);
      if (!f) continue;
      let doc;
      try { doc = parseXml(await f.async('string')); } catch (e) { continue; }
      let changed = false;
      findAll(doc, NS.rel, 'Relationship').forEach((r) => {
        const t = r.getAttribute('Target');
        if (!t) return;
        const name = t.split('/').pop();
        Object.keys(renames).forEach((oldPath) => {
          const oldName = oldPath.split('/').pop();
          const newName = renames[oldPath].split('/').pop();
          if (name === oldName) {
            r.setAttribute('Target', t.slice(0, t.length - oldName.length) + newName);
            changed = true;
          }
        });
      });
      if (changed) S.zip.file(rp, serializeXml(doc));
    }
    // 메모리에 올라온 렐이션션 정보도 함께 갱신
    S.slides.forEach((s) => {
      if (!s.relsDoc) return;
      let changed = false;
      findAll(s.relsDoc, NS.rel, 'Relationship').forEach((r) => {
        const t = r.getAttribute('Target');
        if (!t) return;
        const name = t.split('/').pop();
        Object.keys(renames).forEach((oldPath) => {
          const oldName = oldPath.split('/').pop();
          const newName = renames[oldPath].split('/').pop();
          if (name === oldName) {
            r.setAttribute('Target', t.slice(0, t.length - oldName.length) + newName);
            changed = true;
          }
        });
      });
      if (changed) {
        s.relsMap = relMap(s.relsDoc, dirOf(s.part));
        s.dirty = true;
        S.zip.file(relsPathFor(s.part), serializeXml(s.relsDoc));
      }
    });
  }

  async function applyCompression() {
    if (!S.cmp) return;
    const items = S.cmp.items.filter((it) => it.selected && it.newBlob && it.newSize < it.oldSize);
    if (!items.length) return;
    const btn = E.cmpApply;
    btn.disabled = true;
    btn.textContent = '적용 중…';
    const renames = {};
    let saved = 0;
    for (const it of items) {
      let target = it.path;
      if (it.mime === 'image/jpeg' && it.ext !== 'jpg' && it.ext !== 'jpeg') {
        target = it.path.replace(/\.[a-z0-9]+$/i, '.jpg');
        renames[it.path] = target;
      } else if (it.mime === 'image/png' && it.ext !== 'png') {
        target = it.path.replace(/\.[a-z0-9]+$/i, '.png');
        renames[it.path] = target;
      }
      S.zip.file(target, it.newBlob);
      if (target !== it.path) S.zip.remove(it.path);
      saved += it.oldSize - it.newSize;
    }
    if (Object.keys(renames).length) {
      const usesJpg = Object.keys(renames).some((k) => /\.jpe?g$/i.test(renames[k]));
      if (usesJpg) { await ensureCt(); ensureDefault('jpg', 'image/jpeg'); }
      await updateRelsForMedia(renames);
    }
    // 캐시 갱신
    clearMedia();
    await preloadMedia();
    S.fileSize = Math.max(0, S.fileSize - saved);
    S.dirty = true;
    S.cmp = null;
    E.cmpModal.hidden = true;
    renderAll();
    toast('이미지 ' + items.length + '개를 압축했어요 · ' + fmtBytes(saved) + ' 절감', 'ok');
    syncDirty();
  }

  /* ── 저장 ──────────────────────────────────────────── */
  function baseName(name) {
    return String(name || '프레젠테이션').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || '프레젠테이션';
  }

  async function save() {
    commitInline();
    syncSldIdOrder();
    S.zip.file('ppt/presentation.xml', serializeXml(S.presDoc));
    if (S.presRels) S.zip.file('ppt/_rels/presentation.xml.rels', serializeXml(S.presRels));
    if (S.ctDoc) S.zip.file('[Content_Types].xml', serializeXml(S.ctDoc));
    for (const s of S.slides) {
      S.zip.file(s.part, serializeXml(s.doc));
      if (s.relsDoc) S.zip.file(relsPathFor(s.part), serializeXml(s.relsDoc));
    }
    const blob = await S.zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    const name = baseName(S.fileName) + '.pptx';
    downloadBlob(blob, name);
    S.fileSize = blob.size;
    S.dirty = false;
    if (E.pSizeInfo) E.pSizeInfo.textContent = fmtBytes(S.fileSize);
    renderPreview();
    syncDirty();
    return { name, size: blob.size };
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 8000);
  }

  /* ── 바깥 도우미 ───────────────────────────────────── */
  function toast(msg, kind) { if (window.OE && window.OE.toast) window.OE.toast(msg, kind); }
  function confirmBox(t, m) { return window.OE && window.OE.confirm ? window.OE.confirm(t, m) : Promise.resolve(window.confirm(m)); }

  function init(refs) {
    if (S.inited) return;
    S.inited = true;
    Object.assign(E, refs);

    E.slideCanvas.addEventListener('click', onCanvasClick);
    E.pAdd.addEventListener('click', () => addSlide(true));
    E.pDup.addEventListener('click', () => addSlide(false));
    E.pDel.addEventListener('click', deleteSlide);
    E.pUp.addEventListener('click', () => moveSlide(-1));
    E.pDown.addEventListener('click', () => moveSlide(1));
    E.pCompress.addEventListener('click', openCmpModal);
    E.cmpClose.addEventListener('click', () => { E.cmpModal.hidden = true; });
    E.cmpCancel.addEventListener('click', () => { E.cmpModal.hidden = true; });
    E.cmpApply.addEventListener('click', applyCompression);
    E.cmpMax.addEventListener('change', () => { if (!E.cmpModal.hidden) { E.cmpTotal.textContent = '계산 중…'; runAnalyze(); } });
    E.cmpQuality.addEventListener('input', () => { E.cmpQLabel.textContent = E.cmpQuality.value + '%'; });
    E.cmpQuality.addEventListener('change', () => { if (!E.cmpModal.hidden) { E.cmpTotal.textContent = '계산 중…'; runAnalyze(); } });

    E.inlineEditor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitInline(); E.slideCanvas.focus && E.slideCanvas.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); S.inline = null; E.inlineEditor.hidden = true; }
    });
    E.inlineEditor.addEventListener('blur', () => commitInline());

    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (S.slides.length) renderCanvas(); }, 160);
    });
  }

  window.PPTX = {
    init,
    open: openFile,
    createBlank,
    save,
    hasChanges: () => S.dirty,
    getFileName: () => S.fileName,
    count: () => ({ slides: S.slides.length, active: S.active + 1 }),
    setViewActive: (v) => { if (v && S.slides.length) renderCanvas(); },
    onChange: (fn) => { S.onChange = fn; },
    info: () => ({ slides: S.slides.length, size: S.fileSize, fileName: S.fileName })
  };
})();
