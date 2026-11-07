// content.js — runs on Schoology pages (document_idle + MutationObserver
// until the grades table is present). Scrapes the RENDERED DOM with the
// same multi-signal Missing detection as src/parser.js. MUST NOT modify the
// page — read-only. Sends results to the background service worker and
// reports the current page URL (for probe URL capture).

import browser from 'webextension-polyfill';

function textOf(el) {
  return el ? (el.textContent || '').trim() : '';
}

// Multi-signal Missing detection, same order as src/parser.js:
// (1) title/aria-label containing "missing"; (2) class containing "missing";
// (3) cell text exactly "Missing". NEVER infer Missing from a 0.
function exceptionFromCell(gradeCell) {
  if (!gradeCell) return null;
  const labelled = gradeCell.querySelectorAll('[title], [aria-label]');
  for (const el of labelled) {
    const label = `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    if (label.includes('missing')) return 'missing';
    if (label.includes('incomplete')) return 'incomplete';
    if (label.includes('excused')) return 'excused';
  }
  const selfLabel = `${gradeCell.getAttribute('title') || ''} ${gradeCell.getAttribute('aria-label') || ''}`.toLowerCase();
  if (selfLabel.includes('missing')) return 'missing';
  if (selfLabel.includes('incomplete')) return 'incomplete';
  if (selfLabel.includes('excused')) return 'excused';
  const classText = [gradeCell.className || '']
    .concat([...gradeCell.querySelectorAll('*')].map((el) => el.className || ''))
    .join(' ')
    .toLowerCase();
  if (classText.includes('missing')) return 'missing';
  if (classText.includes('incomplete')) return 'incomplete';
  if (classText.includes('excused')) return 'excused';
  const cellText = textOf(gradeCell);
  if (cellText === 'Missing') return 'missing';
  if (cellText === 'Incomplete') return 'incomplete';
  if (cellText === 'Excused') return 'excused';
  return null;
}

function parseScore(raw) {
  if (raw === null || raw === undefined) return { score: null, maxPoints: null };
  const t = String(raw).trim();
  if (!t || t === '—' || t === '–' || t === '-') return { score: null, maxPoints: null };
  const frac = t.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return { score: Number(frac[1]), maxPoints: Number(frac[2]) };
  const num = t.match(/-?\d+(?:\.\d+)?/);
  if (num) return { score: Number(num[0]), maxPoints: null };
  return { score: null, maxPoints: null };
}

function scrapeGrades() {
  const courses = [];
  // Primary: fixture-modelled course sections.
  const sections = document.querySelectorAll('section.course-grades, .course-grades');
  sections.forEach((section) => {
    const course = scrapeCourse(section);
    if (course) courses.push(course);
  });
  if (courses.length > 0) return courses;
  // Fallback: a bare grades table (single-course page).
  const tables = document.querySelectorAll('table.grades-table');
  if (tables.length > 0) {
    const gradeEl = document.querySelector('.course-grade');
    const gradeMatch = gradeEl ? textOf(gradeEl).match(/(-?\d+(?:\.\d+)?)\s*%/) : null;
    const course = {
      id: null,
      name: textOf(document.querySelector('.course-name')),
      grade: gradeMatch ? Number(gradeMatch[1]) : null,
      assignments: [],
    };
    document.querySelectorAll('tr.assignment-row').forEach((row) => {
      const a = scrapeRow(row);
      if (a) course.assignments.push(a);
    });
    if (course.assignments.length > 0) courses.push(course);
  }
  return courses;
}

function scrapeCourse(section) {
  const nameEl = section.querySelector('.course-name');
  const name = section.getAttribute('data-course-name') || textOf(nameEl) || '';
  const id = section.getAttribute('data-course-id') || null;
  const gradeEl = section.querySelector('.course-grade');
  const gradeMatch = gradeEl ? textOf(gradeEl).match(/(-?\d+(?:\.\d+)?)\s*%/) : null;
  const assignments = [];
  section.querySelectorAll('tr.assignment-row').forEach((row) => {
    const a = scrapeRow(row);
    if (a) assignments.push(a);
  });
  if (!name && assignments.length === 0) return null;
  return { id, name, grade: gradeMatch ? Number(gradeMatch[1]) : null, assignments };
}

function scrapeRow(row) {
  const title = textOf(row.querySelector('.assignment-title'));
  if (!title) return null;
  const dueEl = row.querySelector('.assignment-due');
  const dueText = textOf(dueEl);
  let due = null;
  if (dueEl) {
    const dataDue = dueEl.getAttribute('data-due');
    if (dataDue) {
      const d = new Date(dataDue);
      if (!Number.isNaN(d.getTime())) due = d.toISOString();
    }
  }
  const gradeCell = row.querySelector('.assignment-grade');
  const scoreEl = gradeCell ? gradeCell.querySelector('.grade-score') : null;
  const { score, maxPoints } = parseScore(scoreEl ? textOf(scoreEl) : null);
  const exception = exceptionFromCell(gradeCell);
  let status;
  if (exception === 'missing') status = 'missing';
  else if (exception === 'incomplete') status = 'incomplete';
  else if (exception === 'excused') status = 'excused';
  else if (score !== null) status = 'graded';
  else if (due) status = new Date(due) < new Date() ? 'overdue' : 'pending';
  else status = 'pending';
  return {
    id: row.getAttribute('data-assignment-id') || null,
    title,
    due,
    dueText,
    score,
    maxPoints,
    status,
    sourceUrl: window.location.href,
  };
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
  const observer = new MutationObserver(() => {
    if (sendScrape()) observer.disconnect();
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
