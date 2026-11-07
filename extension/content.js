// content.js — runs on Schoology pages (document_idle + MutationObserver
// until the grades table is present). Scrapes the RENDERED DOM with the
// same parser core as the service worker (src/parser-core.js). MUST NOT
// modify the page — read-only. Sends results to the background service worker and
// reports the current page URL (for probe URL capture).

import browser from 'webextension-polyfill';
import { parseGradesRoot } from './src/parser-core.js';

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

function init() {
  reportUrl();
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

init();
