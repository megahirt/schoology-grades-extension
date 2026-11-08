// grade-chart.js — draws a class's grade over time (from grade-history.js)
// as an inline SVG string. Time runs left to right from the first day of
// school to today; percent runs bottom to top. Each graded assignment is a
// dot (green at/above the passing grade, red below); the line is the
// class grade at each moment, one smooth stroke joining every grading
// period; a dashed line marks the passing grade. Hover is handled by the
// dashboard (see chartHover) so the SVG itself stays plain markup.

export const CHART = { W: 320, H: 156, L: 30, R: 314, T: 10, B: 132 };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDay(t) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function chartScale(history) {
  const values = [...history.points.map((p) => p.pct), ...history.segments.flatMap((s) => s.line.map((p) => p.grade))];
  const lo = Math.max(0, Math.min(40, Math.floor((Math.min(...values, 75) - 5) / 10) * 10));
  const hi = Math.max(100, Math.ceil((Math.max(...values, 100)) / 10) * 10);
  const { L, R, T, B } = CHART;
  const span = Math.max(1, history.end - history.start);
  return {
    lo,
    hi,
    x: (t) => L + ((Math.min(Math.max(t, history.start), history.end) - history.start) / span) * (R - L),
    y: (v) => B - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (B - T),
  };
}

// smoothPath([[x, y], …]) -> an SVG path through every point, smoothed with
// monotone cubic interpolation (Fritsch–Carlson): the curve passes through
// each grade and never overshoots between them, so it can't invent a peak
// or dip that wasn't there.
export function smoothPath(pts) {
  const n = pts.length;
  if (!n) return '';
  const f = (v) => v.toFixed(1);
  if (n === 1) return `M${f(pts[0][0])},${f(pts[0][1])}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${f(x0 + h)},${f(y0 + t[i] * h)} ${f(x1 - h)},${f(y1 - t[i + 1] * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

// Every point of the class-grade line, all grading periods joined in time
// order, so the line stays connected from the first grade to the last.
export function linePoints(history) {
  return history.segments.flatMap((seg) => seg.line).sort((a, b) => a.t - b.t);
}

// renderGradeChart(history, { threshold, name }) -> '<svg …>' (or '' when
// there is nothing to draw).
export function renderGradeChart(history, { threshold = 75, name = 'Class' } = {}) {
  if (!history || !history.points.length) return '';
  const { W, H, L, R, T, B } = CHART;
  const s = chartScale(history);
  const parts = [];
  // Grid: passing line, 100% and the bottom of the scale.
  const marks = [...new Set([s.lo, 50, threshold, 100].filter((v) => v >= s.lo && v <= s.hi))];
  for (const v of marks) {
    const yy = s.y(v).toFixed(1);
    const isPass = v === threshold;
    parts.push(isPass
      ? `<line x1="${L}" x2="${R}" y1="${yy}" y2="${yy}" class="gc-pass"/>`
      : `<line x1="${L}" x2="${R}" y1="${yy}" y2="${yy}" class="gc-grid"/>`);
    parts.push(`<text x="${L - 5}" y="${(Number(yy) + 3).toFixed(1)}" class="gc-ylab${isPass ? ' pass' : ''}">${v}%</text>`);
  }
  // Month ticks.
  const d = new Date(history.start);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  for (; d.getTime() <= history.end; d.setMonth(d.getMonth() + 1)) {
    const xx = s.x(d.getTime()).toFixed(1);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${B}" y2="${B + 3}" class="gc-tick"/>`);
    parts.push(`<text x="${xx}" y="${B + 14}" class="gc-xlab">${d.toLocaleDateString(undefined, { month: 'short' })}</text>`);
  }
  // Class grade line: one smooth, connected stroke through every point.
  const all = linePoints(history);
  if (all.length > 1) parts.push(`<path d="${smoothPath(all.map((p) => [s.x(p.t), s.y(p.grade)]))}" class="gc-line"/>`);
  else if (all.length === 1) parts.push(`<circle cx="${s.x(all[0].t).toFixed(1)}" cy="${s.y(all[0].grade).toFixed(1)}" r="2.5" class="gc-line-dot"/>`);
  // Assignment dots.
  for (const p of history.points) {
    const cls = p.pct >= threshold ? 'gc-dot ok' : 'gc-dot low';
    parts.push(`<circle cx="${s.x(p.t).toFixed(1)}" cy="${s.y(p.pct).toFixed(1)}" r="3.5" class="${cls}"><title>${esc(p.title)} · ${fmtDay(p.t)} · ${Math.round(p.pct)}%</title></circle>`);
  }
  // Hover layer (positioned by chartHover) and the area that receives it.
  parts.push('<g class="gc-hover" visibility="hidden"><line class="gc-hline" y1="' + T + '" y2="' + B + '"/><circle class="gc-hdot" r="4.5"/>' +
    '<rect class="gc-tipbg" rx="5" height="18"/><text class="gc-tip" y="0"></text></g>');
  parts.push(`<rect class="gc-hit" x="${L}" y="${T}" width="${R - L}" height="${B - T}"/>`);
  const label = `${name}: grade over time since ${fmtDay(history.start)}, with assignment scores and the ${threshold}% passing line`;
  return `<svg class="gchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
}

// chartHover(svg, history, clientX): show the class grade at the point on
// the line nearest the pointer (desktop hover). Returns false when nothing
// is near.
export function chartHover(svg, history, clientX) {
  const g = svg.querySelector('.gc-hover');
  if (!g) return false;
  const all = history.segments.flatMap((seg) => seg.line.map((p) => ({ ...p, label: seg.label })));
  if (!all.length) return false;
  const box = svg.getBoundingClientRect();
  const vx = ((clientX - box.left) / box.width) * CHART.W;
  const s = chartScale(history);
  let best = all[0];
  for (const p of all) if (Math.abs(s.x(p.t) - vx) < Math.abs(s.x(best.t) - vx)) best = p;
  const bx = s.x(best.t);
  const by = s.y(best.grade);
  g.querySelector('.gc-hline').setAttribute('x1', bx);
  g.querySelector('.gc-hline').setAttribute('x2', bx);
  g.querySelector('.gc-hdot').setAttribute('cx', bx);
  g.querySelector('.gc-hdot').setAttribute('cy', by);
  const text = g.querySelector('.gc-tip');
  text.textContent = `${fmtDay(best.t)} · ${best.label} ${best.grade.toFixed(1)}%`;
  const width = Math.min(CHART.W - 8, text.textContent.length * 5.6 + 12);
  const left = bx + width + 8 > CHART.W ? bx - width - 6 : bx + 6;
  const bg = g.querySelector('.gc-tipbg');
  bg.setAttribute('x', left);
  bg.setAttribute('y', CHART.T - 8);
  bg.setAttribute('width', width);
  text.setAttribute('x', left + 6);
  text.setAttribute('y', CHART.T + 5);
  g.setAttribute('visibility', 'visible');
  return true;
}

export function chartUnhover(svg) {
  const g = svg && svg.querySelector('.gc-hover');
  if (g) g.setAttribute('visibility', 'hidden');
}
