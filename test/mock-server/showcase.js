// showcase.js — the "showcase" data set for the promo-site screenshots
// (scripts/site-screenshots.mjs). Made-up people only: the Rivera family
// and the usual made-up teachers. Never real student data.
//
// Unlike the test personas in server.js, every date here is relative to
// `now`. The screenshot script pins `now` (and the extension's clock) to one
// fixed day, so the pictures come out the same whenever they're taken.
//
//   parent persona:  Sam Rivera   (grade 10, 8 classes, GO: 1 Missing,
//                                  two classes up since Q1, lots of good work)
//                    Jamie Rivera (grade 7, 8 classes, NO-GO: 3 Missing and
//                                  Math below the passing line)
//   student persona: Sam Rivera, with exactly the data the parent sees.
//
// Each class lists a teacher, and some also list Mr. Ortiz (a department
// admin on many classes), so "Message the teacher" shows the chooser.

const DAY = 24 * 60 * 60 * 1000;
const SUBMITTED = 'This student has completed assignment submission';
const PENDING = 'This student has made a submission that has not been graded.';

export const SHOWCASE_ADMINS = {
  9001: 'Ms. Teacher', 9100: 'Mr. Ortiz', 9301: 'Ms. Park', 9302: 'Mr. Chen', 9401: 'Mrs. Hall', 9402: 'Mr. Young',
};

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// "11/03/26 11:59pm", the way Schoology prints a due date.
function due(t, time = '11:59pm') {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy} ${time}`;
}

// "8/24/2026" (quarters) or "8/24/26" (semester), as Schoology prints them.
function shortDate(t, fullYear) {
  const d = new Date(t);
  const y = fullYear ? d.getFullYear() : String(d.getFullYear()).slice(2);
  return `${d.getMonth() + 1}/${d.getDate()}/${y}`;
}

// buildShowcase(now) -> { student, parent, admins(courseId) }
export function buildShowcase(now = Date.now()) {
  const today = startOfDay(now);
  // Semester 1 started 11 weeks ago; Quarter 1 ran 7.5 weeks, Quarter 2 is now.
  const semStart = today - 77 * DAY;
  const q1End = semStart + 52 * DAY;
  const q2Start = q1End + 5 * DAY;
  const q2End = q2Start + 57 * DAY;
  const semEnd = q2End + 4 * DAY;
  const S1 = `Semester 1: ${shortDate(semStart)} - ${shortDate(semEnd)}`;
  const Q1 = `Quarter 1: ${shortDate(semStart, true)} - ${shortDate(q1End, true)}`;
  const Q2 = `Quarter 2: ${shortDate(q2Start, true)} - ${shortDate(q2End, true)}`;

  let nextItem = 80000;
  // Graded work spread over Quarter 2 so far (oldest first), from percents.
  function graded(titles, percents, max = 20) {
    const span = Math.max(1, Math.round((today - 2 * DAY - q2Start) / DAY));
    return titles.map((title, i) => {
      const t = q2Start + Math.round(((i + 1) / (titles.length + 1)) * span) * DAY;
      return { id: String(nextItem++), title, kind: /quiz|test/i.test(title) ? 'assessment' : 'assignment', due: due(t), score: Math.round((percents[i] / 100) * max), max };
    });
  }
  const at = (days, extra) => ({ id: String(nextItem++), due: due(today + days * DAY), kind: 'assignment', ...extra });

  // Quarter 1 work (all graded), scattered around the Quarter 1 grade.
  const Q1_TITLES = ['Unit 1 Quiz', 'Homework Set 1', 'Unit 1 Project', 'Homework Set 2', 'Unit 2 Quiz', 'Homework Set 3'];
  const Q1_SPREAD = [-4, 3, -1, 4, -2, 1];
  function quarter1(q1) {
    const span = Math.round((q1End - semStart) / DAY);
    return Q1_TITLES.map((title, i) => ({
      id: String(nextItem++),
      title,
      kind: /quiz/i.test(title) ? 'assessment' : 'assignment',
      due: due(semStart + Math.round(((i + 1) / (Q1_TITLES.length + 1)) * span) * DAY),
      score: Math.max(0, Math.min(20, Math.round(((q1 + Q1_SPREAD[i]) / 100) * 20))),
      max: 20,
    }));
  }

  function course(id, title, { q2, q1, sem }, items) {
    return {
      id, title, courseGrade: null,
      periods: [
        { id: `${id}1`, title: S1, grade: sem, items: [] },
        { id: `${id}2`, title: Q1, grade: q1, parentId: `${id}1`, items: quarter1(q1) },
        { id: `${id}3`, title: Q2, grade: q2, parentId: `${id}1`, items },
      ],
    };
  }

  const sam = {
    uid: '2000001',
    name: 'Sam Rivera',
    courses: [
      course('4001', 'Biology: Section 2', { q2: 91, q1: 84, sem: 88 }, [
        ...graded(['Cell Structure Lab', 'Mitosis Quiz', 'Microscope Drawings', 'Genetics Worksheet', 'Punnett Square Quiz'], [88, 92, 95, 90, 93]),
        at(-1, { title: 'DNA Model', score: 19, max: 20 }),
        at(0, { title: 'Lab Report: Osmosis' }),
      ]),
      course('4002', 'Geometry: Section 4', { q2: 86, q1: 79, sem: 82 }, [
        ...graded(['Proofs Practice', 'Triangle Congruence Quiz', 'Similarity Worksheet', 'Unit 3 Test', 'Area Problems'], [80, 84, 88, 86, 90]),
        at(-2, { title: 'Circles Worksheet', note: SUBMITTED, score: 18, max: 20 }),
        at(1, { title: 'Chapter 7 Review' }),
      ]),
      course('4003', 'English 10: Section 1', { q2: 89, q1: 90, sem: 89 }, [
        ...graded(['Reading Journal 4', 'Vocabulary Quiz 6', 'Essay Outline', 'Poetry Response', 'Vocabulary Quiz 7'], [90, 85, 92, 88, 90]),
        at(-1, { title: 'Argument Essay Draft', note: PENDING, pending: true }),
        at(2, { title: 'Reading Journal 6' }),
      ]),
      course('4004', 'World History: Section 3', { q2: 93, q1: 94, sem: 93 }, [
        ...graded(['Map Quiz: Europe', 'Primary Source Analysis', 'Unit 4 Test', 'Timeline Project', 'Chapter 9 Questions'], [95, 90, 92, 96, 91]),
        at(0, { title: 'Chapter 10 Notes' }),
      ]),
      course('4005', 'Spanish 2: Section 1', { q2: 84, q1: 86, sem: 85 }, [
        ...graded(['Vocabulario 4', 'Preterite Quiz', 'Conversation Recording', 'Reading Check', 'Vocabulario 5'], [86, 80, 90, 84, 85]),
        at(-4, { title: 'Workbook p. 112–113', exception: 'missing', max: 10 }),
        at(1, { title: 'Vocabulario 6 Quiz', kind: 'assessment' }),
      ]),
      course('4006', 'Health & PE: Section 6', { q2: 97, q1: 98, sem: 97 }, [
        ...graded(['Fitness Log 1', 'Nutrition Worksheet', 'Fitness Log 2', 'Team Sports Reflection', 'Fitness Log 3'], [100, 95, 100, 92, 100], 10),
      ]),
      course('4007', 'Art Foundations: Section 2', { q2: 95, q1: 96, sem: 95 }, [
        ...graded(['Contour Drawing', 'Value Scale', 'Still Life Sketch', 'Color Wheel', 'Artist Study'], [94, 96, 92, 98, 95]),
        at(-3, { title: 'Perspective Drawing', score: 20, max: 20 }),
      ]),
      course('4008', 'Computer Science: Section 1', { q2: 92, q1: 88, sem: 90 }, [
        ...graded(['Loops Practice', 'Functions Quiz', 'Debugging Lab', 'Lists Project', 'Unit 2 Test'], [90, 94, 88, 96, 92]),
        at(-1, { title: 'Pixel Art Program', note: SUBMITTED, score: 20, max: 20 }),
      ]),
      { id: '4009', title: 'Advisory 10: Section 1', courseGrade: null, periods: [] },
    ],
  };

  const jamie = {
    uid: '2000002',
    name: 'Jamie Rivera',
    courses: [
      course('5001', '07 English: Section 3', { q2: 88, q1: 90, sem: 89 }, [
        ...graded(['Grammar Check 5', 'Short Story Plan', 'Reading Log', 'Vocabulary Quiz', 'Grammar Check 6'], [90, 85, 88, 86, 92], 10),
        at(-5, { title: 'Poetry Analysis Essay', exception: 'missing', max: 25 }),
        at(0, { title: 'Independent Reading Log' }),
      ]),
      course('5002', '07 Math: Section 5', { q2: 71, q1: 78, sem: 75 }, [
        ...graded(['Ratios Practice', 'Proportions Quiz', 'Percent Worksheet', 'Unit 3 Test', 'Equations Practice'], [80, 68, 74, 65, 72]),
        at(-3, { title: 'Integers Homework', exception: 'missing', max: 10 }),
        at(1, { title: 'Unit 4 Quiz', kind: 'assessment' }),
      ]),
      course('5003', '07 Science: Section 2', { q2: 85, q1: 82, sem: 83 }, [
        ...graded(['Ecosystem Diagram', 'Food Web Quiz', 'Lab Safety', 'Plant Cell Lab', 'Energy Worksheet'], [84, 88, 100, 80, 85]),
        at(-2, { title: 'Field Notes', exception: 'missing', max: 15 }),
        at(0, { title: 'Lab: Density' }),
      ]),
      course('5004', '07 Social Studies: Section 1', { q2: 90, q1: 91, sem: 90 }, [
        ...graded(['Ancient Rome Map', 'Chapter 5 Quiz', 'Roman Republic Notes', 'Primary Source', 'Chapter 6 Quiz'], [92, 88, 90, 86, 94]),
        at(-1, { title: 'Aqueduct Model', note: PENDING, pending: true }),
      ]),
      course('5005', '07 Spanish: Section 4', { q2: 92, q1: 93, sem: 92 }, [
        ...graded(['Saludos Quiz', 'Family Tree', 'Numbers Practice', 'Vocabulario 3', 'Speaking Check'], [95, 90, 92, 88, 94]),
      ]),
      course('5006', '07 PE: Section 2', { q2: 96, q1: 97, sem: 96 }, [
        ...graded(['Mile Run', 'Fitness Log', 'Volleyball Skills', 'Fitness Log 2', 'Teamwork Reflection'], [95, 100, 92, 100, 95], 10),
      ]),
      course('5007', '07 Band: Section 1', { q2: 98, q1: 98, sem: 98 }, [
        ...graded(['Practice Log 1', 'Scales Check', 'Practice Log 2', 'Concert Piece Check', 'Practice Log 3'], [100, 95, 100, 98, 100], 10),
      ]),
      course('5008', '07 Technology: Section 3', { q2: 89, q1: 89, sem: 89 }, [
        ...graded(['Typing Test', 'Spreadsheet Basics', 'Slides Project', 'Internet Safety Quiz', 'Coding Intro'], [85, 90, 88, 92, 90]),
        at(2, { title: 'Digital Poster' }),
      ]),
      { id: '5009', title: 'House Group 1: Section 1', courseGrade: null, periods: [] },
    ],
  };

  // Teachers. Mr. Ortiz is a department admin on several classes, so those
  // show the "which teacher?" chooser.
  const teacher = {
    4001: 9301, 4002: 9302, 4003: 9401, 4004: 9402, 4005: 9301, 4006: 9001, 4007: 9401, 4008: 9302,
    5001: 9401, 5002: 9402, 5003: 9301, 5004: 9302, 5005: 9301, 5006: 9001, 5007: 9401, 5008: 9402,
  };
  const withDept = new Set(['4001', '4002', '4005', '5001', '5002', '5003']);
  function admins(courseId) {
    const t = teacher[courseId] || 9001;
    const list = withDept.has(String(courseId)) ? [9100, t] : [t];
    return list.map((uid) => ({ uid: String(uid), name: SHOWCASE_ADMINS[uid] }));
  }

  return {
    student: { name: sam.name, courses: sam.courses },
    parent: { children: [sam, jamie] },
    admins,
  };
}
