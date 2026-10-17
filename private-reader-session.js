(function () {
  'use strict';
  const config = JSON.parse(document.getElementById('private-session').textContent);
  const storageKey = 'attwhl.private.' + config.edition;
  const openingSession = window.__attwhlPrivateSession;
  delete window.__attwhlPrivateSession;
  function current() {
    try { const saved=JSON.parse(sessionStorage.getItem(storageKey)); return saved && saved.expires>Date.now(); }
    catch (_) { return false; }
  }
  function lock() {
    try { sessionStorage.removeItem(storageKey); } catch (_) {}
    // Hide the decrypted document before navigation, including when offline.
    document.body.replaceChildren();
    location.replace(location.pathname);
  }
  document.getElementById('lock-reading').addEventListener('click', lock);
  window.addEventListener('pageshow', event => {
    if (event.persisted && !current()) {
      document.body.replaceChildren();
      location.reload();
    }
  });
  const expiry = (() => {
    if (openingSession && openingSession.edition === config.edition && Number.isFinite(openingSession.expires)) return openingSession.expires;
    try { return JSON.parse(sessionStorage.getItem(storageKey)).expires; } catch (_) { return 0; }
  })();
  if (expiry) setTimeout(lock, Math.max(0, expiry-Date.now()));
})();
