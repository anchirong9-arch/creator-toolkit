/* ⑤ 만료 없는 QR 생성기 */
(function () {
  'use strict';
  const CT = window.CT;

  function utf8ify() {
    if (window.qrcode && window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs['UTF-8']) {
      window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    }
  }

  function buildQR(text, ec) {
    utf8ify();
    let qr = null;
    for (let t = 1; t <= 40; t++) {
      try {
        const q = window.qrcode(t, ec);
        q.addData(text, 'Byte');
        q.make();
        qr = q;
        break;
      } catch (e) { /* try a larger version */ }
    }
    if (!qr) throw new Error('내용이 너무 길어요 — 조금 줄여 주세요');
    return qr;
  }

  function drawQR(canvas, qr, size, margin, fg, bg) {
    const count = qr.getModuleCount();
    const total = count + margin * 2;
    const cell = Math.max(1, Math.floor(size / total));
    const dim = cell * total;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = fg;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
      }
    }
    return dim;
  }

  CT.register({
    id: 'qr',
    short: 'QR',
    name: 'QR 생성기',
    desc: '링크·텍스트·와이파이 정보를 만료 없는 순수 QR 이미지로 — 광고도 없고 14일 만료도 없어요',
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card">' +
          '<div id="modeHost" style="margin-bottom:12px"></div>' +
          '<div id="fields"></div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="canvas-wrap" style="background:#fff;padding:12px"><canvas id="prev" style="max-width:260px;width:100%;height:auto"></canvas></div>' +
          '<div class="row between" style="margin-top:2px">' +
            '<span class="note" style="margin:0" id="meta"></span>' +
            '<button class="btn primary small" id="dl">PNG 저장</button>' +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div id="sizeHost"></div>' +
          '<div id="ecHost"></div>' +
          '<div id="marginHost"></div>' +
          '<div class="row" style="margin-top:6px">' +
            '<div class="field" style="flex:1;margin:0"><div class="label"><span>QR 색</span></div><input type="color" id="fg" value="#0b0e14" style="width:100%;height:42px;border-radius:12px;border:1px solid var(--line);background:var(--surface2)"></div>' +
            '<div class="field" style="flex:1;margin:0"><div class="label"><span>배경</span></div><input type="color" id="bg" value="#ffffff" style="width:100%;height:42px;border-radius:12px;border:1px solid var(--line);background:var(--surface2)"></div>' +
          '</div>' +
          '<p class="note">이미지 파일만 저장됩니다. 만료 기한·추적·워터마크가 없는 순수 QR이라 인쇄해도 계속 열립니다.</p>' +
        '</div>';

      let mode = 'link', size = 1024, ec = 'M', margin = 4, fg = '#0b0e14', bg = '#ffffff';
      let lastQR = null;

      const fields = CT.$('#fields', root);
      const prev = CT.$('#prev', root);

      CT.$('#modeHost', root).appendChild(CT.ui.seg({
        items: [{ value: 'link', label: '링크' }, { value: 'text', label: '텍스트' }, { value: 'wifi', label: '와이파이' }],
        value: 'link',
        onChange: (v) => { mode = v; buildFields(); }
      }));

      CT.$('#sizeHost', root).appendChild(CT.ui.select({
        label: '저장 크기', value: '1024',
        items: [
          { value: '512', label: '512px' },
          { value: '1024', label: '1024px (권장)' },
          { value: '2048', label: '2048px (인쇄용)' }
        ],
        onChange: (v) => { size = +v; update(); }
      }));
      CT.$('#ecHost', root).appendChild(CT.ui.select({
        label: '오류 복원 (높을수록 손상에 강함)', value: 'M',
        items: [
          { value: 'L', label: 'L · 7%' },
          { value: 'M', label: 'M · 15% (권장)' },
          { value: 'Q', label: 'Q · 25%' },
          { value: 'H', label: 'H · 30%' }
        ],
        onChange: (v) => { ec = v; update(); }
      }));
      const marginRange = CT.ui.range({
        label: '여백 (조용한 영역)', min: 0, max: 6, step: 1, value: 4,
        format: (v) => v + '칸',
        onInput: (v) => { margin = v; update(); }
      });
      CT.$('#marginHost', root).appendChild(marginRange);

      CT.$('#fg', root).addEventListener('input', (e) => { fg = e.target.value; update(); });
      CT.$('#bg', root).addEventListener('input', (e) => { bg = e.target.value; update(); });

      function escWifi(s) { return String(s || '').replace(/([\\;,":])/g, '\\$1'); }

      function payload() {
        if (mode === 'wifi') {
          const ssid = CT.$('#ssid', root) ? CT.$('#ssid', root).value.trim() : '';
          const pass = CT.$('#pass', root) ? CT.$('#pass', root).value : '';
          const sec = CT.$('#sec', root) ? CT.$('#sec', root).value : 'WPA';
          const hidden = CT.$('#hidden', root) ? CT.$('#hidden', root).checked : false;
          if (!ssid) return '';
          let s = 'WIFI:T:' + (sec === 'nopass' ? 'nopass' : sec) + ';S:' + escWifi(ssid) + ';';
          if (sec !== 'nopass') s += 'P:' + escWifi(pass) + ';';
          if (hidden) s += 'H:true;';
          return s + ';';
        }
        const el = CT.$('#linkIn', root) || CT.$('#textIn', root);
        let v = el ? el.value.trim() : '';
        if (!v) return '';
        if (mode === 'link' && !/^[a-zA-Z][\w+.-]*:/.test(v) && /^[\w-]+(\.[\w-]+)+/.test(v)) v = 'https://' + v;
        return v;
      }

      function buildFields() {
        if (mode === 'link') {
          fields.innerHTML =
            '<div class="field"><div class="label"><span>링크 주소</span></div>' +
            '<input type="url" id="linkIn" inputmode="url" placeholder="https://example.com" autocomplete="off"></div>';
          CT.$('#linkIn', root).addEventListener('input', CT.debounce(update, 220));
        } else if (mode === 'text') {
          fields.innerHTML =
            '<div class="field"><div class="label"><span>텍스트</span></div>' +
            '<textarea id="textIn" placeholder="QR에 담을 문구를 입력하세요"></textarea></div>';
          CT.$('#textIn', root).addEventListener('input', CT.debounce(update, 260));
        } else {
          fields.innerHTML =
            '<div class="field"><div class="label"><span>와이파이 이름 (SSID)</span></div>' +
            '<input type="text" id="ssid" placeholder="예: home_wifi" autocomplete="off"></div>' +
            '<div class="field"><div class="label"><span>비밀번호</span></div>' +
            '<input type="text" id="pass" placeholder="비밀번호" autocomplete="off"></div>' +
            '<div class="field"><div class="label"><span>보안 방식</span></div>' +
            '<select id="sec"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">비밀번호 없음</option></select></div>' +
            '<label class="row" style="gap:8px;font-size:13px;color:var(--muted)"><input type="checkbox" id="hidden" style="width:auto"> 숨겨진 네트워크</label>';
          ['ssid', 'pass', 'sec', 'hidden'].forEach((id) => {
            const el = CT.$('#' + id, root);
            el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', CT.debounce(update, 220));
          });
        }
        update();
      }

      function update() {
        const text = payload();
        const meta = CT.$('#meta', root);
        if (!text) {
          const c = CT.canvas(240, 240);
          const cx = c.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, 240, 240);
          cx.fillStyle = '#aab4c6'; cx.font = '13px sans-serif'; cx.textAlign = 'center';
          cx.fillText('내용을 입력하면', 120, 112); cx.fillText('QR이 바로 생성됩니다', 120, 132);
          prev.src = c.toDataURL();
          prev.style.width = '240px'; prev.style.height = '240px';
          meta.textContent = '';
          lastQR = null;
          return;
        }
        try {
          const qr = buildQR(text, ec);
          lastQR = { qr, text };
          const dim = drawQR(prev, qr, 520, margin, fg, bg);
          prev.style.width = '100%';
          prev.style.height = 'auto';
          meta.textContent = qr.getModuleCount() + '×' + qr.getModuleCount() + ' 모듈 · ' + text.length + '자';
        } catch (e) {
          meta.textContent = e.message;
          lastQR = null;
        }
      }

      CT.$('#dl', root).addEventListener('click', async () => {
        if (!lastQR) return CT.toast('먼저 내용을 입력해 주세요');
        try {
          const c = CT.canvas(size, size);
          drawQR(c, lastQR.qr, size, margin, fg, bg);
          const name = mode === 'wifi' ? 'wifi-qr.png' : 'qr-' + CT.baseName(mode === 'link' ? lastQR.text.replace(/^https?:\/\//, '') : 'text') + '.png';
          await CT.saveCanvas(c, name, 'image/png');
          CT.toast('QR 저장 완료');
        } catch (e) {
          CT.toast('저장에 실패했어요');
        }
      });

      buildFields();
    }
  });
})();
