# Ideas

Things worth doing or looking into, not yet planned or built. Newest at
the bottom. When one gets built, delete it from here.

## 1. Marking work as done: test it with students

**Recorded:** 2026-11-15

A marked item now stays in its list, struck through, with Undo, and a
notice says that marking doesn't turn anything in. Only students can
mark.

- Still to do: user testing with students. Do they understand the
  strike-through and the notice, and do they trust the counts?

## 2. Tests and quizzes: a longer look ahead

**Recorded:** 2026-11-15

"Due soon" only looks a short way ahead. Tests and quizzes need more
warning than homework.

- Find upcoming tests and quizzes and show them with a longer horizon.
- Shape it as a test and quiz planning feature: what is coming, and
  when to start preparing.

### Research, 2026-11-15 (read-only: a parent on app.schoology.com, then a student on the school's own Schoology address)

**Where future dates are.** Schoology's calendar has a JSON feed:

    parent:  GET /parent/calendar/<YYYY-MM>?ajax=1&start=<unix>&end=<unix>
    student: GET /calendar/<YYYY-MM>?ajax=1&start=<unix>&end=<unix>
             (also /calendar/<uid>/<YYYY-MM>?…, the same answer)

- Both were tried and work. Each gives 403 to the other kind of account.
- The parent feed answers for the child the parent is viewing, so it
  fits the refresh, which already switches to each child in turn. Its
  items carry `child_uid`; the student's do not.
- The student and the parent viewing that student got the same 12 items
  with the same types.
- The start/end range is honored whatever month is in the path. In the
  account looked at it returned 12 items, the furthest 30 days ahead.
- Each item has: `start` ("2026-11-16 16:00:00"), `e_type`, `titleText`,
  `content_id` (the assignment's id), `realm_id` (the course id),
  `content_title` (the class), `child_uid`, `allDay`.
- The home page's "Upcoming" block (`/parent/home`, `.upcoming-event`)
  has the same items as HTML, with `data-start` and an icon class. The
  JSON feed is the better source.
- A student's home page has no "Upcoming" block in its HTML, and
  `/home/upcoming_ajax` returned one item, so for students the feed is
  the only good source of the two.

**The grade report already has most of it.** As the student, the grade
report (`/grades/grades`, which the extension reads) had 11 rows with a
due date in the future, and 10 of the 12 calendar items matched one of
them by id. The two that did not are a calendar `event` (a retake
deadline) and an `external_tool` item, which are not graded items. So a
first version could use the grade report alone: future due date, plus
the rule below. The feed adds `e_type` and the items that are not
graded.

**What marks a test or quiz.** No single field does:

- `e_type: "common-assessment"` is Schoology's own test tool. It caught
  2 of the 5 test-like items.
- Teachers also post tests and quizzes as plain `assignment` items (2 of
  the 5) and as calendar `event` items such as a retake deadline (1).
- The grade report has no type per item (the parser's `kind` is always
  empty on the real site), but every item sits in a grade category, and
  the category names are already stored (`course.categories`,
  `assignment.categoryId`): "Tests/Quizzes", "Tests", "Exam",
  "Assessments", "Quizzes/Tests/Projects", and so on.
- 10 of the 12 calendar items matched an assignment the extension
  already has, by id, so their category is known.

**A rule to start from.** An upcoming item is a test or quiz when any of
these holds:

1. `e_type` is `common-assessment`.
2. Its title has a whole word from: test, quiz, exam, midterm, final.
3. Its grade category name has one of those words (or "assessment").

Things to watch: "Test Review Sheet" matches rule 2 but is homework; a
category like "Quizzes/Tests/Projects" also holds projects; band
"Playing Tests" are tests of a different kind. Showing the category and
letting the family hide a class or a word may be enough.

**Open questions.**

- The dashboards stored in the test browser showed fewer future-dated
  items for a child (4) than the live grade report did for the student
  (11). Check whether that was stale data, another child, or the parser
  dropping some due dates.
- How far ahead teachers actually post (30 days was the furthest seen).

## 3. Where Refresh, Share and Settings belong

**Recorded:** 2026-11-15

The Refresh, Share and Settings buttons sit at the top today.

- Evaluate top against bottom, especially on a phone, where the bottom
  is easier to reach.
- Decide whether they need to be sticky (always on screen) at all.

## 4. More cues for what changed since you last looked

**Recorded:** 2026-11-15

Built so far: anything new fades in as it scrolls into view; good news
(a good new grade, a new record, a class up since last quarter) gets one
small celebration per view; the rocket flies along the week's bar when
the done count goes up. All of it plays once, honors "reduce motion",
and what has been seen is remembered on the device only.

Still open:

- A cue for a change in a grade chart.
- Whether the celebrations feel right in real use: fun, but never corny,
  overbearing or distracting (Chris's bar). Small and local, about half
  a second, quiet, rare.
- A lower grade only fades in, by design (see the research notes on the
  features page: no red arrows for drops). Check that this reads well.
