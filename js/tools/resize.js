/* ⑥ 비율 리사이즈 */
(function () {
  'use strict';
  const CT = window.CT;

  CT.register({
    id: 'resize',
    short: '비율',
    name: '비율 리사이즈',
    desc: '1:1 · 4:5 · 9:16 · 16:9 비율로 잘리지 않게 맞추고, 남는 여백은 흰색·검정·블러로 채우기',
    icon: '<svg viewBox="0 0 24 24"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5" opacity=".5"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card">' +
          '<div id="dropHost"></div>' +
          '<div class="list" id="list" style="margin-top:10px"></div>' +
          '<p class="note" id="sum"></p>' +
        '</div>' +
        '<div class="card">' +
          '<div id="ratioHost" style="margin-bottom:12px"></div>' +
          '<div id="fillHost" style="margin-bottom:12px"></div>' +
          '<div id="sizeHost"></div>' +
          '<div class="canvas-wrap is-hidden" id="prevWrap"><canvas id="prev"></canvas></div>' +
          '<button class="btn primary block" id="go" style="margin-top:10px">비율 맞춰 저장</button>' +
          '<p class="note" id="status"></p>' +
        '</div>' +
        '<div class="card is-hidden" id="resCard">' +
          '<div class="row between" style="margin-bottom:10px"><h3 style="margin:0" id="resTitle">결과</h3><button class="btn small primary" id="zipAll">전체 ZIP</button></div>' +
          '<div class="list" id="res"></div>' +
        '</div>';

      let files = [], results = [], busy = false;
      let ratio = 1, fill = 'white', outW = 1080;
      let firstImg = null;

      const list = CT.$('#list', root);
      const res = CT.$('#res', root);
      const resCard = CT.$('#resCard', root);
      const prevWrap = CT.$('#prevWrap', root);
      const prev = CT.$('#prev', root);

      CT.$('#ratioHost', root).appendChild(CT.ui.seg({
        items: [
          { value: '1', label: '1:1' },
          { value: '0.8', label: '4:5' },
          { value: '0.5625', label: '9:16' },
          { value: '1.7778', label: '16:9' }
        ],
        value: '1',
        onChange: (v) => { ratio = +v; drawPreview(); }
      }));

      CT.$('#fillHost', root).appendChild(CT.ui.seg({
        items: [{ value: 'white', label: '흰 여백' }, { value: 'black', label: '검정 여백' }, { value: 'blur', label: '블러 배경' }],
        value: 'white',
        onChange: (v) => { fill = v; drawPreview(); }
      }));

      CT.$('#sizeHost', root).appendChild(CT.ui.select({
        label: '저장 가로 크기', value: '1080',
        items: [
          { value: '1080', label: '1080px (스레드·인스타 권장)' },
          { value: '1440', label: '1440px' },
          { value: '2048', label: '2048px' },
          { value: '0', label: '원본 크기 유지' }
        ],
        onChange: (v) => { outW = +v; }
      }));

      CT.$('#dropHost', root).appendChild(CT.ui.drop({
        label: '사진 선택',
        hint: '여러 장 한 번에 · 순서대로 처리',
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

      function targetSize(img) {
        const w = outW || Math.round(Math.max(img.w, img.h * ratio));
        return { w: Math.round(w), h: Math.round(w / ratio) };
      }

      function paint(img, canvas, w, h) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = fill === 'black' ? '#000' : '#fff';
        ctx.fillRect(0, 0, w, h);
        const s = Math.min(w / img.w, h / img.h);
        const dw = img.w * s, dh = img.h * s;
        const dx = (w - dw) / 2, dy = (h - dh) / 2;
        if (fill === 'blur') {
          const cover = Math.max(w / img.w, h / img.h);
          const cw = img.w * cover, ch = img.h * cover;
          if ('filter' in ctx) {
            ctx.save();
            ctx.filter = 'blur(' + Math.max(8, w * 0.03) + 'px)';
            ctx.drawImage(img.src, (w - cw) / 2, (h - ch) / 2, cw, ch);
            ctx.restore();
          } else {
            ctx.drawImage(img.src, (w - cw) / 2, (h - ch) / 2, cw, ch);
          }
          ctx.fillStyle = 'rgba(0,0,0,.06)';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img.src, dx, dy, dw, dh);
      }

      function drawPreview() {
        if (!firstImg) { prevWrap.classList.add('is-hidden'); return; }
        const maxW = Math.min(prevWrap.parentElement.clientWidth - 28, 320);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const tw = targetSize(firstImg);
        let w = maxW, h = w / ratio;
        if (h > 420) { h = 420; w = h * ratio; }
        prev.width = Math.round(w * dpr);
        prev.height = Math.round(h * dpr);
        prev.style.width = w + 'px';
        prev.style.height = h + 'px';
        paint(firstImg, prev, prev.width, prev.height);
        prevWrap.classList.remove('is-hidden');
      }

      CT.$('#go', root).addEventListener('click', async () => {
        if (!files.length || busy) return CT.toast('사진을 먼저 넣어 주세요');
        busy = true;
        const btn = CT.$('#go', root);
        btn.disabled = true;
        const status = CT.$('#status', root);
        results = []; res.innerHTML = '';
        resCard.classList.remove('is-hidden');
        for (let i = 0; i < files.length; i++) {
          status.textContent = '처리 중… (' + (i + 1) + '/' + files.length + ')';
          try {
            const img = await CT.loadImage(files[i]);
            const t = targetSize(img);
            const c = CT.canvas(t.w, t.h);
            paint(img, c, t.w, t.h);
            if (img.close) img.close();
            const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
            const name = CT.baseName(files[i].name) + '_' + t.w + 'x' + t.h + '.jpg';
            const item = { name, blob, w: t.w, h: t.h, thumb: c.toDataURL('image/jpeg', 0.5), before: files[i].size };
            results.push(item);
            const d = document.createElement('div');
            d.className = 'res';
            d.innerHTML = '<img alt="" src="' + item.thumb + '"><div class="rm"><b>' + CT.esc(name) + '</b>' +
              '<span>' + t.w + '×' + t.h + ' · ' + CT.fmtBytes(blob.size) + '</span></div><button class="btn small">저장</button>';
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
        CT.toast('비율 맞춰 ' + results.length + '장 저장 준비');
        busy = false; btn.disabled = false;
      });

      CT.$('#zipAll', root).addEventListener('click', async () => {
        if (!results.length) return CT.toast('먼저 변환해 주세요');
        CT.toast('ZIP 만드는 중…');
        const blob = await CT.zip(results.map((r) => ({ name: r.name, blob: r.blob })));
        CT.download(blob, 'creator-toolkit_비율변환_' + results.length + '장.zip');
      });

      window.addEventListener('resize', CT.debounce(drawPreview, 200));
    }
  });
})();
