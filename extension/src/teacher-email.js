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
// Message fields (content.js). The parent reads it, edits it, and presses
// Send themselves: nothing is ever sent for them. Parents only: students
// don't get the button.
//
// The link addresses every admin of the class, and a class can have
// several (a co-teacher, a case manager, a department admin on many
// classes). Schoology doesn't say which one teaches it, so when there are
// several the parent picks one (the last pick, or the likely teacher, is
// preselected) and the message goes to that one teacher only.

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

// The class's admins from its course page: [{ uid, name }] in the order
// the "Message Admins" link lists them. Names come from the admin pictures
// beside that link (<a href="/user/<uid>" title="<name>">); an admin
// without one gets ''.
export function findCourseAdmins(html) {
  const s = String(html || '');
  const href = findComposeHref(s);
  if (!href) return [];
  const m = href.match(/[?&]recipient_uids=([^&#]+)/);
  if (!m) return [];
  const uids = decodeURIComponent(m[1]).split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x));
  const names = {};
  for (const a of s.matchAll(/<a\b[^>]*href="\/user\/(\d+)"[^>]*title="([^"]+)"/gi)) {
    if (!names[a[1]] && !/^view user profile/i.test(a[2])) names[a[1]] = decodeEntities(a[2]).trim();
  }
  return [...new Set(uids)].map((uid) => ({ uid, name: names[uid] || '' }));
}

function decodeEntities(t) {
  return t.replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// The compose link addressed to one admin only.
export function composeUrlFor(url, uid) {
  return String(url).replace(/([?&]recipient_uids=)[^&#]*/, `$1${encodeURIComponent(uid)}`);
}

// likelyTeacher(admins, classCount) -> uid or null. classCount[uid] is how
// many of the family's classes list that admin. The admin on the fewest
// classes is likely the teacher (a case manager or department admin shows
// up on many); a tie means we can't tell.
export function likelyTeacher(admins, classCount = {}) {
  if (!admins || !admins.length) return null;
  if (admins.length === 1) return admins[0].uid;
  const n = (a) => classCount[a.uid] || 1;
  const sorted = [...admins].sort((a, b) => n(a) - n(b));
  return n(sorted[0]) < n(sorted[1]) ? sorted[0].uid : null;
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

// The pre-filled subject and message, from the parent about their child,
// signed with the parent's full name.
export function composeMessage({ studentName, parentName = '', title, courseName, dueText }) {
  const first = firstName(studentName);
  const due = dueText ? ` (due ${dueText})` : '';
  const inClass = courseName ? ` in ${courseName}` : '';
  const subject = `${title}${due} - marked missing`;
  const body = `Hello,\n\nSchoology shows "${title}"${due} as missing${inClass}. ` +
    `Could you let me know what ${first || 'my child'} needs to do to turn it in?\n\nSincerely,${parentName ? `\n${parentName}` : ''}`;
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
