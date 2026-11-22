/* ④ 이미지 압축 · 포맷 변환 */
(function () {
  'use strict';
  const CT = window.CT;

  CT.register({
    id: 'compress',
    short: '압축',
    name: '이미지 압축 · 포맷 변환',
    desc: '여러 장을 한 번에 용량 줄이고 PNG·JPG·WebP로 바꾸기, 전후 용량까지 비교',
    icon: '<svg viewBox="0 0 24 24"><path d="M9 3v6H3"/><path d="M3 9l6-6"/><path d="M15 21v-6h6"/><path d="M21 15l-6 6"/><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" opacity=".45"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card">' +
          '<div id="dropHost"></div>' +
          '<div class="list" id="list" style="margin-top:10px"></div>' +
          '<p class="note" id="sum"></p>' +
        '</div>' +
        '<div class="card">' +
          '<div id="fmtHost" style="margin-bottom:12px"></div>' +
          '<div id="qHost"></div>' +
          '<div id="maxHost"></div>' +
          '<button class="btn primary block" id="go" style="margin-top:10px">압축 시작</button>' +
          '<p class="note" id="status"></p>' +
        '</div>' +
        '<div class="card is-hidden" id="resCard">' +
          '<div class="row between" style="margin-bottom:10px"><h3 style="margin:0">결과</h3><button class="btn small primary" id="zipAll">전체 ZIP</button></div>' +
          '<div class="stat" id="stat" style="margin-bottom:10px"></div>' +
          '<div class="list" id="res"></div>' +
          '<p class="note">사진을 눌러 한 장씩 저장하거나, 전체 ZIP으로 받으세요.</p>' +
        '</div>';

      let files = [], results = [], busy = false;
      let fmt = 'orig', quality = 0.8, maxW = 0;

      const list = CT.$('#list', root);
      const sum = CT.$('#sum', root);
      const res = CT.$('#res', root);
      const resCard = CT.$('#resCard', root);

      CT.$('#fmtHost', root).appendChild(CT.ui.seg({
        items: [
          { value: 'orig', label: '원본 유지' },
          { value: 'image/jpeg', label: 'JPG' },
          { value: 'image/png', label: 'PNG' },
          { value: 'image/webp', label: 'WebP' }
        ],
        value: 'orig',
        onChange: (v) => { fmt = v; }
      }));

      const qRange = CT.ui.range({
        label: '화질', min: 40, max: 95, step: 5, value: 80,
        format: (v) => v + '%',
        onInput: (v) => { quality = v / 100; }
      });
      CT.$('#qHost', root).appendChild(qRange);

      CT.$('#maxHost', root).appendChild(CT.ui.select({
        label: '최대 가로 크기', value: '0',
        items: [
          { value: '0', label: '원본 그대로' },
          { value: '2048', label: '2048px' },
          { value: '1440', label: '1440px' },
          { value: '1080', label: '1080px' },
          { value: '720', label: '720px' }
        ],
        onChange: (v) => { maxW = +v; }
      }));

      CT.$('#dropHost', root).appendChild(CT.ui.drop({
        label: '사진 선택',
        hint: '여러 장 한 번에 · JPG · PNG · WebP',
        accept: 'image/*',
        multiple: true,
        onFiles: (picked) => {
          files = files.concat(picked.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)));
          renderList();
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
        sum.textContent = files.length ? files.length + '장 · 합계 ' + CT.fmtBytes(files.reduce((a, f) => a + f.size, 0)) : '';
      }

      function extFor(type, name) {
        if (type === 'image/png') return 'png';
        if (type === 'image/webp') return 'webp';
        return 'jpg';
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
          const f = files[i];
          status.textContent = '변환 중… (' + (i + 1) + '/' + files.length + ')';
          try {
            const img = await CT.loadImage(f);
            let targetType = fmt === 'orig' ? (f.type === 'image/png' ? 'image/png' : 'image/jpeg') : fmt;
            if (targetType === 'image/heic') targetType = 'image/jpeg';
            const k = maxW ? Math.min(1, maxW / Math.max(img.w, img.h)) : 1;
            const c = CT.canvas(img.w * k, img.h * k);
            const cx = c.getContext('2d');
            if (targetType !== 'image/png') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); }
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(img.src, 0, 0, c.width, c.height);
            if (img.close) img.close();

            let blob = await new Promise((r) => c.toBlob(r, targetType, quality));
            if (!blob) { targetType = 'image/jpeg'; blob = await new Promise((r) => c.toBlob(r, targetType, quality)); }
            const name = CT.baseName(f.name) + '_c.' + extFor(targetType, f.name);
            const item = { name, blob, before: f.size, after: blob.size, thumb: c.toDataURL('image/jpeg', 0.5), w: c.width, h: c.height };
            results.push(item);
            addResult(item);
          } catch (e) {
            console.error(e);
            const bad = document.createElement('div');
            bad.className = 'res';
            bad.innerHTML = '<div class="rm"><b>' + CT.esc(f.name) + '</b><span style="color:var(--bad)">이 사진은 열 수 없어요 (HEIC는 JPG로 저장 후 사용)</span></div>';
            res.appendChild(bad);
          }
          await CT.yieldFrame();
        }

        const before = results.reduce((a, r) => a + r.before, 0);
        const after = results.reduce((a, r) => a + r.after, 0);
        const save = before ? Math.round((1 - after / before) * 100) : 0;
        CT.$('#stat', root).innerHTML =
          '<div><span>원본</span><b>' + CT.fmtBytes(before) + '</b></div>' +
          '<div><span>결과</span><b>' + CT.fmtBytes(after) + '</b></div>' +
          '<div><span>절감</span><b class="' + (save > 0 ? 'good' : '') + '">' + (save > 0 ? '-' + save + '%' : '±0%') + '</b></div>';
        status.textContent = results.length + '장 완료';
        CT.toast(results.length + '장 압축 완료 · ' + (save > 0 ? save + '% 절감' : '용량 변화 없음'));
        busy = false; btn.disabled = false;
      });

      function addResult(r) {
        const save = r.before ? Math.round((1 - r.after / r.before) * 100) : 0;
        const d = document.createElement('div');
        d.className = 'res';
        d.innerHTML = '<img alt="" src="' + r.thumb + '"><div class="rm"><b>' + CT.esc(r.name) + '</b>' +
          '<span>' + r.w + '×' + r.h + ' · ' + CT.fmtBytes(r.before) + ' → ' + CT.fmtBytes(r.after) +
          ' <em class="' + (save <= 0 ? 'up' : '') + '">' + (save > 0 ? '-' : '') + save + '%</em></span></div>' +
          '<button class="btn small">저장</button>';
        d.querySelector('button').addEventListener('click', (e) => {
          e.stopPropagation();
          CT.download(r.blob, r.name);
        });
        d.addEventListener('click', () => CT.download(r.blob, r.name));
        res.appendChild(d);
      }

      CT.$('#zipAll', root).addEventListener('click', async () => {
        if (!results.length) return CT.toast('먼저 압축해 주세요');
        CT.toast('ZIP 만드는 중…');
        const blob = await CT.zip(results.map((r) => ({ name: r.name, blob: r.blob })));
        CT.download(blob, 'creator-toolkit_압축결과_' + results.length + '장.zip');
      });
    }
  });
})();
