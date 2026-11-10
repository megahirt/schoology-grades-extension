// store-assets.mjs — `npm run store:assets`
//
// Makes the Chrome Web Store images in store/chrome/ from the promo-site
// screenshots (site/img/, made by `npm run site:screenshots` from made-up
// students) plus two promo tiles drawn here:
//   screenshot-1..5.png        1280×800 (the store's required size)
//   promo-small-440x280.png    small promo tile (required)
//   promo-marquee-1400x560.png marquee tile (optional)
// Colors follow the site brand (site/style.css --brand).
// Never use real student data: the repo is public and these images are
// committed.

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'site/img');
const OUT = path.join(ROOT, 'store/chrome');
mkdirSync(OUT, { recursive: true });

const SHOTS = ['desktop-hero', 'parent-jamie', 'student-sam', 'grade-chart', 'records'];
const dataUrl = (file) => `data:image/png;base64,${readFileSync(path.join(IMG, file)).toString('base64')}`;
const icon = readFileSync(path.join(IMG, 'icon.svg'), 'utf8');
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const page0 = (w, h, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; font-family: ${FONT}; }
  ${css}</style></head><body>${body}</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });

// A fresh page at the exact size for each image (resizing one page between
// captures can leave stale paint in the shot).
async function render(name, w, h, html) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: path.join(OUT, name) });
  await page.close();
  console.log(`store/chrome/${name}`);
}

// Screenshots: the 16:10 site shots, scaled down to exactly 1280×800.
for (const [i, name] of SHOTS.entries()) {
  await render(`screenshot-${i + 1}.png`, 1280, 800,
    page0(1280, 800, `<img src="${dataUrl(`${name}.png`)}" style="display:block;width:1280px;height:800px">`));
}

// Small promo tile: icon, name, one line.
await render('promo-small-440x280.png', 440, 280, page0(440, 280, `
  <div class="tile">
    <div class="icon">${icon}</div>
    <div class="name">Grades Dashboard</div>
    <div class="for">for Schoology</div>
    <div class="line">What's due, what's missing, how it's going</div>
  </div>`, `
  body { background: #4f7356; color: #fff; }
  .tile { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .icon svg { width: 64px; height: 64px; display: block; border-radius: 14px; box-shadow: 0 0 0 3px rgba(255,255,255,0.9); }
  .name { font-size: 36px; font-weight: 700; margin-top: 18px; letter-spacing: -0.5px; }
  .for { font-size: 20px; font-weight: 500; opacity: 0.9; margin-top: 2px; }
  .line { font-size: 15px; opacity: 0.85; margin-top: 14px; }`));

// Marquee tile: words on the left, the phone shot on the right.
await render('promo-marquee-1400x560.png', 1400, 560, page0(1400, 560, `
  <div class="words">
    <div class="icon">${icon}</div>
    <div class="name">Grades Dashboard <span>for Schoology</span></div>
    <div class="line">Know what's due, what's missing, and how grades are going.</div>
    <div class="small">For parents and students · Free · Everything stays on your device</div>
  </div>
  <img class="phone" src="${dataUrl('phone-parent-sam.png')}">`, `
  body { background: linear-gradient(120deg, #4f7356, #3d5a43); color: #fff; position: relative; }
  .words { position: absolute; left: 90px; top: 0; bottom: 0; width: 860px; display: flex; flex-direction: column; justify-content: center; }
  .icon svg { width: 72px; height: 72px; display: block; border-radius: 16px; box-shadow: 0 0 0 3px rgba(255,255,255,0.9); }
  .name { font-size: 52px; font-weight: 700; letter-spacing: -1px; margin-top: 26px; white-space: nowrap; }
  .name span { font-weight: 500; opacity: 0.9; }
  .line { font-size: 26px; margin-top: 14px; opacity: 0.95; }
  .small { font-size: 18px; margin-top: 22px; opacity: 0.8; }
  .phone { position: absolute; right: 110px; top: 40px; width: 300px; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.35)); }`));

await browser.close();
