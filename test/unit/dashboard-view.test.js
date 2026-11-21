import { describe, it, expect } from 'vitest';
import { renderStudentBody, signedOutHtml, isSignedOutError } from '../../extension/src/dashboard-view.js';
import { DEFAULT_SETTINGS } from '../../extension/src/rules.js';

// Made-up data only.
const now = new Date();
const iso = (days, h = 23) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 59, 0, 0); return d.toISOString(); };

const courses = [{
  id: 'c1',
  name: 'American Literature',
  grade: 88,
  assignments: [
    { id: 'm1', title: 'Small Missing', status: 'missing', due: iso(-2) },
    { id: 'm2', title: 'Big Missing', status: 'missing', due: iso(-3), maxPoints: 50 },
    { id: 'm3', title: 'Medium Missing', status: 'missing', due: iso(-1), maxPoints: 20 },
    { id: 'd1', title: 'Due Small', status: 'pending', due: iso(1, 10), maxPoints: 5 },
    { id: 'd2', title: 'Due Big', status: 'pending', due: iso(1, 20), maxPoints: 30 },
    { id: 'g1', title: 'Great Quiz', status: 'graded', score: 9, maxPoints: 10, due: iso(-1) },
  ],
}];

function body() {
  return renderStudentBody({ studentName: 'Sam Rivera', courses }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true }).html;
}

describe('assignment point values', () => {
  it('shows what graded work is worth, not what was earned', () => {
    const html = body();
    expect(html).toContain('Great Quiz');
    expect(html).toMatch(/American Literature · 10 pts/);
    expect(html).not.toMatch(/9\/10/);
  });
  it('sorts Missing by point value, largest first, unknown last', () => {
    const html = body();
    const order = ['Big Missing', 'Medium Missing', 'Small Missing'].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('sorts Due soon within a day by point value, largest first', () => {
    const html = body();
    expect(html.indexOf('Due Big')).toBeLessThan(html.indexOf('Due Small'));
  });
});

describe('trend line next to each class', () => {
  const start = new Date(now); start.setDate(start.getDate() - 70);
  const qStart = new Date(now); qStart.setDate(qStart.getDate() - 20);
  const periods = [
    { id: 'S1', title: 'Semester 1', topLevel: true, grade: 85, start: start.toISOString(), end: iso(60) },
    { id: 'Q1', parentId: 'S1', title: 'Quarter 1', topLevel: false, grade: 80, start: start.toISOString(), end: iso(-21) },
    { id: 'Q2', parentId: 'S1', title: 'Quarter 2', topLevel: false, grade: 90, start: qStart.toISOString(), end: iso(60) },
  ];
  const graded = (n, pfx) => Array.from({ length: n }, (_, i) => ({ id: `${pfx}${i}`, title: `Item ${i}`, status: 'graded', score: 8 + (i % 3), maxPoints: 10, due: iso(-2 - i * 3), periodId: 'Q2', categoryId: 'Q2-1' }));
  const cls = (over) => ({ grade: 90, quarterGrade: 90, overallGrade: 85, gradeLabel: 'Quarter 2', gradeSource: 'Quarter 2', periods, ...over });
  const html = (list) => renderStudentBody({ studentName: 'Sam Rivera', courses: list }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true }).html;

  it('always shows the trend line, and the ▲ pill too when the class is up on last quarter', () => {
    const out = html([cls({ id: 'a', name: 'Up Class', assignments: graded(6, 'a') })]);
    expect(out).toContain('up-pill');
    expect(out).toContain('trend-line');
    expect(out.indexOf('up-pill')).toBeLessThan(out.indexOf('trend-line'));
  });
  it('shows a trend line when there is no pill and 5+ grades; the whole row opens the chart', () => {
    const out = html([cls({ id: 'b', name: 'Flat Class', quarterGrade: 80, grade: 80, assignments: graded(6, 'b') })]);
    expect(out).not.toContain('up-pill');
    expect(out).toMatch(/class="trend-line" role="img" aria-label="Flat Class trend: from \d+% to \d+% over 6 grades"/);
    expect(out).toMatch(/class="class-row" data-act="toggle-chart"/); // the whole row opens the chart
  });
  it('leaves the spot empty until there are 5 grades', () => {
    const out = html([cls({ id: 'c', name: 'New Class', quarterGrade: 80, grade: 80, assignments: graded(3, 'c') })]);
    expect(out).not.toContain('trend-line');
    expect(out).not.toContain('trend after');
  });
});

describe('extra credit', () => {
  const list = [{ id: 'c1', name: 'Chemistry', grade: 92, assignments: [
    { id: 'e1', title: 'Bonus Lab', status: 'graded', score: 2, maxPoints: 0, due: iso(-1) },
    { id: 'e2', title: 'Unit Test', status: 'graded', score: 53, maxPoints: 50, due: iso(-2) },
    { id: 'e3', title: 'Plain Quiz', status: 'graded', score: 9, maxPoints: 10, due: iso(-3) },
  ] }];
  const records = { extraCredit: { value: 17, key: 'ec:2', info: { classes: 3, items: 2 }, newAt: null } };
  const out = (over = {}) => renderStudentBody({ studentName: 'Sam Rivera', courses: list }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true, records, ...over }).html;

  it('shows in Doing well with a rocket', () => {
    const html = out();
    const well = html.slice(html.indexOf('Doing well'));
    expect(well).toMatch(/Bonus Lab[\s\S]*?class="bonus"[\s\S]*?\+2 pts/);
    expect(well).toMatch(/Unit Test[\s\S]*?class="bonus"[\s\S]*?106%/);
    expect(well).not.toMatch(/Plain Quiz[^\n]*?class="bonus"[^\n]*?90%/);
    expect((well.match(/class="bonus"/g) || []).length).toBe(2);
  });
  it('adds up as one record across classes', () => {
    const html = out();
    expect(html).toContain('Extra credit this year');
    expect(html).toContain('3 classes · 2 assignments');
    expect(html).toContain('+17 pts');
    expect(html).not.toContain('bonus point');
    expect(html).not.toContain('+17%');
  });
  it('one point, one class', () => {
    const html = out({ records: { extraCredit: { value: 1, key: 'ec:1', info: { classes: 1, items: 1 }, newAt: null } } });
    expect(html).toContain('+1 pt<');
    expect(html).toContain('1 class · 1 assignment');
  });
});

describe('the student view looks like the parent view', () => {
  const render = (isParentView) => renderStudentBody(
    { studentName: 'Sam Rivera', courses },
    'u1',
    { ...DEFAULT_SETTINGS, showGoNoGo: true },
    { turnedIn: [], done: [] },
    { isParentView },
  ).html;
  it('same card: picture, name, the Missing chip, this week\'s progress bar (no Due soon chip)', () => {
    const student = render(false);
    expect(student).toContain('<div class="card-name">Sam Rivera</div>');
    expect(student).toMatch(/class="avatar"/);
    expect(student).toMatch(/<span class="stat-l">Missing<\/span>/);
    expect(student).not.toMatch(/<span class="stat-l">Due soon<\/span>/);
    expect(student).toContain('class="wk-progress"');
    expect(student).not.toContain('<svg viewBox="0 0 100 100"'); // no ring
  });
  it('without the parent-only parts: no GO/NO-GO and no message-the-teacher button', () => {
    const student = render(false);
    const parent = render(true);
    expect(parent).toContain('aria-label="NO-GO"');
    expect(student).not.toContain('NO-GO');
    expect(student).toContain('card plain');
    expect(parent).toContain('data-act="email-teacher"');
    expect(student).not.toContain('data-act="email-teacher"');
  });
});

describe('signed out of Schoology', () => {
  it('says the data is old, from when, and links to Schoology', () => {
    const html = signedOutHtml(new Date().toISOString(), 'https://app.schoology.com');
    expect(html).toMatch(/Please <a [^>]+>log in to Schoology<\/a> to see the latest\./);
    expect(html).toContain('href="https://app.schoology.com/"');
    expect(html).toMatch(/This is old data \(from today, [^)]+\)\./);
    expect(signedOutHtml(null, 'https://app.schoology.com')).toMatch(/This is old data\.<\/div>$/);
  });
  it('a refresh that failed because nobody is signed in counts as signed out; a network error does not', () => {
    expect(isSignedOutError('NOT_LOGGED_IN')).toBe(true);
    expect(isSignedOutError('LOGGED_OUT')).toBe(true);
    expect(isSignedOutError('SCHOOLOGY_UNAVAILABLE')).toBe(false);
  });
});

describe('footer', () => {
  it('has an About link to the promo site, opening in a new tab', async () => {
    const { ABOUT_URL } = await import('../../extension/src/dashboard-view.js');
    expect(ABOUT_URL).toBe('https://schoology.hirtfamily.net/');
  });
});

describe('classes: this week\'s work', () => {
  // Made-up week, anchored to this week's Monday so it never straddles two.
  const DAY = 86400000;
  const monday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();
  const at = (days, h = 12) => new Date(monday + days * DAY + h * 3600000).toISOString();
  const NOW = monday + 3 * DAY + 12 * 3600000; // Thursday noon
  const course = {
    id: 'c9', name: 'Biology', grade: 70,
    assignments: [
      { id: 'w1', title: 'Cell Lab', status: 'graded', score: 9, maxPoints: 10, due: at(0) },
      { id: 'w2', title: 'Reading Quiz', status: 'missing', submitted: true, due: at(1) },
      { id: 'w3', title: 'Osmosis Worksheet', status: 'missing', due: at(1) },
      { id: 'w4', title: 'Photosynthesis Diagram', status: 'pending', due: at(4) },
      // Earlier weeks: Missing (one since submitted) carries into this week;
      // other submitted work waits in Submitted, not graded yet.
      { id: 'w0', title: 'Last Week Essay', status: 'missing', submitted: true, due: at(-3) },
      { id: 'w5', title: 'Old Missing Lab', status: 'missing', due: at(-10) },
      { id: 'w6', title: 'Old Report', status: 'pending', submitted: true, due: at(-4) },
    ],
  };
  // Marking is a student's own, so the default view here is the student's.
  const render = (marks = {}, openClass = null, isParentView = false) => renderStudentBody({ studentName: 'Sam Rivera', courses: [course] }, 'u1', { ...DEFAULT_SETTINGS },
    { turnedIn: marks.turnedIn || [], done: marks.done || [] }, { isParentView, openClass, now: NOW }).html;

  it('the bar has a segment per assignment (earlier Missing work included), filled as work is done; a low grade is a pill', () => {
    const html = render();
    // This week's 4, plus the 2 earlier Missing ones: 3 done (graded, and
    // two submitted).
    expect(html).toContain('<span class="week-label">3 of 6</span>');
    expect(html).toMatch(/class="seg-bar" role="img" aria-label="Biology: 3 of 6 done this week">(<i class="seg on"><\/i>){3}(<i class="seg"><\/i>){3}<\/div>/);
    // Teacher-marked Missing until graded, submitted or not: 4.
    expect(html).toMatch(/class="class-missing"[^>]*aria-label="4 missing"/);
    // The week's dates sit in the Classes header.
    expect(html).toMatch(/class="col-h col-w">\w{3} \d+ to (\w{3} )?\d+</);
    expect(html).toMatch(/class="class-grade col-q low"|class="class-grade low"/);
    expect(html).not.toContain('class="week-list"'); // closed
  });
  it('opened: one line per assignment, by date, checked when graded or submitted, with icons', () => {
    const html = render({}, 'u1:c9');
    const list = html.slice(html.indexOf('class="week-list"'), html.indexOf('class="chart-box"'));
    expect((list.match(/<li class="wk">/g) || []).length).toBe(6);
    expect(list.indexOf('Old Missing Lab')).toBeLessThan(list.indexOf('Last Week Essay'));
    expect(list.indexOf('Last Week Essay')).toBeLessThan(list.indexOf('Cell Lab'));
    expect(list).not.toContain('Old Report');
    expect(list).toMatch(/Cell Lab[\s\S]*?90%/);
    // Graded and submitted (this week's quiz and last week's essay) are
    // checked and can't be unticked.
    expect((list.match(/class="wk-check on" type="button" disabled/g) || []).length).toBe(3);
    // Still marked Missing once submitted: both icons, until it's graded.
    expect(list).toMatch(/Last Week Essay<\/span><span class="wk-icon" role="img" aria-label="Missing"[^>]*>[\s\S]*?<\/span><span class="wk-icon wk-sub" role="img" aria-label="Submitted, not graded yet"/);
    expect(list).toMatch(/Cell Lab<\/span><span class="wk-due">/); // graded: no icons
    // Missing: the Missing icon, and the check marks it turned in.
    expect(list).toMatch(/data-act="turned-in"[^>]*aria-label="Mark Osmosis Worksheet as turned in"/);
    expect(list).toMatch(/data-act="turned-in"[^>]*aria-label="Mark Old Missing Lab as turned in"/);
    expect(list).toMatch(/Osmosis Worksheet[\s\S]*?aria-label="Missing"/);
    // Not done yet: the check marks it done.
    expect(list).toMatch(/data-act="done"[^>]*aria-label="Mark Photosynthesis Diagram as done"/);
    // The chart comes after the list.
    expect(html.indexOf('class="week-list"')).toBeLessThan(html.indexOf('class="chart-box"'));
  });
  it('marking is for students only: a parent sees no mark buttons, and marks do not count', () => {
    const parent = render({ turnedIn: ['w5'], done: ['w4'] }, 'u1:c9', true);
    expect(parent).not.toContain('data-act="turned-in"');
    expect(parent).not.toContain('data-act="done"');
    expect(parent).not.toContain('data-act="undo"');
    expect(parent).toContain('<span class="week-label">3 of 6</span>'); // marks ignored
    expect(parent).toMatch(/Missing · 2</);
    expect(parent).toContain('data-act="email-teacher"');
  });
  it('a marked item stays in its list, struck through, with Undo; the counts go down', () => {
    const html = render({ turnedIn: ['w5'] });
    // Still listed under Missing, marked, with Undo in place of the mark button.
    expect(html).toMatch(/<div class="missing-card marked" data-aid="w5"[^>]*>[\s\S]*?Old Missing Lab[\s\S]*?data-act="undo" data-reason="turnedIn"[^>]*aria-label="Undo: Old Missing Lab"/);
    expect(html).toMatch(/<div class="missing-card" data-aid="w3"[^>]*>[\s\S]*?data-act="turned-in"[^>]*aria-label="Mark Osmosis Worksheet as turned in"/);
    expect(html).toMatch(/Missing · 1</); // one left of the two
    // Not moved to Submitted, not graded yet.
    const waiting = html.slice(html.indexOf('Submitted, not graded yet ·'));
    expect(waiting).not.toContain('Old Missing Lab');
    expect(html).not.toContain('nobody is notified');
  });
  it('a mark crosses it out in its class and can be undone; earlier Missing work stays checked in its class', () => {
    const list = render({ done: ['w4'] }, 'u1:c9');
    expect(list).toContain('<span class="week-label">4 of 6</span>');
    expect(list).toMatch(/data-act="undo" data-reason="done"[^>]*aria-label="Undo: Photosynthesis Diagram"/);
    expect(list).toMatch(/class="wk-title done">Photosynthesis Diagram/);
    const old = render({ turnedIn: ['w5'] }, 'u1:c9');
    expect(old).toMatch(/data-act="undo" data-reason="turnedIn"[^>]*aria-label="Undo: Old Missing Lab"/);
    expect(old).toContain('<span class="week-label">4 of 6</span>');
  });
  it('nothing due this week: one grey bar and "No HW"', () => {
    const html = renderStudentBody({ studentName: 'Sam Rivera', courses: [{ id: 'q', name: 'Art', grade: 95, assignments: [{ id: 'z', title: 'Old', status: 'graded', score: 1, maxPoints: 1, due: at(-9) }] }] }, 'u1',
      { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true, now: NOW }).html;
    expect(html).toContain('aria-label="Art: nothing due this week"><i class="seg"></i></div>');
    expect(html).toContain('<span class="week-label">No HW</span>');
    // Earlier Missing work is this week's work: one grey segment to do.
    const missing = renderStudentBody({ studentName: 'Sam Rivera', courses: [{ id: 'q', name: 'Art', grade: 95, assignments: [{ id: 'z', title: 'Old', status: 'missing', due: at(-9) }] }] }, 'u1',
      { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true, now: NOW }).html;
    expect(missing).toContain('aria-label="Art: 0 of 1 done this week"><i class="seg"></i></div>');
  });
  it('the progress bar counts the same items, Missing in orange', () => {
    const html = render();
    // "3 of 6 assignments, Nov 9 to 15: …" (the dates are this week's).
    expect(html).toMatch(/aria-label="3 of 6 assignments, [A-Z][a-z]{2} \d{1,2} to (?:[A-Z][a-z]{2} )?\d{1,2}: 1 graded, 2 turned in, 2 missing, 1 remaining"/);
    expect(html).toMatch(/<b>3 of 6<\/b> done · [A-Z][a-z]{2} \d{1,2} to /);
    expect(html).toContain('<span class="wk-part missing" data-tip="2 missing" style="flex-grow:2"></span>');
    expect(html).toContain('data-tip="1 remaining"');
    // The rocket sits where the done work ends: 3 of 6.
    expect(html).toContain('<span class="wk-rocket" data-done="3" style="--done:0.5000">🚀</span>');
    // Marked turned in, earlier Missing work counts as turned in.
    expect(render({ turnedIn: ['w5'] })).toMatch(/4 of 6 assignments, [^:]+: 1 graded, 3 turned in, 1 missing, 1 remaining/);
  });
  it('items that can be new carry a key; good news also names its celebration', () => {
    const html = render();
    expect(html).toContain('data-aid="w3" data-new="missing:w3">');
    // A good grade in Doing well: the star. (Its own item, due two days
    // before now, so the test doesn't depend on the day or time zone it runs in.)
    const good = renderStudentBody({ studentName: 'Sam Rivera', courses: [{ id: 'g', name: 'Art', grade: 95, assignments: [{ id: 'g1', title: 'Sketch', status: 'graded', score: 10, maxPoints: 10, due: new Date(NOW - 2 * DAY).toISOString() }] }] }, 'u1',
      { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: false, now: NOW }).html;
    expect(good).toContain('<div class="row compact" data-new="grade:g1:10" data-cue="star">');
  });
  it('Submitted, not graded yet keeps only earlier work that was never Missing', () => {
    const html = render();
    const waiting = html.slice(html.indexOf('Submitted, not graded yet ·'));
    expect(waiting).toContain('Old Report');
    expect(waiting).not.toContain('Last Week Essay');
    expect(waiting).not.toContain('Reading Quiz');
    expect(html).toContain('Submitted, not graded yet · 1');
    expect(render({ turnedIn: ['w5'] })).toContain('Submitted, not graded yet · 1');
  });
});

describe('Overdue section', () => {
  const list = [{
    id: 'c9',
    name: 'Biology',
    grade: 91,
    assignments: [
      { id: 'm1', title: 'Old Missing', status: 'missing', due: iso(-2) },
      { id: 'o1', title: 'Lab Report', status: 'overdue', due: iso(-1), maxPoints: 20 },
      { id: 'o2', title: 'Reading Notes', status: 'overdue', due: iso(-3), maxPoints: 5 },
      { id: 'd1', title: 'Due Tomorrow', status: 'pending', due: iso(1) },
    ],
  }];
  const render = (isParentView, turnedIn = [], extra = {}) => renderStudentBody({ studentName: 'Sam Rivera', courses: list }, 'u1', { ...DEFAULT_SETTINGS },
    { turnedIn, done: [] }, { isParentView, ...extra }).html;
  const overdue = (html) => html.slice(html.indexOf('Overdue ·'), html.indexOf('Due soon ·'));

  it('comes right after Missing and before Due soon, with the 😬 heading and a count', () => {
    const html = render(true);
    expect(html.indexOf('Missing ·')).toBeLessThan(html.indexOf('Overdue ·'));
    expect(html.indexOf('Overdue ·')).toBeLessThan(html.indexOf('Due soon ·'));
    expect(html).toMatch(/<span class="sec-emoji" aria-hidden="true">😬<\/span>Overdue · 2/);
  });

  it('keeps each item to one tight line: title, class (muted, cut short first) and how many days late, oldest first', () => {
    const html = overdue(render(true));
    expect(html).toMatch(/<div class="overdue-row" data-aid="o1"[^>]*><div class="grow overdue-line"><(?:a|span) class="item-title overdue-title"[^>]*>Lab Report<\/(?:a|span)><span class="overdue-class">Biology<\/span><span class="overdue-age" title="Due [^"]+">1 day<\/span><\/div>/);
    expect(html).toMatch(/Reading Notes<\/(?:a|span)><span class="overdue-class">Biology<\/span><span class="overdue-age" title="Due [^"]+">3 days<\/span>/);
    // Reading Notes (3 days late) before Lab Report (1 day), whatever the points.
    expect(html.indexOf('Reading Notes')).toBeLessThan(html.indexOf('Lab Report'));
  });

  it('lets parents and students mark it turned in (no mail button)', () => {
    for (const isParentView of [true, false]) {
      const html = overdue(render(isParentView));
      expect(html).not.toContain('email-teacher');
      expect(html).toMatch(/data-act="turned-in"[^>]*aria-label="Mark Lab Report as turned in"/);
    }
  });

  it('keeps a marked item in place, struck through with Undo, for parents and students', () => {
    for (const isParentView of [true, false]) {
      const html = render(isParentView, ['o1']);
      expect(overdue(html)).toMatch(/class="overdue-row marked" data-aid="o1"[^]*?data-act="undo" data-reason="turnedIn"/);
      expect(overdue(html)).toContain('Overdue · 1');
    }
  });

  it('a parent\'s marks count only on Overdue items', () => {
    // An old mark on teacher-marked Missing work changes nothing for a parent.
    const html = render(true, ['m1']);
    expect(html).toContain('Missing · 1');
    expect(html).not.toMatch(/data-aid="m1"[^>]*>[^]*?data-act="undo"/);
  });

  it('puts an Overdue chip with 😬 on the card, counting what is still unmarked', () => {
    expect(render(true)).toMatch(/<span class="stat-v">2<\/span><span class="stat-icon" aria-hidden="true"><span class="stat-hg">😬<\/span><\/span><span class="stat-l">Overdue<\/span>/);
    expect(render(true, ['o1'])).toMatch(/<span class="stat-v">1<\/span><span class="stat-icon" aria-hidden="true"><span class="stat-hg">😬<\/span><\/span><span class="stat-l">Overdue<\/span>/);
    expect(render(true, ['o1', 'o2'])).not.toContain('<span class="stat-l">Overdue</span>');
  });

  it('counts earlier Missing and Overdue work from the quarter in this week\'s progress bar', () => {
    const earlier = [{ id: 'c8', name: 'History', grade: 90, assignments: [
      { id: 'x1', title: 'Old Overdue', status: 'overdue', due: iso(-10) },
      { id: 'x2', title: 'Old Missing', status: 'missing', due: iso(-12) },
      { id: 'x3', title: 'Old Graded', status: 'graded', score: 9, maxPoints: 10, due: iso(-10) },
    ] }];
    const bar = (turnedIn) => {
      const html = renderStudentBody({ studentName: 'Sam Rivera', courses: earlier }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn, done: [] }, { isParentView: true }).html;
      return html.match(/class="wk-progress" role="img" aria-label="([^"]*)"/)[1];
    };
    expect(bar([])).toMatch(/^0 of 2 assignments, .*: 0 graded, 0 turned in, 1 missing, 1 overdue, 0 remaining$/);
    expect(bar(['x1'])).toMatch(/^1 of 2 assignments, .*: 0 graded, 1 turned in, 1 missing, 0 remaining$/);
  });

  it('is left out when nothing is overdue', () => {
    const html = renderStudentBody({ studentName: 'Sam Rivera', courses }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] }, { isParentView: true }).html;
    expect(html).not.toContain('Overdue ·');
  });

  it('shows 😬 after the title of this week\'s overdue work in the opened class', () => {
    const week = (html) => html.slice(html.indexOf('week-list'));
    // Due earlier today, so it is past due and inside this week whatever the weekday.
    const today = new Date(now); today.setHours(0, 1, 0, 0);
    const c = [{ ...list[0], assignments: [{ id: 'o3', title: 'Exit Ticket', status: 'overdue', due: today.toISOString() }] }];
    const html = renderStudentBody({ studentName: 'Sam Rivera', courses: c }, 'u1', { ...DEFAULT_SETTINGS }, { turnedIn: [], done: [] },
      { isParentView: false, openClass: 'u1:c9', now: now.getTime() }).html;
    if (today.getTime() > now.getTime()) return; // just after midnight: nothing is past due yet
    expect(week(html)).toMatch(/Exit Ticket<\/[a-z]+><span class="wk-icon wk-overdue" role="img" aria-label="Overdue" title="Overdue">😬<\/span>/);
    expect(week(html)).toMatch(/data-act="turned-in"[^>]*aria-label="Mark Exit Ticket as turned in"/);
  });
});

describe('holiday logo in the header', () => {
  it('is the plain logo on an ordinary day', async () => {
    const { headLogoHtml } = await import('../../extension/src/dashboard-view.js');
    expect(headLogoHtml(null, null)).toMatch(/^<img class="head-logo" src="[^"]+" alt="" width="36" height="36">$/);
  });
  it('is the holiday picture, named on hover, near a holiday', async () => {
    const { headLogoHtml } = await import('../../extension/src/dashboard-view.js');
    const html = headLogoHtml({ slug: 'christmas', name: 'Christmas', label: 'Christmas – Dec 25' }, 'data:image/png;base64,AAA');
    expect(html).toBe('<img class="head-logo holiday" src="data:image/png;base64,AAA" alt="Christmas" title="Christmas – Dec 25" height="50">');
  });
  it('falls back to the plain logo if the picture could not be loaded', async () => {
    const { headLogoHtml } = await import('../../extension/src/dashboard-view.js');
    expect(headLogoHtml({ slug: 'christmas', name: 'Christmas', label: 'x' }, null)).toContain('class="head-logo"');
  });
});
