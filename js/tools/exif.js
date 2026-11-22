/* ① EXIF 제거 · 모자이크 */
(function () {
  'use strict';
  const CT = window.CT;

  CT.register({
    id: 'exif',
    short: 'EXIF',
    name: 'EXIF 제거 · 모자이크',
    desc: '사진의 촬영 위치·기기 정보를 지우고, 가릴 곳을 손가락으로 문질러 모자이크',
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l4.5-5 3.5 3.5L15 12l5 5"/><path d="M3 3l18 18" opacity=".45"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card">' +
          '<div id="dropHost"></div>' +
          '<p class="note"><b>이렇게 지워져요</b> — 사진을 캔버스에 다시 그려 저장하기 때문에 GPS 위치, 기기 모델, 촬영 시각, 편집 앱 흔적이 모두 사라집니다. 원본은 그대로 두고 새 파일로 저장해요.</p>' +
        '</div>' +
        '<div class="card is-hidden" id="editor">' +
          '<div class="canvas-wrap"><canvas id="cv"></canvas><div class="canvas-hint" id="hint">손가락으로 문질러 가릴 부분을 칠하세요</div></div>' +
          '<div class="row" style="margin-bottom:10px">' +
            '<div class="seg" id="modeSeg" style="flex:1"></div>' +
          '</div>' +
          '<div id="brushHost"></div>' +
          '<div class="row between" style="margin-top:2px">' +
            '<button class="btn small" id="undoBtn">↶ 되돌리기</button>' +
            '<button class="btn small" id="clearBtn">전체 지우기</button>' +
            '<button class="btn small" id="newBtn">다른 사진</button>' +
          '</div>' +
          '<div class="row" style="margin-top:14px" id="fmtHost"></div>' +
          '<button class="btn primary block" id="saveBtn" style="margin-top:10px">EXIF 지우고 저장</button>' +
          '<p class="note" id="fileInfo"></p>' +
        '</div>';

      const dropHost = CT.$('#dropHost', root);
      const editor = CT.$('#editor', root);
      const cv = CT.$('#cv', root);
      const ctx = cv.getContext('2d');
      const hint = CT.$('#hint', root);

      let file = null, img = null;
      let strokes = [], current = null, mode = 'mosaic', brush = 9;
      let mosaicLayer = null, blurLayer = null, mask = null, patch = null;
      let layerKey = '', curMode = 'png';
      let raf = 0;

      const modeSeg = CT.ui.seg({
        items: [{ value: 'mosaic', label: '모자이크' }, { value: 'blur', label: '블러' }],
        value: 'mosaic',
        onChange: (v) => { mode = v; }
      });
      CT.$('#modeSeg', root).appendChild(modeSeg);

      const brushHost = CT.$('#brushHost', root);
      brushHost.appendChild(CT.ui.range({
        label: '붓 크기', min: 3, max: 40, step: 1, value: brush,
        format: (v) => v + '%',
        onInput: (v) => { brush = v; }
      }));

      const fmtSeg = CT.ui.seg({
        items: [{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }],
        value: 'png',
        onChange: (v) => { curMode = v; }
      });
      CT.$('#fmtHost', root).appendChild(fmtSeg);

      function attach(f) {
        file = f;
        CT.loadImage(f).then((res) => {
          if (img && img.close) img.close();
          img = res;
          strokes = [];
          editor.classList.remove('is-hidden');
          layout();
          buildLayers();
          render();
          CT.$('#fileInfo', root).innerHTML =
            '원본 <span class="mono">' + CT.esc(f.name) + '</span> · ' + img.w + '×' + img.h + ' · ' + CT.fmtBytes(f.size) +
            '<br>저장 파일에는 이 정보가 남지 않습니다.';
        }).catch((e) => CT.toast(e.message || '이 사진을 열 수 없어요'));
      }

      function layout() {
        const host = cv.parentElement;
        const maxW = Math.max(200, host.clientWidth - 2);
        const maxH = Math.min(window.innerHeight * 0.5, 600);
        const ratio = img.w / img.h;
        let w = maxW, h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
      }

      function buildLayers() {
        const W = cv.width, H = cv.height;
        layerKey = W + 'x' + H;
        mosaicLayer = CT.canvas(W, H);
        const block = Math.max(3, Math.min(W, H) / 110);
        const small = CT.canvas(Math.max(2, Math.round(W / block)), Math.max(2, Math.round(H / block)));
        const sctx = small.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(img.src, 0, 0, small.width, small.height);
        const mctx = mosaicLayer.getContext('2d');
        mctx.imageSmoothingEnabled = false;
        mctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, W, H);

        blurLayer = CT.canvas(W, H);
        const bctx = blurLayer.getContext('2d');
        const radius = Math.max(4, Math.min(W, H) * 0.014);
        if ('filter' in bctx) {
          bctx.filter = 'blur(' + radius + 'px)';
          bctx.drawImage(img.src, 0, 0, W, H);
          bctx.filter = 'none';
        } else {
          bctx.drawImage(mosaicLayer, 0, 0);
        }

        mask = CT.canvas(W, H);
        patch = CT.canvas(W, H);
      }

      function maskFor(m, W, H, list) {
        const c = mask.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#fff';
        c.strokeStyle = '#fff';
        c.lineCap = 'round';
        c.lineJoin = 'round';
        for (const s of list) {
          const r = s.size / 100 * Math.min(W, H);
          c.lineWidth = r;
          const pts = s.points;
          if (pts.length === 1) {
            c.beginPath();
            c.arc(pts[0][0] * W, pts[0][1] * H, r / 2, 0, Math.PI * 2);
            c.fill();
          } else {
            c.beginPath();
            c.moveTo(pts[0][0] * W, pts[0][1] * H);
            for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] * W, pts[i][1] * H);
            c.stroke();
          }
        }
      }

      function compose(target, W, H, all) {
        target.clearRect(0, 0, W, H);
        target.drawImage(img.src, 0, 0, W, H);
        ['mosaic', 'blur'].forEach((m) => {
          const list = all.filter((s) => s.mode === m);
          if (!list.length) return;
          maskFor(m, W, H, list);
          const p = patch.getContext('2d');
          p.setTransform(1, 0, 0, 1, 0, 0);
          p.clearRect(0, 0, W, H);
          p.drawImage(m === 'mosaic' ? mosaicLayer : blurLayer, 0, 0);
          p.globalCompositeOperation = 'destination-in';
          p.drawImage(mask, 0, 0);
          p.globalCompositeOperation = 'source-over';
          target.drawImage(patch, 0, 0);
        });
      }

      function render() {
        if (!img) return;
        const W = cv.width, H = cv.height;
        if (layerKey !== W + 'x' + H) buildLayers();
        const all = current ? strokes.concat([current]) : strokes;
        compose(ctx, W, H, all);
        hint.textContent = strokes.length ? '칠한 곳 ' + strokes.length + '군데 · 되돌리기로 하나씩 취소' : '손가락으로 문질러 가릴 부분을 칠하세요';
      }

      function queueRender() {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; render(); });
      }

      function pos(e) {
        const r = cv.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      }

      cv.addEventListener('pointerdown', (e) => {
        if (!img) return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        current = { mode: mode, size: brush, points: [pos(e)] };
        queueRender();
      });
      cv.addEventListener('pointermove', (e) => {
        if (!current) return;
        const p = pos(e);
        const last = current.points[current.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004) return;
        current.points.push(p);
        queueRender();
      });
      function endStroke(e) {
        if (!current) return;
        if (current.points.length === 1) current.points.push([current.points[0][0] + 0.0005, current.points[0][1]]);
        strokes.push(current);
        current = null;
        render();
      }
      cv.addEventListener('pointerup', endStroke);
      cv.addEventListener('pointercancel', endStroke);
      cv.addEventListener('pointerleave', (e) => { if (current && e.buttons === 0) endStroke(e); });

      CT.$('#undoBtn', root).addEventListener('click', () => {
        if (!strokes.length) return CT.toast('되돌릴 게 없어요');
        strokes.pop(); render();
      });
      CT.$('#clearBtn', root).addEventListener('click', () => {
        if (!strokes.length) return;
        strokes = []; render(); CT.toast('모두 지웠어요');
      });
      CT.$('#newBtn', root).addEventListener('click', () => {
        editor.classList.add('is-hidden');
        dropHost.innerHTML = '';
        dropHost.appendChild(makeDrop());
        dropHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      CT.$('#saveBtn', root).addEventListener('click', async () => {
        if (!img) return;
        const btn = CT.$('#saveBtn', root);
        btn.disabled = true; btn.textContent = '저장 중…';
        try {
          const out = CT.canvas(img.w, img.h);
          const octx = out.getContext('2d');
          if (curMode === 'jpg') { octx.fillStyle = '#fff'; octx.fillRect(0, 0, out.width, out.height); }
          octx.imageSmoothingQuality = 'high';
          octx.drawImage(img.src, 0, 0, img.w, img.h);

          // full-resolution layers
          const fullMosaic = CT.canvas(img.w, img.h);
          const fblock = Math.max(3, Math.min(img.w, img.h) / 110);
          const small = CT.canvas(Math.max(2, Math.round(img.w / fblock)), Math.max(2, Math.round(img.h / fblock)));
          const sctx = small.getContext('2d');
          sctx.drawImage(img.src, 0, 0, small.width, small.height);
          const fmc = fullMosaic.getContext('2d');
          fmc.imageSmoothingEnabled = false;
          fmc.drawImage(small, 0, 0, small.width, small.height, 0, 0, img.w, img.h);

          const fullBlur = CT.canvas(img.w, img.h);
          const fbc = fullBlur.getContext('2d');
          if ('filter' in fbc) {
            fbc.filter = 'blur(' + Math.max(4, Math.min(img.w, img.h) * 0.014) + 'px)';
            fbc.drawImage(img.src, 0, 0, img.w, img.h);
            fbc.filter = 'none';
          } else {
            fbc.drawImage(fullMosaic, 0, 0);
          }

          const fullMask = CT.canvas(img.w, img.h);
          const fullPatch = CT.canvas(img.w, img.h);
          ['mosaic', 'blur'].forEach((m) => {
            const list = strokes.filter((s) => s.mode === m);
            if (!list.length) return;
            const mc = fullMask.getContext('2d');
            mc.clearRect(0, 0, img.w, img.h);
            mc.fillStyle = '#fff'; mc.strokeStyle = '#fff';
            mc.lineCap = 'round'; mc.lineJoin = 'round';
            for (const s of list) {
              const r = s.size / 100 * Math.min(img.w, img.h);
              mc.lineWidth = r;
              if (s.points.length === 1) {
                mc.beginPath(); mc.arc(s.points[0][0] * img.w, s.points[0][1] * img.h, r / 2, 0, Math.PI * 2); mc.fill();
              } else {
                mc.beginPath();
                mc.moveTo(s.points[0][0] * img.w, s.points[0][1] * img.h);
                for (let i = 1; i < s.points.length; i++) mc.lineTo(s.points[i][0] * img.w, s.points[i][1] * img.h);
                mc.stroke();
              }
            }
            const pc = fullPatch.getContext('2d');
            pc.clearRect(0, 0, img.w, img.h);
            pc.drawImage(m === 'mosaic' ? fullMosaic : fullBlur, 0, 0);
            pc.globalCompositeOperation = 'destination-in';
            pc.drawImage(fullMask, 0, 0);
            pc.globalCompositeOperation = 'source-over';
            octx.drawImage(fullPatch, 0, 0);
          });

          const type = curMode === 'jpg' ? 'image/jpeg' : 'image/png';
          const name = CT.baseName(file.name) + '_clean.' + (curMode === 'jpg' ? 'jpg' : 'png');
          await CT.saveCanvas(out, name, type, 0.93);
          CT.toast('저장 완료 · EXIF 제거됨', 3000);
        } catch (e) {
          CT.toast(e.message || '저장에 실패했어요');
        } finally {
          btn.disabled = false; btn.textContent = 'EXIF 지우고 저장';
        }
      });

      window.addEventListener('resize', CT.debounce(() => {
        if (!img || editor.classList.contains('is-hidden')) return;
        layout(); buildLayers(); render();
      }, 180));

      function makeDrop() {
        return CT.ui.drop({
          label: '사진 선택',
          hint: 'JPG · PNG · HEIC · 탭하거나 끌어다 놓기',
          accept: 'image/*',
          multiple: false,
          onFiles: (files) => attach(files[0])
        });
      }
      dropHost.appendChild(makeDrop());
    }
  });
})();
