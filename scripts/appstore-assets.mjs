// appstore-assets.mjs — `npm run appstore:assets`
//
// Makes the iPhone and iPad images for App Store Connect, three per set.
// In store/safari/iphone/:
//   screenshot-1..3.png      "iPhone with Dynamic Island (medium display)"
//                            screenshots, 1179×2556 portrait
//   header-1..3.png          Header creative asset, 3840×1646 (21:9); the
//                            words sit inside Apple's art safe area
//                            (1646×661 at x 1097, y 493)
//   search-results-1..3.png  Search Results creative asset, 3840×2560 (3:2);
//                            safe area 2168×1030 at x 836, y 765
// In store/safari/ipad/:
//   screenshot-1..3.png      "iPad 13-inch display" screenshots, 2732×2048
//                            landscape (the app runs on iPad, so App Store
//                            Connect asks for these too)
// Sizes are from Apple's screenshot and creative-asset specifications as
// read on 2026-11-15; check them in App Store Connect if an upload is
// refused. No image has an alpha channel (Apple rejects those).
//
// It runs scripts/site-screenshots.mjs at 3x into a temporary folder for
// the captures (made-up students, the Rivera family, pinned date), then
// draws each image in Chromium. The phone and the tablet are drawn in CSS:
// no Apple artwork. An iPad shows Schoology's desktop page, so its
// screenshots use the desktop captures. Never use real student data: these images are committed.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store/safari');
for (const dir of ['iphone', 'ipad']) mkdirSync(path.join(OUT, dir), { recursive: true });

// Phone captures: reuse a folder (APPSTORE_SHOTS=dir) or make them now.
let shots = process.env.APPSTORE_SHOTS;
let made = null;
if (!shots) {
  made = mkdtempSync(path.join(os.tmpdir(), 'sgd-appstore-'));
  shots = made;
  execFileSync('node', [path.join(ROOT, 'scripts/site-screenshots.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, SITE_SHOTS_OUT: shots, SITE_SHOTS_SCALE: '3', SITE_SHOTS_KEEP_RAW: '1' },
  });
}
const raw = (name) => `data:image/png;base64,${readFileSync(path.join(shots, `phone-${name}-raw.png`)).toString('base64')}`;
const desk = (name) => `data:image/png;base64,${readFileSync(path.join(shots, `${name}.png`)).toString('base64')}`;
const DESK = { jamie: desk('parent-jamie'), sam: desk('parent-sam'), student: desk('student-sam') };
const SHOT = { jamie: raw('parent-jamie'), sam: raw('parent-sam'), student: raw('student-sam') };
const icon = readFileSync(path.join(ROOT, 'site/img/icon.svg'), 'utf8');

// Single quotes inside: the list is also used in style="…" attributes.
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
const GREEN = '#4f7356'; // site/style.css --brand
const THEMES = {
  green: { bg: `linear-gradient(160deg, #5b8263, ${GREEN} 45%, #3d5a43)`, fg: '#fff', soft: 'rgba(255,255,255,0.86)' },
  light: { bg: 'linear-gradient(160deg, #f6f8f4, #e6ede4)', fg: '#1f2d23', soft: '#4a5a4e' },
  deep: { bg: 'linear-gradient(160deg, #2f4735, #1f3024)', fg: '#fff', soft: 'rgba(255,255,255,0.82)' },
};

// A phone drawn in CSS around a capture. `w` is the screen's width in px;
// the capture is 390×790 CSS px under a 54 px status bar (as on the site).
function phone(src, w, style = '') {
  const k = w / 390;
  const px = (n) => `${Math.round(n * k)}px`;
  return `<div class="phone" style="padding:${px(14)};border-radius:${px(62)};background:#1b1d22;box-shadow:inset 0 0 0 ${px(2)} #3a3d44, 0 ${px(24)} ${px(60)} rgba(0,0,0,0.35);${style}">
    <div style="position:relative;border-radius:${px(48)};overflow:hidden;width:${px(390)};height:${px(844)};background:#fff">
      <div style="height:${px(54)};background:#fff;font:600 ${px(16)} ${FONT};color:#111;display:flex;align-items:center;padding:${px(8)} 0 0 ${px(50)};box-sizing:border-box">4:42</div>
      <img src="${src}" style="display:block;width:${px(390)};height:${px(790)}">
      <div style="position:absolute;top:${px(11)};left:50%;transform:translateX(-50%);width:${px(125)};height:${px(36)};border-radius:${px(20)};background:#000"></div>
    </div>
  </div>`;
}

const page0 = (w, h, theme, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; font-family: ${FONT}; }
  body { background: ${theme.bg}; color: ${theme.fg}; position: relative; }
  .phone, .tablet { position: absolute; box-sizing: content-box; }
  .soft { color: ${theme.soft}; }
  ${css}</style></head><body>${body}</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });
async function render(name, w, h, html) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: path.join(OUT, name) });
  await page.close();
  console.log(`store/safari/${name}`);
}

// ---- Screenshots: 1179×2556. A headline, then the phone. ----
const SCREENS = [
  ['green', SHOT.jamie, 'See what’s missing', 'Missing work and low grades for each child'],
  ['light', SHOT.sam, 'Know what’s due next', 'Today, tomorrow and this week, in one list'],
  ['deep', SHOT.student, 'Students see what to do first', 'Their own view, with this week’s progress'],
];
for (const [i, [theme, src, head, sub]] of SCREENS.entries()) {
  const W = 1179, H = 2556, PW = 840; // screen 840 wide -> phone 900 wide, 1878 tall
  await render(`iphone/screenshot-${i + 1}.png`, W, H, page0(W, H, THEMES[theme], `
    <div class="words"><div class="head">${head}</div><div class="sub soft">${sub}</div></div>
    ${phone(src, PW, `left:${(W - PW - 60) / 2}px;top:560px`)}`, `
    .words { position: absolute; left: 80px; right: 80px; top: 170px; text-align: center; }
    .head { font-size: 104px; font-weight: 700; letter-spacing: -2px; line-height: 1.08; }
    .sub { font-size: 50px; font-weight: 500; margin-top: 30px; line-height: 1.25; }`));
}

// ---- iPad screenshots: 2732×2048 landscape. A headline, then a tablet
// around a desktop capture (1280×800 CSS px). ----
for (const [i, [theme, , head, sub]] of SCREENS.entries()) {
  const W = 2732, H = 2048, SW = 2080, SH = 1300, BEZEL = 40;
  const src = [DESK.jamie, DESK.sam, DESK.student][i];
  await render(`ipad/screenshot-${i + 1}.png`, W, H, page0(W, H, THEMES[theme], `
    <div class="words"><div class="head">${head}</div><div class="sub soft">${sub}</div></div>
    <div class="tablet" style="left:${(W - SW - 2 * BEZEL) / 2}px;top:500px;padding:${BEZEL}px;border-radius:70px;background:#1b1d22;box-shadow:inset 0 0 0 4px #3a3d44, 0 40px 100px rgba(0,0,0,0.35)">
      <img src="${src}" style="display:block;width:${SW}px;height:${SH}px;border-radius:32px">
    </div>`, `
    .words { position: absolute; left: 120px; right: 120px; top: 120px; text-align: center; }
    .head { font-size: 120px; font-weight: 700; letter-spacing: -2px; line-height: 1.08; }
    .sub { font-size: 58px; font-weight: 500; margin-top: 28px; line-height: 1.25; }`));
}

// The name, icon and one line: everything that must stay readable. `box`
// is Apple's art safe area; the block is centred inside it.
function brand(box, line, small, size) {
  return `<div class="brand" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">
    <div class="icon">${icon}</div>
    <div class="name" style="font-size:${size}px">Grades Dashboard <span>for Schoology</span></div>
    <div class="line" style="font-size:${Math.round(size * 0.5)}px">${line}</div>
    <div class="small soft" style="font-size:${Math.round(size * 0.36)}px">${small}</div>
  </div>`;
}
const BRAND_CSS = (iconPx) => `
  .brand { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; box-sizing: border-box; }
  .icon svg { width: ${iconPx}px; height: ${iconPx}px; display: block; border-radius: ${Math.round(iconPx * 0.22)}px; box-shadow: 0 0 0 ${Math.round(iconPx * 0.04)}px rgba(255,255,255,0.9), 0 12px 40px rgba(0,0,0,0.2); }
  .name { font-weight: 700; letter-spacing: -2px; margin-top: 0.35em; white-space: nowrap; line-height: 1.1; }
  .name span { font-weight: 500; opacity: 0.9; }
  .line { font-weight: 500; margin-top: 0.5em; line-height: 1.25; }
  .small { margin-top: 0.9em; }`;

const LINES = [
  ['Know what’s due, what’s missing, and how grades are going.', 'For parents and students · Free · Everything stays on your device'],
  ['Missing work, due dates and grades on one dashboard.', 'A Safari extension for iPhone and Mac · Free'],
  ['What’s due, what’s missing, how it’s going.', 'No account, no ads · Everything stays on your device'],
];
const SETS = [
  ['green', SHOT.jamie, SHOT.sam],
  ['light', SHOT.sam, SHOT.student],
  ['deep', SHOT.student, SHOT.jamie],
];

// ---- Header: 3840×1646, safe area 1646×661 at (1097, 493). The phones
// sit outside it, left and right, running off the bottom edge. ----
for (const [i, [theme, left, right]] of SETS.entries()) {
  const W = 3840, H = 1646, PW = 640;
  await render(`iphone/header-${i + 1}.png`, W, H, page0(W, H, THEMES[theme], `
    ${phone(left, PW, `left:250px;top:150px;transform:rotate(-4deg)`)}
    ${phone(right, PW, `left:${W - 250 - PW - 46}px;top:150px;transform:rotate(4deg)`)}
    ${brand({ x: 1097, y: 493, w: 1646, h: 661 }, LINES[i][0], LINES[i][1], 112)}`, BRAND_CSS(150)));
}

// ---- Search Results: 3840×2560, safe area 2168×1030 at (836, 765). ----
for (const [i, [theme, left, right]] of SETS.entries()) {
  const W = 3840, H = 2560, PW = 620;
  await render(`iphone/search-results-${i + 1}.png`, W, H, page0(W, H, THEMES[theme], `
    ${phone(left, PW, `left:90px;top:560px;transform:rotate(-4deg)`)}
    ${phone(right, PW, `left:${W - 90 - PW - 44}px;top:560px;transform:rotate(4deg)`)}
    ${brand({ x: 836, y: 765, w: 2168, h: 1030 }, LINES[i][0], LINES[i][1], 150)}`, BRAND_CSS(230)));
}

await browser.close();
if (made) rmSync(made, { recursive: true, force: true });
