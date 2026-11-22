/* 부팅 */
(function () {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.CT.start());
  } else {
    window.CT.start();
  }
})();
