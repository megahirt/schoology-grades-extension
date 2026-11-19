// links.js: every store link in one place, and the home page's "Get it"
// button for this device. When a store listing goes live, paste its URL here; the buttons
// switch from "Coming soon" to a real link on every page.
window.SITE_LINKS = {
  safariMac: 'https://apps.apple.com/app/grades-dashboard-for-schoology/id6833034168', // App Store listing (one listing for Mac, iPhone and iPad)
  safariIOS: 'https://apps.apple.com/app/grades-dashboard-for-schoology/id6833034168', // the same listing
  chrome: 'https://chromewebstore.google.com/detail/grades-dashboard-for-scho/nglbmnaepjadllenolmliglnonjkdhjp', // Chrome Web Store listing
  edge: '',          // Microsoft Edge Add-ons listing (Edge can also install from the Chrome Web Store)
  firefox: '',       // addons.mozilla.org listing (desktop and Android)
  releases: 'https://github.com/megahirt/schoology-grades-extension/releases',
  latestRelease: 'https://github.com/megahirt/schoology-grades-extension/releases/latest',
  source: 'https://github.com/megahirt/schoology-grades-extension',
  // Latest release (X.Y.Z). Leave empty here: pages.yml fills it in at
  // deploy time from the newest vX.Y.Z tag. Keep this line's exact form.
  version: '',
};

(function () {
  const L = window.SITE_LINKS;
  // A store's link; Edge falls back to the Chrome Web Store (Edge installs
  // from it too) until there's an Edge Add-ons listing.
  const urlFor = (key) => L[key] || (key === 'edge' ? L.chrome : '');
  const NAMES = {
    safariMac: 'Safari on Mac', safariIOS: 'Safari on iPhone/iPad', chrome: 'Chrome',
    edge: 'Edge', firefox: 'Firefox',
  };

  // The browser's logo for the hero's button.
  const LOGOS = { safariMac: 'safari', safariIOS: 'safari', chrome: 'chrome', edge: 'edge', firefox: 'firefox' };
  function logo(key) {
    const img = document.createElement('img');
    img.src = `img/browsers/${LOGOS[key]}.svg`;
    img.alt = '';
    img.width = 24;
    img.height = 24;
    img.className = 'btn-logo';
    return img;
  }

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
    const url = urlFor(key);
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
    // Footer store icons: a store with its own listing links to it; the
    // others are greyed out and link nowhere ("coming soon").
    for (const el of document.querySelectorAll('[data-store-link]')) {
      const key = el.dataset.storeLink;
      if (L[key]) {
        el.href = L[key];
      } else {
        el.removeAttribute('href');
        el.setAttribute('aria-disabled', 'true');
        el.classList.add('soon');
        el.title = `${NAMES[key] || 'This browser'}: coming soon`;
      }
    }
    for (const el of document.querySelectorAll('[data-link]')) {
      if (L[el.dataset.link]) el.href = L[el.dataset.link];
    }

    // The latest release version: <span data-version hidden> shows
    // "v1.4.0", and every page's footer gets a "Version 1.4.0" line.
    if (L.version) {
      for (const el of document.querySelectorAll('[data-version]')) {
        el.textContent = `v${L.version}`;
        el.hidden = false;
      }
      const foot = document.querySelector('.site-foot .cols > div');
      if (foot) {
        const line = document.createElement('div');
        line.className = 'small muted';
        const a = document.createElement('a');
        a.href = L.latestRelease;
        a.textContent = `Version ${L.version}`;
        line.append(a);
        foot.append(line);
      }
    }

    // The hero's button: the store for this device, or "coming soon"
    // until that listing exists.
    const d = detect();
    const btn = document.querySelector('#get-it');
    if (btn) {
      const url = d && urlFor(d.key);
      if (url) {
        btn.href = url;
        btn.textContent = `Get it for ${d.label}`;
        btn.prepend(logo(d.key));
      } else {
        btn.removeAttribute('href');
        btn.setAttribute('aria-disabled', 'true');
        btn.classList.add('soon');
        btn.classList.remove('primary');
        btn.textContent = d ? `Coming soon for ${d.label}` : 'Coming soon';
        if (d) btn.prepend(logo(d.key));
      }
    }
  });
})();
