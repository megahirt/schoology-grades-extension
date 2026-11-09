// links.js: every store link in one place, and the "Get it for this device"
// button. When a store listing goes live, paste its URL here; the buttons
// switch from "Coming soon" to a real link on every page.
window.SITE_LINKS = {
  safariMac: '',     // Mac App Store listing
  safariIOS: '',     // App Store listing (iPhone and iPad)
  chrome: '',        // Chrome Web Store listing
  edge: '',          // Microsoft Edge Add-ons listing (Edge can also install from the Chrome Web Store)
  firefox: '',       // addons.mozilla.org listing (desktop and Android)
  releases: 'https://github.com/megahirt/schoology-grades-extension/releases',
  source: 'https://github.com/megahirt/schoology-grades-extension',
};

(function () {
  const L = window.SITE_LINKS;
  const NAMES = {
    safariMac: 'Safari on Mac', safariIOS: 'Safari on iPhone/iPad', chrome: 'Chrome',
    edge: 'Edge', firefox: 'Firefox',
  };

  // Which browser this visitor most likely needs.
  function detect() {
    const ua = navigator.userAgent || '';
    const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (/iPhone|iPod/.test(ua) || iPad) return { key: 'safariIOS', label: iPad ? 'iPad' : 'iPhone' };
    if (/Android/.test(ua)) return { key: 'firefox', label: 'Android (Firefox)' };
    if (/Edg\//.test(ua)) return { key: 'edge', label: 'Edge' };
    if (/Firefox\//.test(ua)) return { key: 'firefox', label: 'Firefox' };
    if (/Chrome\//.test(ua)) return { key: 'chrome', label: 'Chrome' };
    if (/Macintosh/.test(ua)) return { key: 'safariMac', label: 'Safari on Mac' };
    return null;
  }

  function wire(el, key) {
    const url = L[key];
    if (url) {
      el.href = url;
      el.classList.remove('soon');
      el.classList.add('primary');
      if (el.dataset.label) el.textContent = el.dataset.label;
    } else {
      el.removeAttribute('href');
      el.setAttribute('aria-disabled', 'true');
      el.classList.add('soon');
      el.classList.remove('primary');
      el.textContent = `${el.dataset.label || NAMES[key]}: coming soon`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Store buttons: <a class="btn" data-store="chrome" data-label="Add to Chrome">
    for (const el of document.querySelectorAll('[data-store]')) wire(el, el.dataset.store);
    for (const el of document.querySelectorAll('[data-link]')) {
      if (L[el.dataset.link]) el.href = L[el.dataset.link];
    }

    // The hero's device-matched button.
    const d = detect();
    const btn = document.querySelector('#get-it');
    const note = document.querySelector('#get-it-note');
    if (btn && d) {
      const url = L[d.key];
      if (url) {
        btn.href = url;
        btn.textContent = `Get it for ${d.label}`;
      } else {
        btn.href = `install.html#${d.key}`;
        btn.textContent = `How to get it on ${d.label}`;
      }
      if (note) note.textContent = 'Picked for the device you’re on. ';
    }
    // Highlight this device on the install page.
    if (d) {
      const card = document.getElementById(d.key);
      if (card) card.classList.add('here');
      const here = document.getElementById('you-are-on');
      if (here) here.textContent = `You’re on ${d.label}: that browser is highlighted below.`;
    }
  });
})();
