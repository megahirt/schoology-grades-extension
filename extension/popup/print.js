// print.js — the print page (popup/print.html?site=<origin>&uid=<child>):
// one child's dashboard on one sheet of Letter paper (src/print-view.js).
// The dashboard's Print button opens it in a new tab; it opens the print
// dialog by itself once it's laid out (?auto=0 leaves that to the Print
// button, for tests). Nothing leaves the device: it reads the same local
// storage as the dashboard.

import browser from 'webextension-polyfill';
import { renderPrintSheet, fitToOnePage, PRINT_CSS } from '../src/print-view.js';
import { setSite, getSettings, getDashboards, getTurnedIn, getMarkedDone, storageGet } from '../src/storage.js';
import { effectiveSettings, isStudentAccount } from '../src/rules.js';

// Storage reads the API from globalThis.browser.
if (!globalThis.browser) globalThis.browser = browser;

const style = document.createElement('style');
style.textContent = PRINT_CSS;
document.head.append(style);

async function main() {
  const params = new URLSearchParams(window.location.search);
  const site = params.get('site');
  if (site) setSite(site);
  const dashboards = (await getDashboards()) || {};
  const uids = Object.keys(dashboards);
  const uid = uids.includes(params.get('uid')) ? params.get('uid') : uids[0];
  const sheet = document.getElementById('sheet');
  const btn = document.getElementById('print-btn');
  btn.addEventListener('click', () => window.print());
  if (!uid) {
    sheet.innerHTML = '<p>No grades to print yet. Open Schoology, let the dashboard refresh, then press Print again.</p>';
    btn.disabled = true;
    return;
  }
  const account = await storageGet('account', null);
  const settings = effectiveSettings(await getSettings(), { isStudent: isStudentAccount(account, dashboards) });
  const isParentView = uids.length > 1 || uid !== 'self';
  const marks = { turnedIn: ((await getTurnedIn()) || {})[uid], done: ((await getMarkedDone()) || {})[uid] };
  const d = dashboards[uid];
  sheet.innerHTML = renderPrintSheet({ d, settings, marks, isParentView });
  document.title = `${d.studentName || 'Grades'} – Grades Dashboard`;
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const { trimmed, scale } = fitToOnePage(sheet);
  document.body.dataset.fit = JSON.stringify({ trimmed, scale });
  if (trimmed) document.getElementById('bar-text').textContent = 'One page, Letter size. Some long lists are cut short to fit.';
  if (params.get('auto') !== '0') setTimeout(() => window.print(), 300);
}

main().catch((e) => {
  document.getElementById('sheet').textContent = `Couldn't lay out the page: ${e && e.message ? e.message : e}`;
});
