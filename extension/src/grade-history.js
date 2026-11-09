// grade-history.js — a class's grade over time, for the grade chart
// (pure, no browser APIs).
//
// Schoology publishes only today's grades, so the line is rebuilt from the
// graded assignments the grades page shows, the way Schoology computes a
// period grade:
//   - each grading period (Quarter 1, Quarter 2, …) starts fresh;
//   - points-based classes: points earned so far / points possible so far;
//   - weighted classes (a category shows "(35%)"): each category's
//     percentage so far, combined by the weights of the categories that have
//     grades yet.
// Extra credit (a score out of 0 points, e.g. 2/0) adds its points to what
// was earned and nothing to what was possible, as on Schoology; it has no
// percent, so it gets no dot.
// Ungraded and excused work is left out, and letter-only grades are skipped.
// Teacher-marked Missing work counts as a zero on Schoology, but the page
// doesn't say what it was worth. For a points-based period whose grade
// Schoology shows, the Missing items' points are worked out from that grade
// (spread evenly over them), so the line dips when they were due and ends on
// Schoology's number. Weighted periods leave Missing work out. The result
// can still differ from Schoology when a teacher uses rules the page doesn't
// show (dropped scores, extra credit).
//
// gradeHistory(course, { now }) ->
//   { start, end, points: [{ t, pct, title, got, max }],
//     segments: [{ periodId, label, line: [{ t, grade, title, missing }] }] }
// `got`/`max` are the assignment's points (max is null for a bare percent
// score with no points), so the chart can size each dot by what it's worth.
// Times are epoch ms. `start` is the first day of the school year (the
// earliest top-level period that has started), `end` is `now`.

function pctOf(a) {
  if (typeof a.score !== 'number' || Number.isNaN(a.score)) return null;
  if (a.maxPoints === 0) return { got: a.score, max: 0 }; // extra credit
  if (typeof a.maxPoints === 'number' && a.maxPoints > 0) return { got: a.score, max: a.maxPoints };
  return { got: a.score, max: 100 }; // a bare score is already a percent
}

function periodName(title) {
  return String(title || '').replace(/:.*$/, '').trim() || 'Grade';
}

export function gradeHistory(course, { now = Date.now() } = {}) {
  const periods = course.periods || [];
  const byPeriod = new Map(periods.map((p) => [String(p.id), p]));
  const categories = new Map((course.categories || []).map((c) => [String(c.id), c]));

  const tops = periods.filter((p) => p.topLevel && p.start && Date.parse(p.start) <= now);
  const startCandidates = tops.map((p) => Date.parse(p.start)).filter((t) => !Number.isNaN(t));

  // Graded assignments with a date, grouped by the period they count toward.
  const groups = new Map();
  const missingBy = new Map(); // periodId -> Missing items (worth unknown)
  const points = [];
  const periodOf = (a, cat) => String((cat && cat.parentId) || String(a.categoryId || '').split('-')[0] || '');
  for (const a of course.assignments || []) {
    if (a.status === 'excused') continue;
    const t = Date.parse(a.due || '');
    if (Number.isNaN(t) || t > now) continue;
    const cat = categories.get(String(a.categoryId || a.periodId || ''));
    const periodId = periodOf(a, cat);
    if (a.status === 'missing') {
      if (!missingBy.has(periodId)) missingBy.set(periodId, []);
      missingBy.get(periodId).push({ t, cat, title: a.title });
      continue;
    }
    const sc = pctOf(a);
    if (!sc) continue;
    if (sc.max > 0) points.push({ t, pct: (sc.got / sc.max) * 100, title: a.title, got: sc.got, max: a.maxPoints > 0 ? a.maxPoints : null });
    if (!groups.has(periodId)) groups.set(periodId, []);
    groups.get(periodId).push({ t, sc, cat, title: a.title });
  }
  points.sort((x, y) => x.t - y.t);

  // Points-based periods with Missing work and a Schoology grade: give the
  // Missing items the points that make the totals match that grade.
  for (const [periodId, missing] of missingBy) {
    const items = groups.get(periodId) || [];
    const period = byPeriod.get(periodId);
    const target = period && typeof period.grade === 'number' ? period.grade : null;
    const weighted = items.some((it) => it.cat && typeof it.cat.weight === 'number')
      || missing.some((m) => m.cat && typeof m.cat.weight === 'number');
    if (weighted || target === null || target <= 0 || !items.length) continue;
    const got = items.reduce((n, it) => n + it.sc.got, 0);
    const max = items.reduce((n, it) => n + it.sc.max, 0);
    const missingMax = got / (target / 100) - max;
    if (!(missingMax > 0)) continue;
    for (const m of missing) items.push({ t: m.t, sc: { got: 0, max: missingMax / missing.length }, cat: m.cat, title: m.title, missing: true });
    groups.set(periodId, items);
  }

  const segments = [];
  for (const [periodId, items] of groups) {
    items.sort((x, y) => x.t - y.t);
    const weighted = items.some((it) => it.cat && typeof it.cat.weight === 'number');
    const perCat = new Map(); // category id -> { got, max, weight }
    let got = 0;
    let max = 0;
    const line = [];
    for (const it of items) {
      got += it.sc.got;
      max += it.sc.max;
      const key = it.cat ? String(it.cat.id) : '';
      const c = perCat.get(key) || { got: 0, max: 0, weight: it.cat && typeof it.cat.weight === 'number' ? it.cat.weight : null };
      c.got += it.sc.got;
      c.max += it.sc.max;
      perCat.set(key, c);
      let grade;
      if (weighted) {
        let w = 0;
        let sum = 0;
        for (const cc of perCat.values()) {
          if (cc.max <= 0 || cc.weight === null) continue;
          w += cc.weight;
          sum += cc.weight * (cc.got / cc.max);
        }
        grade = w > 0 ? (sum / w) * 100 : max > 0 ? (got / max) * 100 : null;
      } else {
        grade = max > 0 ? (got / max) * 100 : null;
      }
      if (grade !== null) line.push({ t: it.t, grade, title: it.title, missing: Boolean(it.missing) });
    }
    if (!line.length) continue;
    const p = byPeriod.get(periodId);
    segments.push({ periodId, label: periodName(p && p.title), line });
  }
  segments.sort((x, y) => x.line[0].t - y.line[0].t);

  const firstT = points.length ? points[0].t : now;
  const start = startCandidates.length ? Math.min(...startCandidates, firstT) : firstT;
  return { start, end: now, points, segments };
}
