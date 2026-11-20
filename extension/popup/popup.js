// popup.js — the toolbar popup. The dashboard itself lives on the Schoology
// page (src/panel.js), so the popup doesn't show it again: it lists the
// Schoology addresses where the dashboard appears, as links, so someone on
// another page can get there in one tap, and a quiet "See a demo" link to the
// full dashboard page (popup/dashboard.html, with "Load demo data"). On a
// school's own Schoology address the extension doesn't cover yet, it also
// offers to use it there.

import browser from 'webextension-polyfill';
import { REAL_SCHOOLOGY, SCHOOL_HOSTS } from '../src/sites.js';
import { requestSchool, schoolOfferForTab } from '../src/school-access.js';

// The addresses, in the order a family is most likely to use them.
export const POPUP_SITES = [REAL_SCHOOLOGY, ...SCHOOL_HOSTS.map((h) => `https://${h}`)];

async function activeTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

// Open a site in a new tab and close the popup (Safari on iPhone keeps a
// popup open over the page otherwise).
function openSite(url) {
  browser.tabs.create({ url }).then(() => window.close(), () => window.open(url, '_blank'));
}

function drawSites() {
  const list = document.getElementById('sites');
  for (const origin of POPUP_SITES) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'site';
    a.href = `${origin}/`;
    a.textContent = new URL(origin).host;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openSite(a.href);
    });
    li.append(a);
    list.append(li);
  }
}

// On a school's own Schoology address the extension doesn't cover yet:
// offer to use it there (src/school-access.js). The browser asks the family
// for that one site; background.js then sets it up and reloads the page.
async function showSchoolOffer(tab) {
  const offer = await schoolOfferForTab(browser, tab);
  if (!offer) return;
  const box = document.getElementById('school-offer');
  const btn = document.getElementById('school-offer-btn');
  const note = document.getElementById('school-offer-note');
  const text = document.getElementById('school-offer-text');
  text.textContent = '';
  const b = document.createElement('strong');
  b.textContent = offer.host;
  text.append(b, offer.known ? ' is a school\'s own Schoology address.' : ' looks like a Schoology site.');
  box.hidden = false;
  btn.addEventListener('click', () => {
    // Ask first, inside the click: the prompt needs the user's gesture.
    requestSchool(browser, offer.origin).then((ok) => {
      if (!ok) {
        note.textContent = 'Not allowed. You can add it later in Settings.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Added';
      note.textContent = 'Reloading the page so the dashboard can read your grades there…';
      setTimeout(() => window.close(), 1500);
    }, (e) => {
      note.textContent = `Couldn't ask for this site: ${e && e.message ? e.message : e}`;
    });
  });
}

drawSites();
// The full dashboard on a page of its own, where "Load demo data" shows
// made-up students (for anyone without Schoology, and store reviewers).
document.getElementById('demo-link').addEventListener('click', (e) => {
  e.preventDefault();
  openSite(browser.runtime.getURL('popup/dashboard.html'));
});
activeTab().then((tab) => showSchoolOffer(tab)).catch(() => {});
