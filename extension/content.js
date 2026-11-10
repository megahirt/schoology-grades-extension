// content.js — runs on Schoology pages (document_idle + MutationObserver
// until the grades table is present). Scrapes the RENDERED DOM with the
// same parser core as the service worker (src/parser-core.js). Sends results
// to the background service worker and reports the current page URL (for
// probe URL capture). Never changes Schoology's own content; the only thing
// it adds is the dashboard panel (src/panel.js), in its own shadow root,
// which is always on.

import browser from 'webextension-polyfill';
import { parseGradesRoot } from './src/parser-core.js';
import { mountPanel } from './src/panel.js';
import { storageGet, storageSet, setSite } from './src/storage.js';
import { readComposeHash } from './src/teacher-email.js';
import { isSchoologySite, looksLikeSchoology } from './src/sites.js';
import { extractUserUid } from './src/schoology.js';

// Same parser as the service worker (parser-core.js), run on the live DOM.
function scrapeGrades() {
  const parsed = parseGradesRoot(document, {
    sourceUrl: window.location.href,
    baseUrl: window.location.origin,
  });
  return parsed.courses.filter((c) => c.assignments.length > 0 || c.name);
}

let sent = false;

function sendScrape() {
  const courses = scrapeGrades();
  if (courses.length === 0) return false;
  if (sent) return true;
  sent = true;
  browser.runtime
    .sendMessage({ type: 'grades-scraped', url: window.location.href, courses })
    .catch(() => {
      sent = false; // background not ready; allow a later retry
    });
  return true;
}

// Report the current page URL so the probe can capture the exact Grades URL.
function reportUrl() {
  browser.runtime
    .sendMessage({ type: 'grades-page-url', url: window.location.href })
    .catch(() => {});
}

// Tell the background a Schoology page loaded, so it can refresh the
// dashboard automatically when the data is stale (top frame only).
function reportPageLoaded() {
  if (window.top !== window) return;
  browser.runtime
    .sendMessage({ type: 'schoology-page-loaded', url: window.location.href })
    .catch(() => {});
}

function init() {
  reportUrl();
  reportPageLoaded();
  if (sendScrape()) return;
  // Grades pages load data asynchronously: observe until the table appears.
  // Debounced: re-parse at most every 500 ms, not on every mutation.
  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (sendScrape()) observer.disconnect();
    }, 500);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Give up observing after 30s so we never leak an observer forever.
  setTimeout(() => observer.disconnect(), 30000);
}

browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'scrape-now') {
    sent = false;
    const courses = scrapeGrades();
    return Promise.resolve({ type: 'grades-scraped', url: window.location.href, courses });
  }
  return undefined;
});

// Who is signed in on this page: { uid } from Schoology's page settings, or
// { signedOut } on the sign-in page. Data is kept per signed-in person
// (storage.js), so the background must know before the panel shows any.
function pageUser() {
  const scripts = [...document.scripts].map((s) => s.textContent || '').join('\n');
  const uid = extractUserUid(scripts);
  if (uid) return { uid };
  const login = /\/login(\b|\?|#|$)/i.test(window.location.pathname) ||
    document.querySelector('form[id*="login" i], form[class*="login" i]') !== null;
  return login ? { signedOut: true } : {};
}

// Dashboard panel on the right edge of the page (top frame only). Whether it
// is open is shared by every Schoology tab (storage key panelOpen; open by
// default the first time). The panel is always on.
async function setupPanel() {
  if (window.top !== window) return;
  // This page's Schoology site: the panel shows that site's account, for
  // whoever is signed in on this page.
  setSite(window.location.origin);
  await browser.runtime
    .sendMessage({ type: 'page-user', url: window.location.href, ...pageUser() })
    .catch(() => {});
  const panel = mountPanel({
    document,
    browser,
    open: await storageGet('panelOpen', true),
    onOpenChange: (open) => storageSet('panelOpen', open).catch(() => {}),
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('panelOpen' in changes) panel.setOpen(changes.panelOpen.newValue !== false);
  });
}

// "Message the teacher" (teacher-email.js): on Schoology's compose form,
// fill in the empty Subject and Message from the link's hash, then drop the
// hash. Never presses Send: the family reviews the message and sends it.
function fillComposeForm() {
  const msg = readComposeHash(window.location.hash);
  if (!msg || !/\/messages\/new\//.test(window.location.pathname)) return;
  const tryFill = () => {
    const subject = document.querySelector('form input[name="subject"]');
    const body = document.querySelector('form textarea[name="body"]');
    if (!subject || !body) return false;
    if (!subject.value) {
      subject.value = msg.subject;
      subject.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!body.value) {
      body.value = msg.body;
      body.dispatchEvent(new Event('input', { bubbles: true }));
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    body.focus();
    return true;
  };
  if (tryFill()) return;
  const observer = new MutationObserver(() => { if (tryFill()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
}

// On a school address the family allowed (registered by background.js), do
// nothing unless the page really is Schoology: the browser's own site-access
// menu can allow the extension on any site.
function isSchoologyPage() {
  if (window.location.protocol !== 'https:') return true; // dev mock server
  return isSchoologySite(window.location.href) || looksLikeSchoology(document);
}

if (isSchoologyPage()) {
  fillComposeForm();
  init();
  setupPanel().catch((e) => console.warn('Schoology Dashboard panel failed:', e));
}
