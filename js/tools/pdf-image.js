/* ③ PDF ↔ 이미지 */
(function () {
  'use strict';
  const CT = window.CT;

  function parseRange(str, max) {
    const s = String(str || '').trim();
    if (!s || /^(all|전체|전부)$/i.test(s)) return Array.from({ length: max }, (_, i) => i + 1);
    const set = new Set();
    s.split(',').forEach((part) => {
      const p = part.trim();
      if (!p) return;
      let m = p.match(/^(\d+)\s*-\s*(\d*)$/);
      if (m) {
        const a = Math.max(1, +m[1]);
        const b = Math.min(max, m[2] ? +m[2] : max);
        for (let i = a; i <= b; i++) set.add(i);
      } else if (/^\d+$/.test(p)) {
        const n = +p;
        if (n >= 1 && n <= max) set.add(n);
      }
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  CT.register({
    id: 'pdf',
    short: 'PDF',
    name: 'PDF ↔ 이미지',
    desc: 'PDF를 페이지별 이미지로 풀거나, 사진 여러 장을 PDF 하나로 묶기 — 파일은 밖으로 나가지 않아요',
    icon: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h1.5a1.5 1.5 0 0 0 0-3H9v6"/><path d="M14 17v-6h1.5a2 2 0 0 1 0 4H14"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card"><div id="modeHost"></div></div>' +
        '<div id="panel"></div>';

      let mode = 'pdf2img';
      CT.$('#modeHost', root).appendChild(CT.ui.seg({
        items: [{ value: 'pdf2img', label: 'PDF → 이미지' }, { value: 'img2pdf', label: '이미지 → PDF' }],
        value: mode,
        onChange: (v) => { mode = v; build(); }
      }));

      const panel = CT.$('#panel', root);

      function build() {
        if (mode === 'pdf2img') buildPdf2Img(); else buildImg2Pdf();
      }

      /* ---------------- PDF → 이미지 ---------------- */
      function buildPdf2Img() {
        panel.innerHTML =
          '<div class="card"><div id="dropHost"></div><div id="pdfInfo"></div></div>' +
          '<div class="card is-hidden" id="optCard">' +
            '<div class="field"><div class="label"><span>페이지 범위</span><b>비우면 전체</b></div>' +
              '<input type="text" id="range" placeholder="예: 1-3, 5, 8-"></div>' +
            '<div id="fmtHost"></div>' +
            '<div id="scaleHost"></div>' +
            '<button class="btn primary block" id="go" style="margin-top:10px">이미지로 변환</button>' +
            '<p class="note" id="status"></p>' +
          '</div>' +
          '<div class="card is-hidden" id="resCard">' +
            '<div class="row between" style="margin-bottom:10px"><h3 style="margin:0" id="resTitle">변환 결과</h3>' +
            '<button class="btn small primary" id="zipAll">전체 ZIP</button></div>' +
            '<div class="thumbs" id="thumbs"></div>' +
          '</div>';

        let pdf = null, fileName = '', pages = [], fmt = 'jpg', scale = 2, busy = false;
        const th = CT.$('#thumbs', panel);

        CT.$('#fmtHost', panel).appendChild(CT.ui.seg({
          items: [{ value: 'jpg', label: 'JPG (가벼움)' }, { value: 'png', label: 'PNG (선명)' }],
          value: 'jpg',
          onChange: (v) => { fmt = v; }
        }));
        CT.$('#scaleHost', panel).appendChild(CT.ui.select({
          label: '해상도', value: '2',
          items: [
            { value: '1.5', label: '보통 (1.5×)' },
            { value: '2', label: '선명 (2×)' },
            { value: '3', label: '고해상 (3×)' }
          ],
          onChange: (v) => { scale = +v; }
        }));

        CT.$('#dropHost', panel).appendChild(CT.ui.drop({
          label: 'PDF 선택',
          hint: 'PDF 파일 하나 · 탭하거나 끌어다 놓기',
          accept: 'application/pdf,.pdf',
          multiple: false,
          onFiles: (files) => loadPdf(files[0])
        }));

        async function loadPdf(file) {
          if (!window.pdfjsLib) return CT.toast('PDF 엔진을 불러오지 못했어요');
          if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return CT.toast('PDF 파일을 선택해 주세요');
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.js', document.baseURI).href;
            const buf = await file.arrayBuffer();
            pdf = await window.pdfjsLib.getDocument({ data: buf, useSystemFonts: true }).promise;
            fileName = file.name;
            pages = []; th.innerHTML = '';
            CT.$('#resCard', panel).classList.add('is-hidden');
            CT.$('#optCard', panel).classList.remove('is-hidden');
            CT.$('#range', panel).value = '';
            CT.$('#pdfInfo', panel).innerHTML =
              '<div class="frow" style="margin-top:10px"><div class="fi pdf">PDF</div><div class="fm">' +
              '<b>' + CT.esc(file.name) + '</b><span>' + pdf.numPages + '쪽 · ' + CT.fmtBytes(file.size) + '</span></div></div>';
            CT.$('#resTitle', panel).textContent = '변환 결과 (' + pdf.numPages + '쪽)';
          } catch (e) {
            console.error(e);
            CT.toast('PDF를 열 수 없어요 (암호가 걸린 PDF는 지원하지 않아요)');
          }
        }

        CT.$('#go', panel).addEventListener('click', async () => {
          if (!pdf || busy) return;
          const list = parseRange(CT.$('#range', panel).value, pdf.numPages);
          if (!list.length) return CT.toast('페이지 범위를 확인해 주세요');
          busy = true;
          const btn = CT.$('#go', panel);
          btn.disabled = true;
          const status = CT.$('#status', panel);
          pages = []; th.innerHTML = '';
          CT.$('#resCard', panel).classList.remove('is-hidden');
          try {
            for (let i = 0; i < list.length; i++) {
              const n = list[i];
              status.textContent = '페이지 ' + n + ' 변환 중… (' + (i + 1) + '/' + list.length + ')';
              const page = await pdf.getPage(n);
              const vp = page.getViewport({ scale: scale });
              const c = CT.canvas(vp.width, vp.height);
              const cx = c.getContext('2d');
              if (fmt === 'jpg') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); }
              await page.render({ canvasContext: cx, viewport: vp }).promise;
              const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
              const blob = await new Promise((r) => c.toBlob(r, type, 0.92));
              const name = CT.baseName(fileName) + '_p' + String(n).padStart(2, '0') + '.' + fmt;
              pages.push({ name, blob, thumb: c.toDataURL('image/jpeg', 0.6), w: c.width, h: c.height, page: n });
              addThumb(pages[pages.length - 1]);
              page.cleanup();
            }
            status.textContent = list.length + '장 변환 완료 · ' + CT.fmtBytes(pages.reduce((a, p) => a + p.blob.size, 0));
            CT.toast('이미지 ' + list.length + '장 완성');
          } catch (e) {
            console.error(e);
            status.textContent = '변환 중 문제가 생겼어요: ' + (e.message || e);
          } finally {
            busy = false; btn.disabled = false;
          }
        });

        function addThumb(p) {
          const d = document.createElement('div');
          d.className = 'thumb';
          d.innerHTML = '<img alt="" src="' + p.thumb + '"><div class="tag">' + p.page + '쪽 · ' + CT.fmtBytes(p.blob.size) + '</div>';
          d.addEventListener('click', () => CT.download(p.blob, p.name));
          th.appendChild(d);
        }

        CT.$('#zipAll', panel).addEventListener('click', async () => {
          if (!pages.length) return CT.toast('먼저 변환해 주세요');
          CT.toast('ZIP 만드는 중…');
          const blob = await CT.zip(pages.map((p) => ({ name: p.name, blob: p.blob })));
          CT.download(blob, CT.baseName(fileName) + '_images.zip');
        });
      }

      /* ---------------- 이미지 → PDF ---------------- */
      function buildImg2Pdf() {
        panel.innerHTML =
          '<div class="card"><div id="dropHost"></div><div class="list" id="list" style="margin-top:10px"></div><p class="note" id="sum"></p></div>' +
          '<div class="card">' +
            '<div id="sizeHost"></div>' +
            '<div class="row" style="margin-top:12px"><button class="btn primary block" id="go">PDF로 묶기</button></div>' +
            '<p class="note" id="status"></p>' +
          '</div>';

        let files = [];
        let pageMode = 'fit';
        let busy = false;

        CT.$('#sizeHost', panel).appendChild(CT.ui.seg({
          items: [{ value: 'fit', label: '이미지 크기에 맞춤' }, { value: 'a4', label: 'A4 한 장씩' }],
          value: 'fit',
          onChange: (v) => { pageMode = v; }
        }));

        const list = CT.$('#list', panel);
        const sum = CT.$('#sum', panel);

        CT.$('#dropHost', panel).appendChild(CT.ui.drop({
          label: '이미지 선택',
          hint: '여러 장 한 번에 · 순서대로 한 장씩 페이지가 됩니다',
          accept: 'image/*',
          multiple: true,
          onFiles: (picked) => { files = files.concat(picked); renderList(); }
        }));

        function renderList() {
          list.innerHTML = '';
          files.forEach((f, i) => {
            const url = URL.createObjectURL(f);
            const row = document.createElement('div');
            row.className = 'frow';
            row.innerHTML = '<img class="fi" alt="" src="' + url + '"><div class="fm"><b>' + CT.esc(f.name) + '</b>' +
              '<span>' + (i + 1) + '쪽 · ' + CT.fmtBytes(f.size) + '</span></div>' +
              '<button class="x" data-up title="위로">↑</button><button class="x" data-del title="빼기">✕</button>';
            row.querySelector('[data-del]').addEventListener('click', () => { files.splice(i, 1); renderList(); });
            row.querySelector('[data-up]').addEventListener('click', () => {
              if (i === 0) return;
              const t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; renderList();
            });
            list.appendChild(row);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          });
          sum.textContent = files.length ? files.length + '장 · ' + CT.fmtBytes(files.reduce((a, f) => a + f.size, 0)) : '';
        }

        CT.$('#go', panel).addEventListener('click', async () => {
          if (!files.length || busy) return CT.toast('이미지를 먼저 넣어 주세요');
          if (!window.jspdf) return CT.toast('PDF 라이브러리를 불러오지 못했어요');
          busy = true;
          const btn = CT.$('#go', panel);
          btn.disabled = true;
          const status = CT.$('#status', panel);
          try {
            const { jsPDF } = window.jspdf;
            let doc = null;
            for (let i = 0; i < files.length; i++) {
              status.textContent = 'PDF 만드는 중… (' + (i + 1) + '/' + files.length + ')';
              const img = await CT.loadImage(files[i]);
              const maxDim = 2200;
              const k = Math.min(1, maxDim / Math.max(img.w, img.h));
              const cw = Math.max(1, Math.round(img.w * k));
              const ch = Math.max(1, Math.round(img.h * k));
              const c = CT.canvas(cw, ch);
              const cx = c.getContext('2d');
              cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch);
              cx.drawImage(img.src, 0, 0, cw, ch);
              const jpeg = c.toDataURL('image/jpeg', 0.9);
              if (img.close) img.close();

              if (pageMode === 'a4') {
                if (!doc) doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'p' });
                else doc.addPage('a4', 'p');
                const pw = doc.internal.pageSize.getWidth();
                const ph = doc.internal.pageSize.getHeight();
                const m = 18;
                const s = Math.min((pw - m * 2) / cw, (ph - m * 2) / ch);
                const w = cw * s, h = ch * s;
                doc.addImage(jpeg, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST');
              } else {
                const wPt = cw * 0.75, hPt = ch * 0.75;
                const orient = wPt > hPt ? 'landscape' : 'portrait';
                if (!doc) {
                  doc = new jsPDF({ unit: 'pt', format: [Math.min(wPt, hPt), Math.max(wPt, hPt)], orientation: orient });
                } else {
                  doc.addPage([Math.min(wPt, hPt), Math.max(wPt, hPt)], orient);
                }
                const pw = doc.internal.pageSize.getWidth();
                const ph = doc.internal.pageSize.getHeight();
                doc.addImage(jpeg, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
              }
              await CT.yieldFrame();
            }
            const blob = doc.output('blob');
            CT.download(blob, 'creator-toolkit-' + files.length + 'pages.pdf');
            status.textContent = files.length + '쪽 PDF 완성 · ' + CT.fmtBytes(blob.size);
            CT.toast('PDF 저장 완료');
          } catch (e) {
            console.error(e);
            status.textContent = 'PDF를 만들지 못했어요: ' + (e.message || e);
          } finally {
            busy = false; btn.disabled = false;
          }
        });
      }

      build();
    }
  });
})();
