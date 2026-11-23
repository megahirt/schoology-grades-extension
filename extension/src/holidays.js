// holidays.js — which holiday icon to show, if any (pure, no browser APIs).
//
// The dashboard and the settings page show a holiday version of the logo
// (icons/holidays/<slug>.webp, drawn by scripts/holiday-icons.mjs) from three
// days before a holiday through the day itself. Hovering it says which day:
// "Christmas – Dec 25".
//
// Dates are local calendar days. When two holidays' windows overlap, the
// sooner one wins (on Sep 11, Patriot Day beats Grandparents Day two days
// later); on a tie, the one listed first.

const DAY = 24 * 60 * 60 * 1000;
export const DAYS_BEFORE = 3;

const fixed = (month, day) => (year) => new Date(year, month, day);
// The nth weekday (0 = Sunday) of a month; n = -1 for the last.
function nthWeekday(month, weekday, n) {
  return (year) => {
    if (n < 0) {
      const last = new Date(year, month + 1, 0);
      return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
    }
    const first = new Date(year, month, 1);
    return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
  };
}
// Easter Sunday (Western), by the anonymous Gregorian algorithm.
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const MON = 1;
const THU = 4;
const SUN = 0;

// The school year's days, in calendar order (slug = the icon's file name).
export const HOLIDAYS = [
  { slug: 'labor-day', name: 'Labor Day', date: nthWeekday(8, MON, 1) },
  { slug: 'patriot-day', name: 'Patriot Day', date: fixed(8, 11) },
  // The Sunday after Labor Day.
  { slug: 'grandparents-day', name: 'Grandparents Day', date: (y) => { const d = nthWeekday(8, MON, 1)(y); return new Date(y, 8, d.getDate() + 6); } },
  { slug: 'hispanic-heritage-month', name: 'Hispanic Heritage Month begins', date: fixed(8, 15) },
  { slug: 'constitution-day', name: 'Constitution Day', date: fixed(8, 17) },
  { slug: 'first-day-of-fall', name: 'First day of fall', date: fixed(8, 22) },
  { slug: 'world-teachers-day', name: "World Teachers' Day", date: fixed(9, 5) },
  { slug: 'indigenous-peoples-day', name: "Indigenous Peoples' Day", date: nthWeekday(9, MON, 2) },
  { slug: 'halloween', name: 'Halloween', date: fixed(9, 31) },
  // The Tuesday after the first Monday in November.
  { slug: 'election-day', name: 'Election Day', date: (y) => { const d = nthWeekday(10, MON, 1)(y); return new Date(y, 10, d.getDate() + 1); } },
  { slug: 'veterans-day', name: 'Veterans Day', date: fixed(10, 11) },
  { slug: 'thanksgiving', name: 'Thanksgiving', date: nthWeekday(10, THU, 4) },
  { slug: 'winter-solstice', name: 'Winter solstice', date: fixed(11, 21) },
  { slug: 'christmas', name: 'Christmas', date: fixed(11, 25) },
  { slug: 'new-years-day', name: "New Year's Day", date: fixed(0, 1) },
  { slug: 'mlk-day', name: 'Martin Luther King Jr. Day', date: nthWeekday(0, MON, 3) },
  { slug: 'black-history-month', name: 'Black History Month begins', date: fixed(1, 1) },
  { slug: 'groundhog-day', name: 'Groundhog Day', date: fixed(1, 2) },
  { slug: 'valentines-day', name: "Valentine's Day", date: fixed(1, 14) },
  { slug: 'presidents-day', name: "Presidents' Day", date: nthWeekday(1, MON, 3) },
  // Listed before daylight saving time, so Pi Day wins when both fall on Mar 14.
  { slug: 'pi-day', name: 'Pi Day', date: fixed(2, 14) },
  { slug: 'daylight-saving-time', name: 'Daylight saving time begins', date: nthWeekday(2, SUN, 2) },
  { slug: 'st-patricks-day', name: "St. Patrick's Day", date: fixed(2, 17) },
  { slug: 'first-day-of-spring', name: 'First day of spring', date: fixed(2, 20) },
  { slug: 'easter', name: 'Easter', date: easter },
  { slug: 'earth-day', name: 'Earth Day', date: fixed(3, 22) },
  // The first full week of May begins on its first Monday.
  { slug: 'teacher-appreciation-week', name: 'Teacher Appreciation Week', date: nthWeekday(4, MON, 1) },
  { slug: 'mothers-day', name: "Mother's Day", date: nthWeekday(4, SUN, 2) },
  { slug: 'memorial-day', name: 'Memorial Day', date: nthWeekday(4, MON, -1) },
];

function startOfDay(t) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
// Whole calendar days from a to b (DST-safe).
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

// holidayFor(now) -> { slug, name, date, label } for the holiday whose icon
// shows today, or null. label: "Christmas – Dec 25".
export function holidayFor(now = Date.now()) {
  const today = startOfDay(now);
  let best = null;
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    for (const h of HOLIDAYS) {
      const date = h.date(year);
      const until = daysBetween(today, date);
      if (until < 0 || until > DAYS_BEFORE) continue;
      if (!best || until < best.until) best = { ...h, date, until };
    }
  }
  if (!best) return null;
  const when = best.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { slug: best.slug, name: best.name, date: best.date, label: `${best.name} – ${when}` };
}

// The holiday icons are 176 tall: the 128 tile with 48 of headroom above it
// for hats. To keep the tile the size of the plain logo, draw the picture
// this many times taller and raise it by HEADROOM of its height.
export const ICON_SCALE = 176 / 128;
export const HEADROOM = 48 / 176;
