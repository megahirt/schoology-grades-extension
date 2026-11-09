// rules.js — deterministic GO/NO-GO rules engine (pure JS, no browser APIs).
// The defaults below are DEFAULTS, not hard-coded for everyone:
// the setup wizard lets each family change the thresholds.

export const DEFAULT_SETTINGS = {
  gradeThreshold: 75,
  missingThreshold: 2,
  notSoGoodDays: 7,
  showGoNoGo: true,
  gradeVisibility: 'both',
  gradeDisplay: 'percent',
  doingWellPercent: 80, // "Doing well": graded B (80%) or higher ...
  doingWellDays: 10, //    ... from the past 10 days
};

// Settings that are no longer choices: always the defaults, whatever was
// saved before (Who sees grades, the Doing well / Not so good windows, and
// the GO/NO-GO badge).
const FIXED_SETTINGS = ['gradeVisibility', 'notSoGoodDays', 'doingWellDays', 'showGoNoGo'];
// Family rules are set by parents; a student's dashboard uses the defaults.
const PARENT_ONLY_SETTINGS = ['gradeThreshold', 'missingThreshold'];
// The settings sliders' ranges; a value saved outside one (older versions
// allowed 0-100, or up to 20 Missing items) is held to the nearest end, matching what the slider shows.
export const SETTING_RANGES = { gradeThreshold: [60, 80], missingThreshold: [1, 6], doingWellPercent: [75, 90] };

// effectiveSettings(stored, { isStudent }) -> the settings to use.
export function effectiveSettings(stored, { isStudent = false } = {}) {
  const out = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  for (const k of FIXED_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
  if (isStudent) for (const k of PARENT_ONLY_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
  for (const [k, [min, max]] of Object.entries(SETTING_RANGES)) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : DEFAULT_SETTINGS[k];
  }
  return out;
}

// A student's own dashboard: the account says so, or the only dashboard is
// the student's own ('self').
export function isStudentAccount(account, dashboards) {
  if (account && account.type === 'student') return true;
  if (account && account.type === 'parent') return false;
  const uids = Object.keys(dashboards || {});
  return uids.length === 1 && uids[0] === 'self';
}

function mergeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function normalizeTurnedInIds(turnedInIds) {
  if (!turnedInIds) return new Set();
  if (turnedInIds instanceof Set) return turnedInIds;
  if (Array.isArray(turnedInIds)) return new Set(turnedInIds.map(String));
  if (typeof turnedInIds === 'object') return new Set(Object.keys(turnedInIds));
  return new Set();
}

// Per-assignment percent (0-100) or null when not graded.
// score/maxPoints (e.g. 42/50) -> percent; a bare score with no max is
// already a percent.
export function assignmentPercent(a) {
  if (!a) return null;
  const score = typeof a.score === 'number' ? a.score : null;
  if (score === null || Number.isNaN(score)) return null;
  if (a.maxPoints === 0) return null; // extra credit (e.g. 2/0): no percent
  if (typeof a.maxPoints === 'number' && a.maxPoints > 0) {
    return (score / a.maxPoints) * 100;
  }
  return score;
}

// isExtraCredit(a): a score out of 0 points (e.g. 2/0). Schoology adds the
// points to the class total without adding to what's possible, so it is
// graded, has no percent, and is never below the passing grade.
export function isExtraCredit(a) {
  return Boolean(a) && a.maxPoints === 0 && typeof a.score === 'number' && !Number.isNaN(a.score);
}

// extraCreditPercent(a): how far a score goes over 100% (53/50 -> 6), or
// null when it doesn't. Teachers give extra credit either this way or as a
// score out of 0 points (isExtraCredit).
export function extraCreditPercent(a) {
  const pct = assignmentPercent(a);
  if (pct === null || !(typeof a.maxPoints === 'number' && a.maxPoints > 0)) return null;
  return pct > 100 + 1e-9 ? pct - 100 : null;
}

// extraCreditPoints(a): the extra points a score earns: what's over the
// maximum (53/50 -> 3), or all of a score out of 0 (2/0 -> 2). 0 otherwise.
export function extraCreditPoints(a) {
  if (isExtraCredit(a)) return Math.max(0, a.score);
  return extraCreditPercent(a) !== null ? a.score - a.maxPoints : 0;
}

// isBonus(a): any extra credit: points out of 0, or a score over 100%.
export function isBonus(a) {
  return (isExtraCredit(a) && a.score > 0) || extraCreditPercent(a) !== null;
}

// hasGradeData(course): true when the course has a course grade or at least
// one graded assignment (a score or a letter grade). Sections like advisory
// or house groups have none: they are not real classes, so the dashboard
// leaves them out of its class list. Their teacher-marked Missing items, if
// any, still count (summarizeStudent does not use this).
export function hasGradeData(course) {
  if (!course) return false;
  if (typeof course.grade === 'number' && !Number.isNaN(course.grade)) return true;
  return (course.assignments || []).some(
    (a) => assignmentPercent(a) !== null || isExtraCredit(a) || (a.status === 'graded' && Boolean(a.letterGrade)),
  );
}

export function computeVerdict({ missingCount = 0, lowestClassGrade = null, settings } = {}) {
  const s = mergeSettings(settings);
  const hasMissing = missingCount >= s.missingThreshold;
  const hasLow =
    lowestClassGrade !== null &&
    lowestClassGrade !== undefined &&
    !Number.isNaN(lowestClassGrade) &&
    lowestClassGrade < s.gradeThreshold; // the threshold itself passes
  if (hasMissing && hasLow) {
    return { verdict: 'NO-GO', reasons: ['NO-GO — Missing work + Low grades'] };
  }
  if (hasMissing) {
    return { verdict: 'NO-GO', reasons: ['NO-GO — Missing work'] };
  }
  if (hasLow) {
    return { verdict: 'NO-GO', reasons: ['NO-GO — Low grades'] };
  }
  return { verdict: 'GO', reasons: [] };
}

// When the current grading period began: the latest quarter (a period
// nested under a semester, not an exam) that has started, else the latest
// semester that has started. Null when the course lists no dated periods.
export function currentPeriodStart(course, now) {
  const periods = (course && course.periods) || [];
  const started = (list) => list
    .map((p) => Date.parse(p.start || ''))
    .filter((t) => !Number.isNaN(t) && t <= now.getTime())
    .sort((a, b) => b - a)[0];
  const quarter = started(periods.filter((p) => !p.topLevel && !/^\s*(final\s+)?exam\b/i.test(p.title || '')));
  if (quarter !== undefined) return new Date(quarter);
  const semester = started(periods.filter((p) => p.topLevel));
  return semester !== undefined ? new Date(semester) : null;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// summarizeStudent(courses, settings, turnedInIds?, doneIds?)
// courses: [{ id, name, grade (number|null, percent), assignments: [...] }]
// turnedInIds: optional Set/Array of ids of MISSING items the family marked
//   "turned in" (also accepted as settings.turnedInIds). While Schoology
//   still shows them Missing they wait on the teacher instead of counting as
//   Missing; once Schoology grades them or removes the Missing mark, the mark
//   no longer matters and they drop out of Waiting.
// doneIds: optional Set/Array of ids of not-yet-graded items (usually Due
//   soon) marked "done". They wait on the teacher until graded. If the
//   teacher marks one Missing it counts as Missing again: a "done" mark never
//   hides teacher-marked Missing work.
// Returns { missingCount, missingItems, lowestClassGrade, lowClasses,
//   dueToday, dueTomorrow, doingWell, notSoGood, waiting, verdict }.
// waiting items carry waitingReason: 'submitted' (Schoology shows a
// submission that isn't graded yet, whether or not it is marked Missing),
// 'turnedIn' or 'done' (marked by the family). Submitted work does not count
// as Missing.
export function summarizeStudent(courses, settings, turnedInIdsArg, doneIdsArg) {
  const s = mergeSettings(settings);
  const turnedIn = normalizeTurnedInIds(
    turnedInIdsArg !== undefined ? turnedInIdsArg : s.turnedInIds,
  );
  const done = normalizeTurnedInIds(doneIdsArg !== undefined ? doneIdsArg : s.doneIds);
  const now = s.now ? new Date(s.now) : new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterStart = new Date(todayStart);
  dayAfterStart.setDate(dayAfterStart.getDate() + 2);
  const notSoGoodCutoff = new Date(todayStart);
  notSoGoodCutoff.setDate(notSoGoodCutoff.getDate() - s.notSoGoodDays);
  const doingWellCutoff = new Date(todayStart);
  doingWellCutoff.setDate(doingWellCutoff.getDate() - s.doingWellDays);

  const list = Array.isArray(courses) ? courses : [];
  const missingItems = [];
  const dueToday = [];
  const dueTomorrow = [];
  const doingWell = [];
  const notSoGood = [];
  const waiting = [];
  let lowestClassGrade = null;
  const lowClasses = [];

  for (const course of list) {
    const g = typeof course.grade === 'number' && !Number.isNaN(course.grade) ? course.grade : null;
    if (g !== null) {
      if (lowestClassGrade === null || g < lowestClassGrade) lowestClassGrade = g;
      if (g < s.gradeThreshold) lowClasses.push({ id: course.id, name: course.name, grade: g });
    }
    // Work from an earlier grading period can no longer be turned in, so
    // Missing work due before the current quarter began is left out
    // (submitted work still waits on the teacher).
    const periodStart = currentPeriodStart(course, now);
    for (const a of course.assignments || []) {
      const item = { ...a, courseId: course.id, courseName: course.name };
      const idKey = a.id !== undefined && a.id !== null ? String(a.id) : null;
      const dueAt = a.due ? new Date(a.due) : null;
      const pastPeriod = periodStart && dueAt && !Number.isNaN(dueAt.getTime()) && dueAt < periodStart;
      if (a.status === 'missing' && pastPeriod && a.submitted !== true) continue;
      if (a.status === 'missing') {
        if (a.submitted === true) {
          // Schoology shows a submission: the work is in, the teacher just
          // hasn't graded it (or cleared the Missing mark) yet.
          waiting.push({ ...item, waitingReason: 'submitted' });
        } else if (idKey !== null && turnedIn.has(idKey)) {
          // Turned in, Schoology still says Missing: waiting on the teacher.
          waiting.push({ ...item, waitingReason: 'turnedIn' });
        } else {
          // Missing items always stay in Missing, whatever their due date,
          // even when marked "done" (the teacher's Missing mark wins).
          missingItems.push(item);
        }
        continue;
      }
      const pct = assignmentPercent(a);
      // Letter/scale grades (e.g. "A") carry no number: they still count as
      // graded. Only D/F letters count as below the threshold.
      const letter = pct === null && a.status === 'graded' && a.letterGrade ? String(a.letterGrade) : null;
      const extra = isExtraCredit(a);
      const graded = pct !== null || letter !== null || extra;
      const due = a.due ? new Date(a.due) : null;
      const dueValid = due && !Number.isNaN(due.getTime());
      if (graded) {
        // Graded items leave Waiting on their own, whatever was marked.
        const below = pct !== null ? pct < s.gradeThreshold : letter !== null && /^[DF]/i.test(letter);
        if (below) {
          // "Not so good": graded below threshold from the past
          // notSoGoodDays days only (by the date shown on the row).
          if (!dueValid || (due >= notSoGoodCutoff && due <= now)) {
            notSoGood.push(item);
          }
        } else {
          // "Doing well": B or higher (doingWellPercent; letters A/B) from
          // the past doingWellDays days, by the date shown on the row.
          // Extra credit (points out of 0) always counts as doing well.
          const good = pct !== null ? pct >= s.doingWellPercent : (letter !== null && /^[AB]/i.test(letter)) || (extra && a.score > 0);
          if (good && dueValid && due >= doingWellCutoff && due <= now) doingWell.push(item);
        }
        continue;
      }
      if (a.submitted === true) {
        // Submitted, not graded yet: waiting on the teacher, not Due soon.
        waiting.push({ ...item, waitingReason: 'submitted' });
        continue;
      }
      if (idKey !== null && done.has(idKey)) {
        // Marked done, not graded yet: waiting on the teacher.
        waiting.push({ ...item, waitingReason: 'done' });
        continue;
      }
      // Ungraded + not Missing = in-between / OK, not counted as Missing.
      // Due soon = outstanding items due today / tomorrow.
      // Past due date AND time with no grade and not Missing disappears
      // entirely (not in Due soon, not in Awaiting teacher).
      if (!dueValid) continue;
      const dueEnd = a.due && /T/.test(String(a.due)) ? due : endOfDay(due);
      if (dueEnd < now) continue; // past due: disappears
      if (due >= todayStart && due < tomorrowStart) dueToday.push(item);
      else if (due >= tomorrowStart && due < dayAfterStart) dueTomorrow.push(item);
    }
  }

  const missingCount = missingItems.length;
  const verdict = computeVerdict({ missingCount, lowestClassGrade, settings: s });
  return {
    missingCount,
    missingItems,
    lowestClassGrade,
    lowClasses,
    dueToday,
    dueTomorrow,
    doingWell,
    notSoGood,
    waiting,
    verdict,
  };
}
