// parser.js — parse Schoology Grades HTML from a string (service worker,
// unit tests). The service worker has no DOMParser, so the HTML is parsed
// with node-html-parser and handed to the DOM-agnostic core in
// parser-core.js — the same code the content script runs on the live DOM.
//
// See parser-core.js for the verified live markup and the Missing rule.

import { parse } from 'node-html-parser';
import { parseGradesRoot } from './parser-core.js';

export { parseSchoologyDate, visibleText } from './parser-core.js';

// parseGradesHtml(html, { courseId, courseName, sourceUrl, baseUrl, now } = {})
// -> { courses: [{ id, name, sectionTitle, grade, gradeSource, periods, assignments, url }], parseWarnings }
// or, on self-check failure, { courses: [], parseWarnings, error: 'PARSE_EMPTY' }.
export function parseGradesHtml(html, options = {}) {
  const raw = typeof html === 'string' ? html : '';
  if (!raw.trim()) {
    return { courses: [], parseWarnings: ['Empty HTML supplied to parser'] };
  }
  const root = parse(raw, { blockTextElements: { script: false, style: false, noscript: false } });
  return parseGradesRoot(root, options);
}
