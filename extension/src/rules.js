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
};

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
  if (typeof a.maxPoints === 'number' && a.maxPoints > 0) {
    return (score / a.maxPoints) * 100;
  }
  return score;
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

// summarizeStudent(courses, settings, turnedInIds?)
// courses: [{ id, name, grade (number|null, percent), assignments: [...] }]
// turnedInIds: optional Set/Array of assignment ids manually marked turned in
//   (also accepted as settings.turnedInIds). Those items do NOT count as Missing.
// Returns { missingCount, missingItems, lowestClassGrade, lowClasses,
//   dueToday, dueTomorrow, doingWell, notSoGood, verdict }.
export function summarizeStudent(courses, settings, turnedInIdsArg) {
  const s = mergeSettings(settings);
  const turnedIn = normalizeTurnedInIds(
    turnedInIdsArg !== undefined ? turnedInIdsArg : s.turnedInIds,
  );
  const now = s.now ? new Date(s.now) : new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterStart = new Date(todayStart);
  dayAfterStart.setDate(dayAfterStart.getDate() + 2);
  const notSoGoodCutoff = new Date(todayStart);
  notSoGoodCutoff.setDate(notSoGoodCutoff.getDate() - s.notSoGoodDays);

  const list = Array.isArray(courses) ? courses : [];
  const missingItems = [];
  const dueToday = [];
  const dueTomorrow = [];
  const doingWell = [];
  const notSoGood = [];
  let lowestClassGrade = null;
  const lowClasses = [];

  for (const course of list) {
    const g = typeof course.grade === 'number' && !Number.isNaN(course.grade) ? course.grade : null;
    if (g !== null) {
      if (lowestClassGrade === null || g < lowestClassGrade) lowestClassGrade = g;
      if (g < s.gradeThreshold) lowClasses.push({ id: course.id, name: course.name, grade: g });
    }
    for (const a of course.assignments || []) {
      const item = { ...a, courseId: course.id, courseName: course.name };
      const idKey = a.id !== undefined && a.id !== null ? String(a.id) : null;
      const isTurnedIn = idKey !== null && turnedIn.has(idKey);
      const isMissing = a.status === 'missing' && !isTurnedIn;
      if (isMissing) {
        // Missing items always stay in Missing, whatever their due date.
        missingItems.push(item);
        continue;
      }
      if (isTurnedIn) {
        // Manually marked turned in: awaiting the teacher, not Missing,
        // not due, not graded. Handled by the popup's Awaiting section.
        continue;
      }
      const pct = assignmentPercent(a);
      // Letter/scale grades (e.g. "A") carry no number: they still count as
      // graded. Only D/F letters count as below the threshold.
      const letter = pct === null && a.status === 'graded' && a.letterGrade ? String(a.letterGrade) : null;
      const graded = pct !== null || letter !== null;
      const due = a.due ? new Date(a.due) : null;
      const dueValid = due && !Number.isNaN(due.getTime());
      if (graded) {
        const below = pct !== null ? pct < s.gradeThreshold : /^[DF]/i.test(letter);
        if (below) {
          // "Not so good": graded below threshold from the past
          // notSoGoodDays days only (by the date shown on the row).
          if (!dueValid || (due >= notSoGoodCutoff && due <= now)) {
            notSoGood.push(item);
          }
        } else {
          doingWell.push(item);
        }
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
    verdict,
  };
}
