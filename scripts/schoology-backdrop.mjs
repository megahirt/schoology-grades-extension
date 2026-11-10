// schoology-backdrop.mjs — a made-up Schoology-style course grades page,
// drawn behind the dashboard for the promo site's hero screenshot so people
// see where the panel sits.
//
// Everything on it comes from the showcase data (test/mock-server/showcase.js):
// Sam Rivera's Biology class. The NPC logo is allowed; there is no Schoology
// logo and no real student, photo or grade.

import { readFileSync } from 'node:fs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const GREEN = '#2f7d0f';
const LINK = '#2266a8';

function pct(items) {
  const g = items.filter((i) => typeof i.score === 'number');
  const max = g.reduce((s, i) => s + i.max, 0);
  return max ? Math.round((100 * g.reduce((s, i) => s + i.score, 0)) / max) : null;
}

const chev = (open) =>
  `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style="flex:none;color:#8a96a3"><path d="${open ? 'M3 5l4 4 4-4' : 'M5 3l4 4-4 4'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function periodRow(depth, title, weight, grade, open) {
  return `<div class="row period" style="padding-left:${depth * 38}px">
    <div class="name">${chev(open)}<span class="ptitle">${esc(title)}</span>${weight ? `<span class="weight">(${weight})</span>` : ''}</div>
    <div class="grade">${grade == null ? '<span class="dash">–</span>' : `<b>${grade}%</b>`}</div></div>`;
}

function itemRow(item) {
  const score = typeof item.score === 'number'
    ? `<b>${item.score}</b>/ ${item.max}`
    : `<span class="dash">–</span>/ ${item.max ?? 20}`;
  return `<div class="row item"><div class="name"><span class="ititle">${esc(item.title)}</span><span class="due">${esc(item.due)}</span></div><div class="grade">${score}</div></div>`;
}

// course: one course from buildShowcase() (periods S1, Q1, Q2).
export function schoologyGradesPage(course, studentName, initials) {
  const npc = `data:image/png;base64,${readFileSync(new URL('../extension/icons/npc_icon_tiny.png', import.meta.url)).toString('base64')}`;
  const [s1, q1, q2] = course.periods;
  const cats = [
    ['Assignments', q2.items.filter((i) => i.kind !== 'assessment')],
    ['Quizzes', q2.items.filter((i) => i.kind === 'assessment')],
  ].filter(([, items]) => items.length);
  const title = course.title;

  const tree = [
    periodRow(0, s1.title, '50%', s1.grade, true),
    periodRow(1, q1.title, '45%', q1.grade, false),
    periodRow(1, q2.title, '45%', q2.grade, true),
    ...cats.flatMap(([name, items]) => [
      `<div class="row cat" style="padding-left:76px"><div class="name">${chev(true)}<span class="ptitle">${name}</span></div><div class="grade"><b>${pct(items)}%</b></div></div>`,
      `<div class="items">${items.map(itemRow).join('')}</div>`,
    ]),
    periodRow(1, 'Exam 1', '10%', null, false),
    periodRow(0, 'Semester 2', '50%', null, false),
  ].join('');

  const menu = [
    ['Materials', '#9aa5b1'], ['Updates', '#9aa5b1'], ['Grades', null], ['Members', '#9aa5b1'],
  ].map(([name, c]) => `<div class="mi${c ? '' : ' on'}">${c
    ? `<span class="mic" style="background:${c}"></span>`
    : '<span class="bars"><i style="height:9px;background:#e8a33d"></i><i style="height:16px;background:#d9534f"></i><i style="height:12px;background:#3d8fd6"></i></span>'}${name}</div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #333; background: #fff; font-size: 14px; }
  header { height: 62px; display: flex; align-items: center; padding: 0 26px; gap: 34px; box-shadow: 0 1px 4px rgba(0,0,0,.12); position: relative; z-index: 1; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 44px; height: 44px; }
  .brand .w1 { font-weight: 800; font-size: 19px; letter-spacing: .3px; color: #1e5aa8; line-height: 1; }
  .brand .w2 { font-weight: 700; font-size: 9.5px; letter-spacing: .9px; color: #1e5aa8; }
  nav { display: flex; gap: 30px; font-size: 15px; color: #333; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 26px; font-size: 15px; }
  .avatar { width: 30px; height: 30px; border-radius: 50%; background: #2f6f4e; color: #fff; font-size: 12px; font-weight: 600; display: grid; place-items: center; }
  .layout { display: flex; min-height: calc(100vh - 62px); }
  aside { width: 196px; flex: none; padding: 16px 0 0 16px; border-right: 1px solid #dde1e5; }
  .cimg { width: 164px; height: 82px; border-radius: 2px; background: linear-gradient(135deg, #2a7fd4, #1667be); position: relative; overflow: hidden; }
  .cimg::before { content: ""; position: absolute; left: 22px; top: 18px; width: 54px; height: 54px; border-radius: 50%; background: rgba(255,255,255,.18); }
  .cimg::after { content: ""; position: absolute; right: 18px; top: 14px; width: 66px; height: 50px; border-radius: 3px; background: #fff; transform: rotate(-8deg); box-shadow: inset 0 0 0 6px #fff, inset 0 -18px 0 #e9eef5; }
  .mi { display: flex; align-items: center; gap: 10px; height: 31px; padding-left: 6px; color: #555; font-size: 13.5px; }
  .mi.on { background: #fff; border: 1px solid #ccd2d8; border-right: 0; font-weight: 700; color: #222; margin-right: -1px; }
  .mi:first-of-type { margin-top: 12px; }
  .mic { width: 18px; height: 16px; border-radius: 2px; opacity: .55; }
  .bars { display: inline-flex; align-items: flex-end; gap: 1px; width: 18px; height: 16px; }
  .bars i { width: 5px; display: block; }
  .info { margin: 18px 14px 0 4px; font-size: 12.5px; line-height: 1.45; }
  .info h4 { margin: 0 0 6px; font-size: 13px; padding-bottom: 6px; border-bottom: 1px solid #dde1e5; }
  .info .gp { color: ${LINK}; }
  main { flex: 1; min-width: 0; }
  .viewing { background: #f2f2f2; border-bottom: 1px solid #ddd; padding: 11px 20px; font-size: 13px; }
  .course { padding: 18px 20px 0; }
  .crumb, .school { color: ${LINK}; font-size: 13px; }
  h1 { margin: 6px 0 6px; font-size: 21px; font-weight: 600; color: #222; }
  .tree { margin-top: 18px; border-top: 1px solid #dde1e5; padding-top: 14px; }
  .row { display: grid; grid-template-columns: 1fr 120px; align-items: center; border-bottom: 1px solid #e3e6e9; min-height: 42px; }
  .row .name { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .ptitle { color: ${LINK}; font-weight: 600; font-size: 14px; white-space: nowrap; }
  .weight { color: #666; font-size: 12.5px; margin-left: 6px; }
  .grade b { color: ${GREEN}; font-weight: 700; }
  .grade { font-size: 13.5px; color: #555; }
  .dash { color: #666; }
  .items { padding-left: 99px; }
  .row.item { border-bottom: 1px dotted #d9dde1; min-height: 37px; }
  .ititle { color: ${LINK}; font-size: 13.5px; white-space: nowrap; }
  .due { color: #666; font-size: 13px; margin-left: 14px; white-space: nowrap; }
  </style></head><body>
  <header>
    <div class="brand"><img src="${npc}" alt=""><div><div class="w1">NORTHPOINTE</div><div class="w2">CHRISTIAN SCHOOLS</div></div></div>
    <nav><span>Courses ▾</span><span>Groups ▾</span><span>Grade Report</span></nav>
    <div class="right">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="2" y="4" width="18" height="16" rx="2" fill="none" stroke="#222" stroke-width="2"/><rect x="2" y="4" width="18" height="5" fill="#1aa3d9"/><path d="M7 2v4M15 2v4" stroke="#222" stroke-width="2"/></svg>
      <span style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc(initials)}</span>${esc(studentName)} ▾</span>
    </div>
  </header>
  <div class="layout">
    <aside>
      <div class="cimg"></div>
      ${menu}
      <div class="info"><h4>Information</h4><div class="gp">Grading periods</div>${esc(s1.title)}, ${esc(q1.title)}, ${esc(q2.title)}, Exam 1, Semester 2</div>
    </aside>
    <main>
      <div class="viewing">You are viewing ${esc(studentName)}'s course</div>
      <div class="course">
        <div class="crumb">${esc(title)}</div>
        <h1>${esc(title)}</h1>
        <div class="school">High School</div>
        <div class="tree">${tree}</div>
      </div>
    </main>
  </div>
  </body></html>`;
}
