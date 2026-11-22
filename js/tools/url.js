/* ② URL 추적 파라미터 제거 */
(function () {
  'use strict';
  const CT = window.CT;

  const GENERIC = [
    'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'ttclid',
    'li_fat_id', 'mc_cid', 'mc_eid', 'mkt_tok', '_ga', '_gl', '_gac', '_hsenc', '_hsmi', 'hsCtaTracking',
    'igsh', 'igshid', 'si', 'spm', 'scm', 'ncid', 'cmpid', 'campaign_id', 'af_xdp', 's_kwcid',
    'trk', 'trkcampaign', 'cvid', 'epik', 'pp', 'ref_src', 'ref_url', 's_cid', 'sc_cid',
    '_openstat', 'wt_mc', 'wt_zmc', 'vero_id', 'vero_conv', 'wickedid', 'oly_anon_id', 'oly_enc_id',
    'share_id', 'ig_mid', 'utm', 'ga_source', 'ga_medium', 'ga_campaign', 'ga_content', 'ga_term'
  ];

  const HOST_RULES = [
    {
      test: /(^|\.)(instagram\.com|instagr\.am|threads\.com|threads\.net)$/i,
      drop: ['igsh', 'igshid', 'img_index', 'lqvp', 'bqrl', 'hvrq', 'fqnt', 'hl', '__coig_cache_ts', 'slof', 'xmt', 'e']
    },
    {
      test: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i,
      drop: ['si', 'feature', 'pp', 'ab_channel', 'kw', 'embeds_referring_euri', 'source_ve_path', 'start_radio', 'index', 'themeRefresh', 'app']
    },
    {
      test: /(^|\.)(coupang\.com|tw.coupang\.com)$/i,
      drop: ['src', 'spec', 'q', 'searchid', 'rank', 'isaddedcart', 'clickevent', 'ctag', 'sourcetype', 'searchkeyword', 'af', 'pm', 'mc_cid', 'trk', 'trackingcode', 'sharesource', 'sharechannel', 'sharetarget']
    },
    {
      test: /(^|\.)(naver\.com|naver\.me)$/i,
      drop: ['where', 'query', 'oquery', 'sm', 'ssc', 'nso', 'nlu', 'from', 'fromr', 'fromn', 'naverle', 'frm', 'ic', 'ac', 'directaccess', 'tqi', 'trk', 'spq', 'start', 'click_area']
    },
    {
      test: /(^|\.)(tiktok\.com)$/i,
      drop: ['is_from_webapp', 'sender_device', 'sender_web_id', 'web_id', 'share_app_id', 'share_link_id', '_r', '_t', 'check_retry', 'embed_source', 'refer', 'social_sharing']
    },
    {
      test: /(^|\.)(x\.com|twitter\.com)$/i,
      drop: ['s', 't', 'cn', 'ref_src', 'ref_url', 'src']
    },
    {
      test: /(^|\.)(facebook\.com|fb\.com)$/i,
      drop: ['mibextid', 'paipv', 'rdr', 'sfnsn', '__tn__', 'fbid', 'extid', 'hc_ref', 'ref']
    },
    {
      test: /(^|\.)(smartstore\.naver\.com|brand\.naver\.com)$/i,
      drop: ['naverle', 'nso', 'frm', 'where', 'from', 'sm']
    }
  ];

  const WRAPPERS = [
    { host: /^l\.instagram\.com$/i, param: 'u' },
    { host: /^l\.threads\.(com|net)$/i, param: 'u' },
    { host: /^l\.facebook\.com$/i, param: 'u' },
    { host: /^(www\.)?google\.[a-z.]+$/i, param: 'q' },
    { host: /^(www\.)?google\.[a-z.]+$/i, param: 'url' },
    { host: /^out\.reddit\.com$/i, param: 'url' },
    { host: /^t\.co$/i, param: null }
  ];

  function hostKey(host) { return (host || '').toLowerCase().replace(/^www\./, ''); }

  function rulesFor(host) {
    const h = hostKey(host);
    const drop = new Set(GENERIC);
    for (const r of HOST_RULES) if (r.test.test(h)) r.drop.forEach((d) => drop.add(d.toLowerCase()));
    return drop;
  }

  function cleanOnce(input) {
    const u = new URL(input);
    const drop = rulesFor(u.hostname);
    const removed = [];
    const kept = [];
    u.searchParams.forEach((value, key) => {
      const k = key.toLowerCase();
      const isUtm = /^utm_/.test(k) || /^mtm_/.test(k) || /^pk_(campaign|source|medium|kwd|content)$/.test(k);
      if (drop.has(k) || isUtm) removed.push(key);
      else kept.push([key, value]);
    });
    const qs = new URLSearchParams();
    kept.forEach(([k, v]) => qs.append(k, v));
    const query = qs.toString();
    const out = u.origin + u.pathname + (query ? '?' + query : '') + (u.hash && u.hash !== '#' ? u.hash : '');
    return { url: out, removed };
  }

  function clean(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
    let s = (m ? m[0] : text).replace(/[.,;:!?]+$/, '');
    if (!/^https?:\/\//i.test(s)) {
      if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = 'https://' + s;
      else return { input: text, output: text, removed: [], invalid: true };
    }

    let removed = [];
    try {
      // unwrap redirect wrappers (instagram / google / facebook …)
      for (let i = 0; i < 3; i++) {
        const u = new URL(s);
        let changed = false;
        for (const w of WRAPPERS) {
          if (w.host.test(u.hostname) && w.param && u.searchParams.get(w.param)) {
            const inner = u.searchParams.get(w.param);
            if (/^https?:\/\//i.test(inner)) { s = inner; changed = true; break; }
          }
        }
        if (!changed) break;
      }
      const res = cleanOnce(s);
      removed = res.removed;
      return { input: text, output: res.url, removed, invalid: false };
    } catch (e) {
      return { input: text, output: text, removed: [], invalid: true };
    }
  }

  CT.__cleanUrl = clean;

  CT.register({
    id: 'url',
    short: 'URL',
    name: 'URL 추적 제거',
    desc: '인스타·스레드·쿠팡·유튜브·네이버 링크의 지저분한 추적 꼬리표를 잘라내고 원본 주소만 복사',
    icon: '<svg viewBox="0 0 24 24"><path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.6 1.6"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.6-1.6"/></svg>',

    mount(root) {
      root.innerHTML =
        '<div class="card">' +
          '<div class="field"><div class="label"><span>링크 붙여넣기</span><b id="cnt"></b></div>' +
          '<textarea id="inp" placeholder="https://www.instagram.com/reel/…?igsh=…&#10;여러 개는 줄바꿈으로 한 번에 붙여넣으세요"></textarea></div>' +
          '<div class="row">' +
            '<button class="btn primary small" id="runBtn">정리하기</button>' +
            '<button class="btn small" id="pasteBtn">붙여넣기</button>' +
            '<button class="btn small" id="sampleBtn">예시</button>' +
            '<button class="btn small ghost" id="clearBtn">지우기</button>' +
          '</div>' +
        '</div>' +
        '<div class="card is-hidden" id="outCard">' +
          '<div class="row between" style="margin-bottom:10px"><h3 style="margin:0">정리 결과</h3><button class="btn small primary" id="copyAll">전체 복사</button></div>' +
          '<div id="out"></div>' +
        '</div>' +
        '<div class="card"><div class="hintbar">' + CT.ICON.info +
          '<div>utm_* · fbclid · gclid · igsh · si 같은 추적 값만 지우고, 상품 번호·게시물 주소처럼 링크를 여는 데 필요한 값은 그대로 둡니다. 인스타·구글 공유용 중계 링크(l.instagram.com, google.com/url)는 원본 주소로 풀어 줍니다.</div>' +
        '</div></div>';

      const inp = CT.$('#inp', root);
      const out = CT.$('#out', root);
      const outCard = CT.$('#outCard', root);
      let results = [];

      function run() {
        const lines = inp.value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
        results = lines.map(clean).filter(Boolean);
        CT.$('#cnt', root).textContent = results.length ? results.length + '개' : '';
        if (!results.length) { outCard.classList.add('is-hidden'); return; }
        outCard.classList.remove('is-hidden');

        out.innerHTML = results.map((r, i) => {
          const changed = r.output !== r.input;
          return '<div class="res" style="flex-direction:column;align-items:stretch;gap:8px">' +
            '<div class="row between"><span style="font-size:11.5px;color:var(--dim);font-weight:700">' +
              (r.invalid ? '주소 형식이 아니에요' : (changed ? '정리됨' : '이미 깔끔해요')) + '</span>' +
              '<button class="btn small" data-copy="' + i + '">복사</button></div>' +
            '<div class="urlline">' + CT.esc(r.output) + '</div>' +
            (r.removed.length ? '<div class="removed">' + r.removed.map((x) => '<span>' + CT.esc(x) + '</span>').join('') + '</div>' : '') +
            (changed ? '<details><summary style="font-size:11.5px;color:var(--dim);cursor:pointer">원본 보기</summary><div class="urlline dim" style="margin-top:6px">' + CT.esc(r.input) + '</div></details>' : '') +
            '</div>';
        }).join('');

        out.querySelectorAll('[data-copy]').forEach((b) => {
          b.addEventListener('click', () => {
            const r = results[+b.dataset.copy];
            CT.copy(r ? r.output : '');
          });
        });
        CT.$('#copyAll', root).classList.toggle('is-hidden', results.length < 2);
      }

      CT.$('#runBtn', root).addEventListener('click', run);
      CT.$('#copyAll', root).addEventListener('click', () => {
        CT.copy(results.map((r) => r.output).join('\n'));
      });
      CT.$('#pasteBtn', root).addEventListener('click', async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (!t) return CT.toast('클립보드가 비어 있어요');
          inp.value = t.trim(); run();
        } catch (e) {
          inp.focus(); CT.toast('직접 붙여넣어 주세요 (길게 눌러 붙여넣기)');
        }
      });
      CT.$('#clearBtn', root).addEventListener('click', () => {
        inp.value = ''; results = []; outCard.classList.add('is-hidden'); CT.$('#cnt', root).textContent = '';
      });
      CT.$('#sampleBtn', root).addEventListener('click', () => {
        inp.value = [
          'https://www.instagram.com/reel/C8xYzAbCdEf/?igsh=MXY2b3RrZXhhbXA1bQ%3D%3D&img_index=2',
          'https://www.threads.com/@calmtiger_/post/Df9TORngV-F?lqvp=1&hl=ko',
          'https://www.coupang.com/vp/products/1234567890?vendorItemId=9876543210&src=1139000&spec=10799999&addtag=400&ctag=&rank=3&searchId=abc',
          'https://youtu.be/dQw4w9WgXcQ?si=AbCdEfGhIjKlMn&feature=share',
          'https://blog.naver.com/example/223456789?where=postShare&sm=tab_share&nso=&from=post'
        ].join('\n');
        run();
      });
      inp.addEventListener('input', CT.debounce(run, 350));
      inp.addEventListener('paste', () => setTimeout(run, 30));
    }
  });
})();
