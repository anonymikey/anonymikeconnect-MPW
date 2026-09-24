(function () {
  'use strict';

  var deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function createBanner() {
    var banner = document.createElement('aside');
    banner.id = 'supa-lan-install-banner';
    banner.hidden = true;
    banner.setAttribute('aria-label', 'Install SUPA LAN');
    banner.innerHTML = '<img class="supa-lan-install-icon" src="img/logo.png" alt="SUPA LAN">' +
      '<span class="supa-lan-install-copy">Install SUPA LAN for faster access</span>' +
      '<button class="supa-lan-install-button" type="button">Install</button>' +
      '<button class="supa-lan-install-close" type="button" aria-label="Dismiss install message">&times;</button>';
    document.body.prepend(banner);

    banner.querySelector('.supa-lan-install-close').addEventListener('click', function () {
      banner.hidden = true;
    });
    banner.querySelector('.supa-lan-install-button').addEventListener('click', function () {
      if (!deferredPrompt) return;
      var button = this;
      button.disabled = true;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; banner.hidden = true; }).catch(function () { button.disabled = false; });
    });
    return banner;
  }

  function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(function () {});
    if (isStandalone()) return;
    var banner = createBanner();
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      banner.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      banner.hidden = true;
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
