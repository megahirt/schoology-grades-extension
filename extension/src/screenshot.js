// screenshot.js — a picture of the whole dashboard for the clipboard.
//
// The browser's own capture only sees what's on screen, and the panel
// scrolls, so the dashboard draws itself instead: a copy of the view (the
// header without its buttons, the full body, the credit line) is laid out
// off screen at the dashboard's width, then rendered through an SVG
// <foreignObject> onto a canvas at 2× and turned into a PNG. Nothing leaves
// the browser; the image only goes to the clipboard.
//
// Pictures from other sites (Schoology profile pictures) can't be drawn
// into a canvas, so they're swapped for the initials. The extension's own
// images (Missing icon, NPC logo) are data: URLs and stay.

const SCALE = 2;

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A clean copy of the dashboard (no buttons, hover layers or dev footer).
function buildCopy(root) {
  const doc = root.ownerDocument;
  const copy = doc.createElement('div');
  copy.className = 'sgd sgd-shot';
  const head = root.querySelector('.head');
  if (head) {
    const h = head.cloneNode(true);
    for (const el of h.querySelectorAll('button, .tabs')) el.remove();
    copy.append(h);
  }
  const body = root.querySelector('.body');
  if (body) {
    const b = body.cloneNode(true);
    b.style.overflow = 'visible';
    b.style.height = 'auto';
    b.style.maxHeight = 'none';
    b.style.flex = 'none';
    for (const el of b.querySelectorAll('button.check-btn, .refreshing, .stale, .gc-hover, .gc-hit, .ring-tip, .chart-link')) el.remove();
    copy.append(b);
  }
  const credit = root.querySelector('.credit');
  if (credit) {
    const c = credit.cloneNode(true);
    for (const el of c.querySelectorAll('.feedback-link')) el.remove();
    // Drop the "·" left before the removed feedback link.
    const last = c.lastElementChild;
    if (last && last.textContent.trim() === '·') last.remove();
    copy.append(c);
  }
  for (const img of copy.querySelectorAll('img')) {
    if (img.getAttribute('src') && !img.getAttribute('src').startsWith('data:')) {
      const span = doc.createElement('span');
      span.className = img.className;
      span.textContent = img.dataset.initials || '';
      img.replaceWith(span);
    }
  }
  return copy;
}

// captureDashboard(root, css) -> Promise<Blob> (image/png).
export async function captureDashboard(root, css) {
  const doc = root.ownerDocument;
  const width = Math.round(root.getBoundingClientRect().width) || 437;
  const copy = buildCopy(root);
  // Lay it out off screen, next to the real view so the same styles apply.
  const holder = doc.createElement('div');
  holder.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${width}px; height: auto; pointer-events: none;`;
  copy.style.width = `${width}px`;
  holder.append(copy);
  root.parentNode.append(holder);
  let height;
  let xhtml;
  try {
    height = Math.ceil(copy.getBoundingClientRect().height);
    xhtml = new XMLSerializer().serializeToString(copy);
  } finally {
    holder.remove();
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#fff">` +
    `<style>${escapeXml(css)}</style>${xhtml}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = doc.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(SCALE, SCALE);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the image'))), 'image/png');
  });
}

// copyImage(blobPromise, win) -> true when the image is on the clipboard.
// The ClipboardItem gets the promise right away, so the click still counts
// as the user's gesture while the image is drawn (Safari needs this).
export async function copyImage(blobPromise, win) {
  const nav = win.navigator;
  if (!nav.clipboard || !win.ClipboardItem) throw new Error('This browser can’t copy images');
  try {
    await nav.clipboard.write([new win.ClipboardItem({ 'image/png': blobPromise })]);
  } catch (err) {
    // Older Chrome: ClipboardItem wants the finished Blob.
    const blob = await blobPromise;
    await nav.clipboard.write([new win.ClipboardItem({ 'image/png': blob })]);
  }
  return true;
}
