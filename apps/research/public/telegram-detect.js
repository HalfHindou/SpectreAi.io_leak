/*
 * Telegram Mini App SDK loader.
 * Loads https://telegram.org/js/telegram-web-app.js only when running
 * inside Telegram (UA match or tgWebAppData URL param). Saves a
 * third-party request + ~30 KB on 99% of page loads.
 *
 * External file (vs inline) so we can drop 'unsafe-inline' from CSP.
 */
(function () {
  try {
    var ua = navigator.userAgent || '';
    var loc = location.href || '';
    var inTelegram = /Telegram/i.test(ua) ||
      loc.indexOf('tgWebAppData') !== -1 ||
      loc.indexOf('tgWebAppPlatform') !== -1;
    if (inTelegram) {
      var s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      s.defer = true;
      document.head.appendChild(s);
    }
  } catch (_) {}
})();
