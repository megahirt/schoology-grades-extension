// popup.js — the toolbar popup. Renders the shared dashboard view
// (src/dashboard-view.js); the same view is shown in the in-page panel on
// Schoology pages (src/panel.js).

import browser from 'webextension-polyfill';
import { mountDashboard, DASHBOARD_CSS, REAL_SCHOOLOGY } from '../src/dashboard-view.js';
import { setSite, getSettings, getSites } from '../src/storage.js';
import { isSchoologySite } from '../src/sites.js';
import { addedSchools, requestSchool, schoolOfferForTab } from '../src/school-access.js';

const style = document.createElement('style');
style.textContent = DASHBOARD_CSS;
document.head.append(style);

// Show the Schoology site of the tab the popup was opened on (each site has
// its own account and data); on any other tab, the site used last.
async function activeTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

async function pickSite(tab) {
  const sites = (await getSites()) || [];
  try {
    const origin = tab && tab.url ? new URL(tab.url).origin : null;
    if (origin && (isSchoologySite(tab.url, await addedSchools(browser)) || sites.includes(origin))) return origin;
  } catch {
    // no tab access: fall back to the last site used
  }
  const settings = (await getSettings()) || {};
  return settings.schoologyBase || REAL_SCHOOLOGY;
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

activeTab().then(async (tab) => {
  setSite(await pickSite(tab));
  mountDashboard(document.getElementById('dashboard'), { browser, openLinksInActiveTab: true, siteSwitch: true });
  showSchoolOffer(tab).catch(() => {});
});
