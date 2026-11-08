// daily-log.js — one small entry per child per day (pure, no browser APIs).
//
// The saved dashboards only hold the latest grades: each refresh replaces
// them. The daily log keeps what the dashboard showed each day, so trends
// can be drawn later (Missing count over time, week-over-week, streaks,
// class grades as Schoology reported them). It is saved in this browser
// only, under the storage key `dailyLog`, and Clear data removes it.
//
// dailyLog = { [uid]: { [YYYY-MM-DD]: entry } } (local dates). The last
// refresh of a day replaces that day's entry, so each day holds its latest
// state. Entries older than KEEP_DAYS are dropped.
//
// entry = {
//   v: 1, at: ISO time of the refresh,
//   verdict: 'GO' | 'NO-GO' (with the family rules in force that day),
//   missing:        Missing count as the dashboard showed it (the family's
//                   turned-in marks taken out),
//   teacherMissing: teacher-marked Missing with no submission, as Schoology
//                   shows it (current grading period),
//   dueSoon: { today, tomorrow },
//   waiting: { submitted, turnedIn, done },
//   notSoGood, doingWell: counts in their windows,
//   lowClasses: classes below the passing grade,
//   week: { total, graded, submitted } (this week's ring),
//   classes: [{ id, name, quarter, overall, grade, label }]
// }

import { summarizeStudent, hasGradeData } from './rules.js';
import { weekProgress } from './rewards.js';
import { cleanCourseNames } from './names.js';

export const LOG_VERSION = 1;
export const KEEP_DAYS = 800; // a bit over two school years

export function dayKey(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function isPartial(d) {
  return Array.isArray(d && d.parseWarnings)
    && d.parseWarnings.some((w) => /could not be read|did not parse/i.test(String(w)));
}

// buildEntry(dashboard, settings, { turnedIn, done }, now) -> entry or null
// (null when the dashboard failed or only partly loaded).
export function buildEntry(d, settings, marks = {}, now = Date.now()) {
  if (!d || d.error || isPartial(d) || !Array.isArray(d.courses) || !d.courses.length) return null;
  const courses = cleanCourseNames(d.courses);
  const turnedIn = marks.turnedIn || [];
  const done = marks.done || [];
  const s = summarizeStudent(courses, { ...(settings || {}), now }, turnedIn, done);
  const waiting = { submitted: 0, turnedIn: 0, done: 0 };
  for (const a of s.waiting) if (a.waitingReason in waiting) waiting[a.waitingReason] += 1;
  return {
    v: LOG_VERSION,
    at: new Date(now).toISOString(),
    verdict: s.verdict.verdict,
    missing: s.missingCount,
    teacherMissing: s.missingCount + waiting.turnedIn,
    dueSoon: { today: s.dueToday.length, tomorrow: s.dueTomorrow.length },
    waiting,
    notSoGood: s.notSoGood.length,
    doingWell: s.doingWell.length,
    lowClasses: s.lowClasses.length,
    week: weekProgress(courses, { turnedIn, done }, now),
    classes: courses.filter((c) => hasGradeData(c)).map((c) => ({
      id: c.id ?? null,
      name: c.name || '',
      quarter: num(c.quarterGrade),
      overall: num(c.overallGrade),
      grade: num(c.grade),
      label: c.gradeLabel || null,
    })),
  };
}

// mergeDailyLog(log, dashboards, { settings, turnedIn, done }, now) -> the
// log with today's entry set for every child that loaded, and old days
// dropped. turnedIn/done are the { [uid]: [ids] } mark stores.
export function mergeDailyLog(log, dashboards, ctx = {}, now = Date.now()) {
  const out = { ...(log || {}) };
  const today = dayKey(now);
  const oldest = dayKey(now - KEEP_DAYS * 24 * 60 * 60 * 1000);
  for (const [uid, d] of Object.entries(dashboards || {})) {
    const entry = buildEntry(d, ctx.settings, {
      turnedIn: (ctx.turnedIn || {})[uid] || [],
      done: (ctx.done || {})[uid] || [],
    }, now);
    if (!entry) continue;
    const days = { ...(out[uid] || {}), [today]: entry };
    for (const k of Object.keys(days)) if (k < oldest) delete days[k];
    out[uid] = days;
  }
  return out;
}
