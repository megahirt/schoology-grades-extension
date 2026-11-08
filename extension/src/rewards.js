// rewards.js — the encouraging numbers on the dashboard (pure, no browser
// APIs):
//   - quarterChange: "▲ 6% vs Q1" when a class's quarter grade is up on the
//     previous quarter (ups only; a drop shows nothing).
//   - weekProgress: this week's ring: of everything due Monday to Sunday,
//     how much is graded and how much is turned in waiting for a grade.
//   - computeRecords / mergeRecords: personal bests this school year. They
//     are saved (storage key `records`) and only ever go up, so a rough week
//     or a teacher changing an old grade never takes one away.

import { assignmentPercent } from './rules.js';
import { cleanCourseNames } from './names.js';

const DAY = 24 * 60 * 60 * 1000;
const NEW_FOR_MS = 7 * DAY;
const EXAM = /^\s*(final\s+)?exam\b/i;

function periodName(title) {
  return String(title || '').replace(/:.*$/, '').trim();
}

// "Quarter 1" -> "Q1"; anything else keeps its name.
function shortName(title) {
  const name = periodName(title);
  const m = name.match(/^quarter\s*(\d+)$/i);
  return m ? `Q${m[1]}` : name;
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Monday 00:00 of the week containing t (local time).
export function weekStart(t) {
  const d = new Date(startOfDay(t));
  const back = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - back);
  return d.getTime();
}

function quarters(course) {
  return (course.periods || []).filter((p) => !p.topLevel && !EXAM.test(p.title || ''));
}

// quarterChange(course) -> { delta, prevGrade, prevShort, prevTitle } or null.
// The current quarter is the one the quarter grade came from (gradeSource);
// the previous one is the latest earlier quarter that has a grade.
export function quarterChange(course) {
  if (!course || typeof course.quarterGrade !== 'number') return null;
  const qs = quarters(course);
  const cur = qs.find((p) => p.title === course.gradeSource);
  if (!cur || !cur.start) return null;
  const curStart = Date.parse(cur.start);
  const prev = qs
    .filter((p) => typeof p.grade === 'number' && p.start && Date.parse(p.start) < curStart)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
  if (!prev) return null;
  const delta = Math.round(course.quarterGrade - prev.grade);
  if (delta < 1) return null;
  return { delta, prevGrade: prev.grade, prevShort: shortName(prev.title), prevTitle: periodName(prev.title) };
}

function isGraded(a) {
  return a.status === 'graded';
}

// weekProgress(courses, { turnedIn, done }, now) -> { total, graded, submitted }
// total: everything due this week (Monday to Sunday), excused work left out.
// graded: has a grade. submitted: turned in on Schoology (or marked turned
// in / done by the family) and not graded yet.
export function weekProgress(courses, marks = {}, now = Date.now()) {
  const from = weekStart(now);
  const to = from + 7 * DAY;
  const turnedIn = new Set((marks.turnedIn || []).map(String));
  const done = new Set((marks.done || []).map(String));
  let total = 0;
  let graded = 0;
  let submitted = 0;
  for (const c of courses || []) {
    for (const a of c.assignments || []) {
      if (a.status === 'excused') continue;
      const t = Date.parse(a.due || '');
      if (Number.isNaN(t) || t < from || t >= to) continue;
      total += 1;
      const id = a.id !== undefined && a.id !== null ? String(a.id) : null;
      if (isGraded(a)) graded += 1;
      else if (a.submitted === true || (id !== null && (turnedIn.has(id) || done.has(id)))) submitted += 1;
    }
  }
  return { total, graded, submitted };
}

// The first day of the school year: the earliest grading period start, or
// the earliest due date when no period has dates.
function schoolStart(courses, now) {
  const starts = [];
  for (const c of courses) {
    for (const p of c.periods || []) {
      const t = Date.parse(p.start || '');
      if (!Number.isNaN(t) && t <= now) starts.push(t);
    }
  }
  if (starts.length) return startOfDay(Math.min(...starts));
  const dues = courses.flatMap((c) => (c.assignments || []).map((a) => Date.parse(a.due || ''))).filter((t) => !Number.isNaN(t) && t <= now);
  return dues.length ? startOfDay(Math.min(...dues)) : null;
}

// computeRecords(courses, now) -> this school year's bests from today's data:
// { highestScore, bestWeek, cleanRun, classGrade }, each { value, key, info }
// or absent. `key` names the event, so a record that is beaten by a different
// event can be marked NEW.
export function computeRecords(courses, now = Date.now()) {
  const list = courses || [];
  const out = {};

  // Highest score on a graded assignment (the earliest one wins a tie).
  let best = null;
  for (const c of list) {
    for (const a of c.assignments || []) {
      if (!isGraded(a)) continue;
      const pct = assignmentPercent(a);
      const t = Date.parse(a.due || '');
      if (pct === null || Number.isNaN(t) || t > now) continue;
      if (!best || pct > best.pct + 1e-9 || (Math.abs(pct - best.pct) < 1e-9 && t < best.t)) best = { pct, t, a, c };
    }
  }
  if (best) {
    out.highestScore = {
      value: Math.round(best.pct * 10) / 10,
      key: `${best.c.id}:${best.a.id ?? best.a.title}`,
      info: { title: best.a.title, course: best.c.name, date: new Date(best.t).toISOString(), url: best.a.url || null },
    };
  }

  // Best week: the most assignments in one week with everything in (graded
  // or submitted) and nothing marked Missing. Only work due by now counts.
  const weeks = new Map(); // weekStart -> { count, missing }
  for (const c of list) {
    for (const a of c.assignments || []) {
      if (a.status === 'excused') continue;
      const t = Date.parse(a.due || '');
      if (Number.isNaN(t) || t > now) continue;
      const w = weekStart(t);
      const rec = weeks.get(w) || { count: 0, missing: false };
      if (a.status === 'missing' && a.submitted !== true) rec.missing = true;
      else if (isGraded(a) || a.submitted === true) rec.count += 1;
      weeks.set(w, rec);
    }
  }
  let bestWeek = null;
  for (const [w, rec] of weeks) {
    if (rec.missing || rec.count < 1) continue;
    if (!bestWeek || rec.count > bestWeek.count || (rec.count === bestWeek.count && w < bestWeek.w)) bestWeek = { w, count: rec.count };
  }
  if (bestWeek) {
    out.bestWeek = { value: bestWeek.count, key: String(bestWeek.w), info: { start: new Date(bestWeek.w).toISOString() } };
  }

  // Longest run of days with nothing marked Missing, from the first day of
  // school to today.
  const start = schoolStart(list, now);
  if (start !== null) {
    const today = startOfDay(now);
    const missingDays = [...new Set(list.flatMap((c) => (c.assignments || [])
      .filter((a) => a.status === 'missing' && a.submitted !== true)
      .map((a) => Date.parse(a.due || ''))
      .filter((t) => !Number.isNaN(t) && t <= now)
      .map((t) => startOfDay(t))))].sort((a, b) => a - b);
    let run = null;
    let from = start;
    const consider = (a, b, ongoing) => {
      const days = Math.round((b - a) / DAY) + 1;
      if (days >= 1 && (!run || days > run.days)) run = { a, b, days, ongoing };
    };
    for (const m of missingDays) {
      if (m >= from) consider(from, m - DAY, false);
      from = Math.max(from, m + DAY);
    }
    if (from <= today) consider(from, today, true);
    if (run && run.days >= 3) {
      out.cleanRun = {
        value: run.days,
        key: String(run.a),
        info: { start: new Date(run.a).toISOString(), end: new Date(run.b).toISOString(), ongoing: run.ongoing },
      };
    }
  }

  // Highest class grade in any quarter (or semester, for classes without
  // quarters), the current one included.
  let bestGrade = null;
  for (const c of list) {
    const qs = quarters(c).filter((p) => typeof p.grade === 'number');
    const pool = qs.length ? qs : (c.periods || []).filter((p) => p.topLevel && typeof p.grade === 'number');
    for (const p of pool) {
      if (p.start && Date.parse(p.start) > now) continue;
      if (!bestGrade || p.grade > bestGrade.grade) bestGrade = { grade: p.grade, c, p };
    }
  }
  if (bestGrade) {
    out.classGrade = {
      value: Math.round(bestGrade.grade * 10) / 10,
      key: `${bestGrade.c.id}:${bestGrade.p.id}`,
      info: { course: bestGrade.c.name, period: periodName(bestGrade.p.title) },
    };
  }
  return out;
}

// mergeRecords(stored, computed, now) -> the saved records, only ever going
// up. Each saved record is { value, key, info, newAt }: newAt is when a
// different event beat the previous best (shown as NEW for a week). The
// same event refreshing its facts (an ongoing run growing) keeps newAt.
export function mergeRecords(stored, computed, now = Date.now()) {
  const out = { ...(stored || {}) };
  for (const [name, rec] of Object.entries(computed || {})) {
    const old = out[name];
    if (!old) {
      out[name] = { ...rec, newAt: null };
    } else if (rec.key === old.key) {
      out[name] = { ...rec, value: Math.max(rec.value, old.value), newAt: old.newAt ?? null };
    } else if (rec.value > old.value) {
      out[name] = { ...rec, newAt: new Date(now).toISOString() };
    }
  }
  return out;
}

export function isNewRecord(rec, now = Date.now()) {
  if (!rec || !rec.newAt) return false;
  const t = Date.parse(rec.newAt);
  return !Number.isNaN(t) && now - t < NEW_FOR_MS;
}

// mergeAllRecords(allStored, dashboards, now): update every child's saved
// records from freshly stored dashboards ({ [uid]: dashboard }). Children
// whose dashboard failed or only partly loaded keep what they had.
export function mergeAllRecords(allStored, dashboards, now = Date.now()) {
  const out = { ...(allStored || {}) };
  for (const [uid, d] of Object.entries(dashboards || {})) {
    if (!d || d.error || !Array.isArray(d.courses) || !d.courses.length) continue;
    // Only part of the grades loaded: a missing row could fake a record.
    const partial = Array.isArray(d.parseWarnings) && d.parseWarnings.some((w) => /could not be read|did not parse/i.test(String(w)));
    if (partial) continue;
    out[uid] = mergeRecords(out[uid], computeRecords(cleanCourseNames(d.courses), now), now);
  }
  return out;
}
