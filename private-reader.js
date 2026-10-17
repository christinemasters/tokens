(function () {
  'use strict';
  const form = document.getElementById('unlock-reading');
  if (!form) return;
  const password = document.getElementById('reading-password');
  const status = document.getElementById('unlock-status');
  const button = form.querySelector('button');
  const config = JSON.parse(document.getElementById('private-config').textContent);
  const storageKey = 'attwhl.private.' + config.edition;
  const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const encode = bytes => btoa(String.fromCharCode(...bytes));
  let payload;
  function savedSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (saved && saved.expires > Date.now()) return saved;
      sessionStorage.removeItem(storageKey);
    } catch (_) { /* Unlocking still works when browser storage is unavailable. */ }
    return null;
  }
  async function open(raw, expires) {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const clear = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(payload.iv), additionalData:new TextEncoder().encode(location.pathname), tagLength:128}, key, decode(payload.ciphertext));
    try { sessionStorage.setItem(storageKey, JSON.stringify({key:encode(raw), expires})); } catch (_) {}
    password.value = '';
    const html = new TextDecoder('utf-8', {fatal:true}).decode(clear);
    // Pass only the expiry to the new document, including when storage is blocked.
    window.__attwhlPrivateSession = {edition:config.edition, expires};
    // Only authenticated, publisher-generated HTML is decrypted and rendered here.
    document.open(); document.write(html); document.close();
  }
  async function unlock(event) {
    if (event) event.preventDefault();
    button.disabled = true; status.textContent = 'Unlocking…';
    try {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.value.trim()), 'PBKDF2', false, ['deriveBits']);
      const raw = new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:decode(payload.salt), iterations:payload.iterations}, material, 256));
      await open(raw, Date.now() + 12 * 60 * 60 * 1000);
    } catch (_) {
      status.textContent = 'That password did not unlock this chapter. Try again.';
      password.focus(); password.select(); button.disabled = false;
    }
  }
  form.addEventListener('submit', unlock);
  (async function () {
    if (!window.isSecureContext || !window.crypto || !crypto.subtle) {
      status.textContent = 'Open this page over HTTPS in a current browser to unlock it.'; return;
    }
    button.disabled = true;
    try {
      const response = await fetch(config.payload, {cache:'no-store', credentials:'omit'});
      if (!response.ok) throw new Error('Unable to load chapter');
      payload = await response.json();
      const saved = savedSession();
      if (saved) {
        try { await open(decode(saved.key), saved.expires); return; }
        catch (_) { try { sessionStorage.removeItem(storageKey); } catch (_) {} }
      }
      status.textContent = ''; button.disabled = false;
    } catch (_) {
      status.textContent = 'This chapter could not be loaded. Reload the page and try again.';
    }
  })();
})();
