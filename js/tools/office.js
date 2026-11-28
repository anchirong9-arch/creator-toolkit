/* ⑧ 엑셀 · PPT 편집기 — 별도 페이지(office.html)로 여는 도구 */
(function () {
  'use strict';
  const CT = window.CT;

  const icon =
    '<svg viewBox="0 0 24 24">' +
    '<path d="M4.5 3.5h9L19 9v11.5H4.5z"/>' +
    '<path d="M13.2 3.6V9h5.4"/>' +
    '<path d="M7.2 12.4h6.4M7.2 15.4h8.2M7.2 18.2h4.6"/>' +
    '</svg>';

  CT.register({
    id: 'office',
    name: '엑셀 · PPT 편집기',
    short: '엑셀·PPT',
    desc: '오피스 없이 브라우저에서 .xlsx·.xlsb·.xls·.csv·.pptx 열기 · 셀·슬라이드 편집 · 이미지 압축 · 저장',
    icon: icon,
    href: 'office.html',
    mount: function (body) {
      // office.html 로 이동하는 안내 (직접 #/office 로 들어온 경우)
      body.innerHTML =
        '<div class="card">' +
        '<h3>편집기를 여는 중…</h3>' +
        '<p class="note">잠시 후 엑셀 · PPT 편집기로 이동합니다. ' +
        '자동으로 넘어가지 않으면 <a href="office.html" style="color:#a9b6ff;text-decoration:underline">여기를 눌러 주세요</a>.</p>' +
        '</div>';
      setTimeout(function () { location.replace('office.html'); }, 60);
    }
  });
})();
