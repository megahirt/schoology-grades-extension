// names.js — tidy class names for display (pure, no browser APIs).
//
// Schools prefix section names with codes that are the same across a
// student's classes ("07 English", "07 Math"; "BPL American Literature",
// "BPL Government"). They make the list harder to read, so:
//   - a leading number token ("07 ") is always removed;
//   - a leading short all-caps code (2–4 letters, "BPL ") is removed when it
//     starts two or more of the child's classes. A code on one class only
//     ("US History", "SU Study Hall") is part of that class's name: kept.
// A name is never reduced to nothing. The original stays in `fullName`.

const NUMBER_PREFIX = /^\d+\s+(?=\S)/;
const CODE_PREFIX = /^([A-Z]{2,4})\s+(?=\S)/;

function stripNumber(name) {
  return String(name || '').replace(NUMBER_PREFIX, '');
}

// cleanCourseNames(courses) -> a copy of courses with tidier `name`s.
export function cleanCourseNames(courses) {
  const list = Array.isArray(courses) ? courses : [];
  const afterNumbers = list.map((c) => stripNumber(c && c.name));
  const codeCounts = new Map();
  for (const n of afterNumbers) {
    const m = n.match(CODE_PREFIX);
    if (m) codeCounts.set(m[1], (codeCounts.get(m[1]) || 0) + 1);
  }
  return list.map((c, i) => {
    let name = afterNumbers[i];
    const m = name.match(CODE_PREFIX);
    if (m && codeCounts.get(m[1]) >= 2) name = name.slice(m[0].length);
    name = name.trim() || String((c && c.name) || '');
    return c && name !== c.name ? { ...c, name, fullName: c.name } : c;
  });
}
