// popup.js — the toolbar popup. Renders the shared dashboard view
// (src/dashboard-view.js); the same view is shown in the in-page panel on
// Schoology pages (src/panel.js).

import browser from 'webextension-polyfill';
import { mountDashboard, DASHBOARD_CSS, REAL_SCHOOLOGY } from '../src/dashboard-view.js';
import { setSite, getSettings, getSites } from '../src/storage.js';
import { isSchoologySite } from '../src/sites.js';

const style = document.createElement('style');
style.textContent = DASHBOARD_CSS;
document.head.append(style);

// Show the Schoology site of the tab the popup was opened on (each site has
// its own account and data); on any other tab, the site used last.
async function pickSite() {
  const sites = (await getSites()) || [];
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const origin = tab && tab.url ? new URL(tab.url).origin : null;
    if (origin && (isSchoologySite(tab.url) || sites.includes(origin))) return origin;
  } catch {
    // no tab access: fall back to the last site used
  }
  const settings = (await getSettings()) || {};
  return settings.schoologyBase || REAL_SCHOOLOGY;
}

pickSite().then((site) => {
  setSite(site);
  mountDashboard(document.getElementById('dashboard'), { browser, openLinksInActiveTab: true, siteSwitch: true });
});
