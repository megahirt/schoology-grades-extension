// teacher-email.js — "Email the teacher" for a Missing item (pure, no
// browser APIs).
//
// It uses Schoology's own messaging, never email addresses. Every course
// page has a "Message Admins" link to a compose form addressed to the
// class's teachers (verified live with a parent account):
//   <a href="/parent/messages/new/course/<courseId>?recipient_uids=<uid>"
//      class="enrollment-members-message">
// Schoology's form can't be pre-filled from the link, so the dashboard
// opens the link with the subject and message in the URL hash
// (#sgd-compose=…). The content script then fills in the empty Subject and
// Message fields (content.js). The parent or student reads it, edits it,
// and presses Send themselves: nothing is ever sent for them.

export const COMPOSE_HASH_KEY = 'sgd-compose';

// The course page that carries the "Message Admins" link. A parent sees
// a child's course through Schoology's preview link.
export function coursePagePath({ isParent, childUid, courseId }) {
  const cid = encodeURIComponent(courseId);
  return isParent
    ? `/course/${cid}/preview/${encodeURIComponent(childUid)}/parent?url=course/${cid}/materials`
    : `/course/${cid}/materials`;
}

// The compose link from a course page's HTML, or null.
export function findComposeHref(html) {
  const s = String(html || '');
  const tag = s.match(/<a\b[^>]*class="[^"]*\benrollment-members-message\b[^"]*"[^>]*>/i);
  const fromTag = tag && tag[0].match(/href="([^"]+)"/i);
  const any = s.match(/href="([^"]*\/messages\/new\/course\/\d+\?[^"]*recipient_uids=[^"]+)"/i);
  const href = (fromTag && fromTag[1]) || (any && any[1]);
  if (!href || !/\/messages\/new\//.test(href)) return null;
  return href.replace(/&amp;/g, '&');
}

// The signed-in parent's name, from the page data every Schoology page
// carries ("parentName":"…"), or ''.
export function findParentName(html) {
  const m = String(html || '').match(/"parentName"\s*:\s*"((?:[^"\\]|\\.){1,120})"/);
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]}"`).trim();
  } catch {
    return '';
  }
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// The pre-filled subject and message. Parents write about their child and
// sign with their full name; students write for themselves.
export function composeMessage({ isParent, studentName, parentName = '', title, courseName, dueText }) {
  const first = firstName(studentName);
  const due = dueText ? ` (due ${dueText})` : '';
  const inClass = courseName ? ` in ${courseName}` : '';
  const subject = `${title}${due} - marked missing`;
  const body = isParent
    ? `Hello,\n\nSchoology shows "${title}"${due} as missing${inClass}. ` +
      `Could you let me know what ${first || 'my child'} needs to do to turn it in?\n\nSincerely,${parentName ? `\n${parentName}` : ''}`
    : `Hello,\n\nSchoology shows "${title}"${due} as missing${inClass}. ` +
      `Could you let me know what I need to do to turn it in?\n\nThank you!${first ? `\n${first}` : ''}`;
  return { subject, body };
}

export function composeHash(msg) {
  return `#${COMPOSE_HASH_KEY}=${encodeURIComponent(JSON.stringify({ subject: msg.subject, body: msg.body }))}`;
}

// The { subject, body } carried in a compose page's hash, or null.
export function readComposeHash(hash) {
  const m = String(hash || '').match(new RegExp(`[#&]${COMPOSE_HASH_KEY}=([^&]*)`));
  if (!m) return null;
  try {
    const v = JSON.parse(decodeURIComponent(m[1]));
    if (!v || typeof v.subject !== 'string' || typeof v.body !== 'string') return null;
    return { subject: v.subject.slice(0, 300), body: v.body.slice(0, 5000) };
  } catch {
    return null;
  }
}
