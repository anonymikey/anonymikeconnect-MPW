(function () {
  'use strict';

  var deferredPrompt = null;
  var dismissalKey = 'supaLanInstallDismissedAt';
  var dismissalCooldown = 7 * 24 * 60 * 60 * 1000;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isHomePage() {
    return document.body && document.body.getAttribute('data-supa-lan-home') === 'true';
  }

  function wasRecentlyDismissed() {
    try {
      return Date.now() - Number(window.localStorage.getItem(dismissalKey) || 0) < dismissalCooldown;
    } catch (error) {
      return false;
    }
  }

  function createBanner() {
    var banner = document.createElement('aside');
    banner.id = 'supa-lan-install-banner';
    banner.hidden = true;
    banner.setAttribute('aria-label', 'Install SUPA LAN');
    banner.innerHTML = '<img class="supa-lan-install-icon" src="/icons/supalan-192.png" alt="SUPA LAN">' +
      '<span class="supa-lan-install-copy">Install SUPA LAN for faster access</span>' +
      '<button class="supa-lan-install-button" type="button">Install</button>' +
      '<button class="supa-lan-install-close" type="button" aria-label="Dismiss install message">&times;</button>';
    document.body.prepend(banner);

    banner.querySelector('.supa-lan-install-close').addEventListener('click', function () {
      try { window.localStorage.setItem(dismissalKey, String(Date.now())); } catch (error) {}
      banner.hidden = true;
    });
    banner.querySelector('.supa-lan-install-button').addEventListener('click', function () {
      if (!deferredPrompt || isStandalone()) return;
      var button = this;
      button.disabled = true;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        banner.hidden = true;
      }).catch(function () {
        button.disabled = false;
      });
    });
    return banner;
  }

  function start() {
    if (!isHomePage()) return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
    if (isStandalone()) return;
    var banner = createBanner();
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      if (isStandalone() || wasRecentlyDismissed()) return;
      deferredPrompt = event;
      banner.hidden = false;
    }, { once: false });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      banner.hidden = true;
    });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}());
