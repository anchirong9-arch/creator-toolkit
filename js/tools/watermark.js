/* ⑦ 일괄 워터마크 */
(function () {
  'use strict';
  const CT = window.CT;

  const POS = [
    ['tl', 't', 'tr'],
    ['l', 'c', 'r'],
    ['bl', 'b', 'br']
  ];

  CT.register({
    id: 'mark',
    short: '워터마크',
    name: '일괄 워터마크',
    desc: '여러 장에 내 아이디나 로고를 한 번에 — 위치·투명도·크기를 미리 보고 저장',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 3l2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.7 6.9 18.5l1.2-5.6L4 9l5.6-.6z"/><circle cx="12" cy="12" r="9.2" opacity=".3"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card">' +
          '<div id="dropHost"></div>' +
          '<div class="list" id="list" style="margin-top:10px"></div>' +
          '<p class="note" id="sum"></p>' +
        '</div>' +
        '<div class="card">' +
          '<div class="field"><div class="label"><span>워터마크 문구</span><b id="cnt"></b></div>' +
            '<input type="text" id="text" placeholder="@내아이디" autocomplete="off">' +
            '<div class="chips" style="margin-top:8px"><button class="chip" data-p="@uhaeham">@uhaeham</button><button class="chip" data-p="@animallolvillage">@animallolvillage</button></div>' +
          '</div>' +
          '<div id="logoHost"></div>' +
          '<div class="field"><div class="label"><span>위치</span></div><div class="grid9" id="posGrid"></div></div>' +
          '<div id="sizeHost"></div>' +
          '<div id="opacityHost"></div>' +
          '<div id="colorHost" style="margin-bottom:10px"></div>' +
          '<div class="canvas-wrap" id="prevWrap"><canvas id="prev"></canvas></div>' +
          '<button class="btn primary block" id="go">일괄 적용</button>' +
          '<p class="note" id="status"></p>' +
        '</div>' +
        '<div class="card is-hidden" id="resCard">' +
          '<div class="row between" style="margin-bottom:10px"><h3 style="margin:0" id="resTitle">결과</h3><button class="btn small primary" id="zipAll">전체 ZIP</button></div>' +
          '<div class="list" id="res"></div>' +
        '</div>';

      // 3x3 position picker styles (inline, no extra css file needed)
      const style = document.createElement('style');
      style.textContent =
        '.grid9{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:190px}' +
        '.grid9 button{aspect-ratio:1/1;border-radius:10px;border:1px solid var(--line);background:var(--surface2);cursor:pointer;display:grid;place-items:center}' +
        '.grid9 button i{display:block;width:56%;height:22%;border-radius:3px;background:#5c6a82}' +
        '.grid9 button.on{border-color:rgba(124,139,255,.7);background:rgba(124,139,255,.16)}' +
        '.grid9 button.on i{background:#aab7ff}';
      root.appendChild(style);

      let files = [], logo = null, results = [], busy = false;
      let text = '', pos = 'br', size = 4, opacity = 80, color = 'white', shadow = true;
      let firstImg = null;

      const list = CT.$('#list', root);
      const res = CT.$('#res', root);
      const resCard = CT.$('#resCard', root);
      const prevWrap = CT.$('#prevWrap', root);
      const prev = CT.$('#prev', root);

      CT.$('#dropHost', root).appendChild(CT.ui.drop({
        label: '사진 선택',
        hint: '여러 장 한 번에 · 같은 워터마크가 들어갑니다',
        accept: 'image/*',
        multiple: true,
        onFiles: async (picked) => {
          files = files.concat(picked);
          renderList();
          if (!firstImg && files.length) {
            try { firstImg = await CT.loadImage(files[0]); drawPreview(); } catch (e) {}
          }
        }
      }));

      CT.$('#logoHost', root).appendChild(CT.ui.drop({
        label: '로고 이미지 (선택)',
        hint: 'PNG 투명 로고 권장 · 없으면 문구만 들어갑니다',
        accept: 'image/*',
        multiple: false,
        onFiles: async (picked) => {
          try {
            if (logo && logo.close) logo.close();
            logo = await CT.loadImage(picked[0]);
            CT.toast('로고를 넣었어요');
            drawPreview();
          } catch (e) { CT.toast('로고를 열 수 없어요'); }
        }
      }));

      const posGrid = CT.$('#posGrid', root);
      posGrid.innerHTML = POS.flat().map((p) => '<button type="button" data-p="' + p + '"><i></i></button>').join('');
      posGrid.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-p]');
        if (!b) return;
        pos = b.dataset.p;
        Array.from(posGrid.children).forEach((x) => x.classList.toggle('on', x.dataset.p === pos));
        drawPreview();
      });
      Array.from(posGrid.children).forEach((x) => x.classList.toggle('on', x.dataset.p === pos));

      CT.$('#sizeHost', root).appendChild(CT.ui.range({
        label: '크기', min: 2, max: 16, step: 1, value: size,
        format: (v) => v + '%',
        onInput: (v) => { size = v; drawPreview(); }
      }));
      CT.$('#opacityHost', root).appendChild(CT.ui.range({
        label: '투명도', min: 10, max: 100, step: 5, value: opacity,
        format: (v) => v + '%',
        onInput: (v) => { opacity = v; drawPreview(); }
      }));
      CT.$('#colorHost', root).appendChild(CT.ui.seg({
        items: [{ value: 'white', label: '흰 글자' }, { value: 'black', label: '검정 글자' }],
        value: 'white',
        onChange: (v) => { color = v; drawPreview(); }
      }));

      const input = CT.$('#text', root);
      input.addEventListener('input', CT.debounce(() => {
        text = input.value.trim();
        CT.$('#cnt', root).textContent = text.length ? text.length + '자' : '';
        drawPreview();
      }, 150));
      root.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
        input.value = c.dataset.p;
        text = c.dataset.p;
        CT.$('#cnt', root).textContent = text.length + '자';
        drawPreview();
      }));

      function renderList() {
        list.innerHTML = '';
        files.forEach((f, i) => {
          const url = URL.createObjectURL(f);
          const row = document.createElement('div');
          row.className = 'frow';
          row.innerHTML = '<img class="fi" alt="" src="' + url + '"><div class="fm"><b>' + CT.esc(f.name) + '</b>' +
            '<span>' + CT.fmtBytes(f.size) + '</span></div><button class="x" title="빼기">✕</button>';
          row.querySelector('.x').addEventListener('click', () => { files.splice(i, 1); renderList(); });
          list.appendChild(row);
          setTimeout(() => URL.revokeObjectURL(url), 8000);
        });
        CT.$('#sum', root).textContent = files.length ? files.length + '장 · ' + CT.fmtBytes(files.reduce((a, f) => a + f.size, 0)) : '';
      }

      function paint(img, canvas, W, H) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img.src, 0, 0, W, H);
        if (!text && !logo) return;
        const m = W * 0.035;
        const vAlign = pos[0] === 't' ? 'top' : pos[0] === 'b' ? 'bottom' : 'middle';
        const hAlign = pos === 'l' || pos.endsWith('l') ? 'left' : pos === 'r' || pos.endsWith('r') ? 'right' : 'center';

        ctx.save();
        ctx.globalAlpha = opacity / 100;

        if (logo) {
          const lw = Math.min(W * 0.28, W * (size / 100) * 5);
          const lh = lw * (logo.h / logo.w);
          const x = hAlign === 'left' ? m : hAlign === 'right' ? W - m - lw : (W - lw) / 2;
          const y = vAlign === 'top' ? m : vAlign === 'bottom' ? H - m - lh : (H - lh) / 2;
          if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = lw * 0.06; }
          ctx.drawImage(logo.src, x, y, lw, lh);
          ctx.shadowColor = 'transparent';
        }

        if (text) {
          const fs = Math.max(10, W * (size / 100));
          ctx.font = '700 ' + fs + 'px -apple-system, "Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif';
          ctx.fillStyle = color === 'black' ? '#111' : '#fff';
          ctx.textBaseline = 'middle';
          ctx.textAlign = hAlign === 'left' ? 'left' : hAlign === 'right' ? 'right' : 'center';
          if (shadow) {
            ctx.shadowColor = color === 'black' ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)';
            ctx.shadowBlur = fs * 0.28;
            ctx.shadowOffsetY = fs * 0.04;
          }
          const x = hAlign === 'left' ? m : hAlign === 'right' ? W - m : W / 2;
          const y = vAlign === 'top' ? m + fs / 2 : vAlign === 'bottom' ? H - m - fs / 2 : H / 2;
          ctx.fillText(text, x, y);
        }
        ctx.restore();
      }

      function drawPreview() {
        if (!firstImg) { prevWrap.classList.add('is-hidden'); return; }
        const maxW = Math.min(prevWrap.parentElement.clientWidth - 28, 320);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let w = maxW, h = w * (optsRatio());
        if (h > 420) { h = 420; w = h / optsRatio(); }
        prev.width = Math.round(w * dpr);
        prev.height = Math.round(h * dpr);
        prev.style.width = w + 'px';
        prev.style.height = h + 'px';
        paint(firstImg, prev, prev.width, prev.height);
        prevWrap.classList.remove('is-hidden');
      }
      function optsRatio() { return firstImg ? firstImg.h / firstImg.w : 1; }

      CT.$('#go', root).addEventListener('click', async () => {
        if (!files.length) return CT.toast('사진을 먼저 넣어 주세요');
        if (!text && !logo) return CT.toast('문구나 로고를 넣어 주세요');
        if (busy) return;
        busy = true;
        const btn = CT.$('#go', root);
        btn.disabled = true;
        const status = CT.$('#status', root);
        results = []; res.innerHTML = '';
        resCard.classList.remove('is-hidden');
        for (let i = 0; i < files.length; i++) {
          status.textContent = '적용 중… (' + (i + 1) + '/' + files.length + ')';
          try {
            const img = await CT.loadImage(files[i]);
            const c = CT.canvas(img.w, img.h);
            paint(img, c, img.w, img.h);
            if (img.close) img.close();
            const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
            const name = CT.baseName(files[i].name) + '_wm.jpg';
            results.push({ name, blob });
            const d = document.createElement('div');
            d.className = 'res';
            d.innerHTML = '<img alt="" src="' + c.toDataURL('image/jpeg', 0.4) + '"><div class="rm"><b>' + CT.esc(name) + '</b>' +
              '<span>' + img.w + '×' + img.h + ' · ' + CT.fmtBytes(blob.size) + '</span></div><button class="btn small">저장</button>';
            d.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); CT.download(blob, name); });
            d.addEventListener('click', () => CT.download(blob, name));
            res.appendChild(d);
          } catch (e) {
            console.error(e);
            const bad = document.createElement('div');
            bad.className = 'res';
            bad.innerHTML = '<div class="rm"><b>' + CT.esc(files[i].name) + '</b><span style="color:var(--bad)">열 수 없는 파일이에요</span></div>';
            res.appendChild(bad);
          }
          await CT.yieldFrame();
        }
        status.textContent = results.length + '장 완료';
        CT.$('#resTitle', root).textContent = '결과 (' + results.length + '장)';
        CT.toast('워터마크 ' + results.length + '장 완료');
        busy = false; btn.disabled = false;
      });

      CT.$('#zipAll', root).addEventListener('click', async () => {
        if (!results.length) return CT.toast('먼저 적용해 주세요');
        CT.toast('ZIP 만드는 중…');
        const blob = await CT.zip(results);
        CT.download(blob, 'creator-toolkit_워터마크_' + results.length + '장.zip');
      });

      window.addEventListener('resize', CT.debounce(drawPreview, 200));
    }
  });
})();
