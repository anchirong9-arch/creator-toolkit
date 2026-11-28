/* 오프라인 캐시 (앱 셸) — 문서/스크립트는 네트워크 우선, 이미지·아이콘은 캐시 우선 */
const CACHE = 'creator-toolkit-v3';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/boot.js',
  './js/tools/exif.js',
  './js/tools/url.js',
  './js/tools/pdf-image.js',
  './js/tools/compress.js',
  './js/tools/qr.js',
  './js/tools/resize.js',
  './js/tools/watermark.js',
  './js/tools/office.js',
  './office.html',
  './css/office.css',
  './js/office/excel.js',
  './js/office/pptx.js',
  './js/office/app.js',
  './lib/xlsx.full.min.js',
  './lib/jszip.min.js',
  './office/blank.pptx',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/jspdf.umd.min.js',
  './lib/qrcode.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const dynamic = req.mode === 'navigate' || /\.(html|js|css|json)$/i.test(url.pathname);
  if (dynamic) {
    e.respondWith(
      fetch(req).then((res) => put(req, res)).catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
    );
  } else {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res)).catch(() => caches.match('./index.html')))
    );
  }
});
