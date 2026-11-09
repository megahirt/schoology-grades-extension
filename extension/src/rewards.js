// rewards.js — the encouraging numbers on the dashboard (pure, no browser
// APIs):
//   - quarterChange: "▲ 6% vs Q1" when a class's quarter grade is up on the
//     previous quarter (ups only; a drop shows nothing).
//   - weekProgress: this week's ring: of everything due Monday to Sunday,
//     how much is graded and how much is turned in waiting for a grade.
//   - classHighScore: a class's highest-scoring assignment so far (shown
//     under that class's grade chart).
//   - extra credit (in computeRecords): this school year's extra points,
//     added up across classes (53/50 is 3 points; 2/0 is 2).
//   - computeRecords / mergeRecords: personal bests this school year. They
//     are saved (storage key `records`) and only ever go up, so a rough week
//     or a teacher changing an old grade never takes one away. The
//     nothing-missing run comes from the daily log (daily-log.js).

import { assignmentPercent, extraCreditPoints } from './rules.js';
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
// graded: has a grade. submitted: not graded yet but counted as turned in,
// matching the rest of the dashboard, where work only counts as Missing when
// the teacher marks it Missing: past-due work without a Missing mark,
// Missing work with a submission, and work the family marked turned in or
// done. Parents can't see submissions on Schoology's grades page, so this is
// the same assumption the Missing count makes.
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
      const marked = id !== null && (turnedIn.has(id) || done.has(id));
      const pastDueNotMissing = t <= now && a.status !== 'missing' && a.status !== 'incomplete';
      if (isGraded(a)) graded += 1;
      else if (a.submitted === true || marked || pastDueNotMissing) submitted += 1;
    }
  }
  return { total, graded, submitted };
}

// classHighScore(course, now) -> { a, pct } for the class's highest-scoring
// graded assignment so far, or null. A tie goes to the one worth the most
// points (a perfect test beats a perfect 5-point check-in), then the
// earliest. Extra credit (no percent) and future work don't count.
export function classHighScore(course, now = Date.now()) {
  let best = null;
  for (const a of (course && course.assignments) || []) {
    if (!isGraded(a)) continue;
    const pct = assignmentPercent(a);
    const t = Date.parse(a.due || '');
    if (pct === null || Number.isNaN(t) || t > now) continue;
    const pts = typeof a.maxPoints === 'number' ? a.maxPoints : 0;
    const tie = best && Math.abs(pct - best.pct) < 1e-9;
    if (!best || pct > best.pct + 1e-9 || (tie && (pts > best.pts || (pts === best.pts && t < best.t)))) best = { a, pct, t, pts };
  }
  return best ? { a: best.a, pct: best.pct } : null;
}

// computeRecords(courses, now) -> this school year's bests from today's data:
// { bestWeek, classGrade, extraCredit }, each { value, key, info } or absent. `key` names
// the event, so a record that is beaten by a different event can be marked
// NEW. (Each class's highest score is shown with that class: classHighScore.)
export function computeRecords(courses, now = Date.now()) {
  const list = courses || [];
  const out = {};

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
  // Extra credit this school year, in points, added up across classes: a
  // score over the maximum counts what's over (53/50 is 3 points), a score
  // out of 0 counts all of it. The key counts the items, so each new piece
  // of extra credit is NEW.
  let extraPts = 0;
  let items = 0;
  const classes = new Set();
  for (const c of list) {
    for (const a of c.assignments || []) {
      if (a.status !== 'graded') continue;
      const t = Date.parse(a.due || '');
      if (!Number.isNaN(t) && t > now) continue;
      const pts = extraCreditPoints(a);
      if (!pts) continue;
      extraPts += pts;
      items += 1;
      classes.add(c.id ?? c.name);
    }
  }
  if (items) {
    out.extraCredit = {
      value: Math.round(extraPts * 100) / 100,
      key: `ec:${items}`,
      info: { classes: classes.size, items },
    };
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

// Longest run with nothing missing, from the daily log (daily-log.js)
// only: Schoology drops the Missing mark once work is turned in, so today's
// grades can't say what was missing on past days. A run is consecutive
// logged days with nothing teacher-marked Missing; gaps of up to
// MAX_GAP_DAYS between logged days (weekends, a few days without opening
// Schoology) are bridged, longer gaps end the run. Needs at least
// MIN_RUN_DAYS of history, so nothing shows until the log backs it up.
// days = { 'YYYY-MM-DD': entry }.
const MAX_GAP_DAYS = 3;
const MIN_RUN_DAYS = 3;
function dayTime(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
export function cleanRunFromLog(days, now = Date.now()) {
  const keys = Object.keys(days || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  let best = null;
  let run = null;
  let prev = null;
  for (const k of keys) {
    const e = days[k] || {};
    const t = dayTime(k);
    const clean = typeof e.teacherMissing === 'number' && e.teacherMissing === 0;
    const gapOk = prev !== null && Math.round((t - prev) / DAY) <= MAX_GAP_DAYS + 1;
    if (!clean) run = null;
    else if (run && gapOk) run.end = t;
    else run = { start: t, end: t };
    if (run) {
      const len = Math.round((run.end - run.start) / DAY) + 1;
      if (!best || len > best.days) best = { ...run, days: len };
    }
    prev = t;
  }
  if (!best || best.days < MIN_RUN_DAYS) return null;
  const today = startOfDay(now);
  const ongoing = run !== null && run.start === best.start && today - best.end <= DAY;
  return {
    value: best.days,
    key: String(best.start),
    source: 'log',
    info: { start: new Date(best.start).toISOString(), end: new Date(best.end).toISOString(), ongoing },
  };
}

// mergeAllRecords(allStored, dashboards, now, dailyLog): update every child's saved
// records from freshly stored dashboards ({ [uid]: dashboard }). Children
// whose dashboard failed or only partly loaded keep what they had.
export function mergeAllRecords(allStored, dashboards, now = Date.now(), dailyLog = {}) {
  const out = { ...(allStored || {}) };
  // An earlier version worked the run out from today's grades, which can't
  // know past Missing work: drop those.
  for (const uid of Object.keys(out)) {
    if (out[uid] && out[uid].cleanRun && out[uid].cleanRun.source !== 'log') {
      const { cleanRun, ...rest } = out[uid];
      out[uid] = rest;
    }
  }
  for (const [uid, d] of Object.entries(dashboards || {})) {
    if (!d || d.error || !Array.isArray(d.courses) || !d.courses.length) continue;
    // Only part of the grades loaded: a missing row could fake a record.
    const partial = Array.isArray(d.parseWarnings) && d.parseWarnings.some((w) => /could not be read|did not parse/i.test(String(w)));
    if (partial) continue;
    const computed = computeRecords(cleanCourseNames(d.courses), now);
    const run = cleanRunFromLog((dailyLog || {})[uid], now);
    if (run) computed.cleanRun = run;
    out[uid] = mergeRecords(out[uid], computed, now);
  }
  return out;
}
