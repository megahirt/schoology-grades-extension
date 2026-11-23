#!/usr/bin/env node
// holiday-icons.mjs — `npm run holiday:icons`
//
// Draws the holiday versions of the Grades Dashboard icon into
// extension/icons/holidays/<slug>.webp (drawn as SVG, saved as a transparent
// WebP, quality 90, by Chromium, so the lighting and brush texture are baked
// in and every browser shows the same picture). The files are web-accessible
// (manifest.json), so the in-page panel loads today's one directly. Each is the ordinary green tile
// (site/img/icon.svg, untouched) with something on, around or beside it: a
// hat sitting on top, lights wrapped around, a pumpkin next to it.
//
// The style is painted and lit, not flat: every shape is shaded with a
// gradient, one light comes from the upper left (highlights on that side,
// shade on the other), each prop casts a soft shadow onto what's behind it
// and onto the ground, and a light brush grain sits over the props.
//
// Nothing is drawn on the tile's face: hats sit on top of it (there's
// headroom above the tile in every icon), everything else stands beside it.
// A picture is at most three tiles wide (384), so it still fits the
// dashboard's header and the settings page.
//
//   node scripts/holiday-icons.mjs [--gallery=<file.html>]
// --gallery also writes a review page with every icon at full size and at the
// sizes it's shown at.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'extension/icons/holidays');
// The tile is 128 square. Above it is TOP of headroom, the same in every
// icon, so hats sit on top of the tile and the tile is the same size in
// every picture. A picture is at most three tiles wide.
const TILE_H = 128;
const TOP = 48;
const H = TILE_H + TOP;
const MAX_W = 3 * TILE_H;

// The tile: everything inside icon.svg's <svg>, unchanged.
const ICON = readFileSync(path.join(ROOT, 'site/img/icon.svg'), 'utf8');
const TILE = ICON.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();

const f = (n) => (Math.round(n * 10) / 10).toString();

// Seeded random, so every run draws the same pictures.
let seed = 1;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const jit = (n) => (rnd() - 0.5) * 2 * n;

// ---------------------------------------------------------------- shading
// Gradients are made on demand from one base colour: lighter towards the
// light (upper left), darker away from it. Each icon gets only the ones it uses.
let defs = new Map();
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(hex, to, t) {
  const a = rgb(hex); const b = rgb(to);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const lighter = (hex, t = 0.45) => mix(hex, '#ffffff', t);
const darker = (hex, t = 0.42) => mix(hex, '#000000', t);
function grad(kind, hex) {
  const id = `${kind}${hex.slice(1)}`;
  if (!defs.has(id)) {
    const stops = `<stop offset="0" stop-color="${lighter(hex)}"/><stop offset="0.5" stop-color="${hex}"/><stop offset="1" stop-color="${darker(hex)}"/>`;
    defs.set(id, {
      L: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`,
      V: `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`,
      // Across a round thing (a pole, a candle, a pot): light left of centre.
      C: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${darker(hex, 0.25)}"/><stop offset="0.35" stop-color="${lighter(hex, 0.35)}"/><stop offset="0.6" stop-color="${hex}"/><stop offset="1" stop-color="${darker(hex, 0.45)}"/></linearGradient>`,
      R: `<radialGradient id="${id}" cx="0.36" cy="0.3" r="0.85"><stop offset="0" stop-color="${lighter(hex, 0.55)}"/><stop offset="0.45" stop-color="${hex}"/><stop offset="1" stop-color="${darker(hex)}"/></radialGradient>`,
    }[kind]);
  }
  return `url(#${id})`;
}
const L = (hex) => grad('L', hex); // lit diagonally
const V = (hex) => grad('V', hex); // lit from above
const C = (hex) => grad('C', hex); // a cylinder, lit from the left
const R = (hex) => grad('R', hex); // a rounded thing, highlight upper left

// A fine darker edge so overlapping shapes read separately (not an outline).
const E = 'stroke="#2a1d14" stroke-opacity="0.3" stroke-width="0.9" stroke-linejoin="round"';

const FILTERS = `
<filter id="paint" x="-15%" y="-15%" width="130%" height="130%">
  <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.1" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="9" result="g"/>
  <feColorMatrix in="g" type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.07  0 0 0 0 0.05  0 0 0 0.22 -0.06" result="ga"/>
  <feComposite in="ga" in2="d" operator="in" result="gr"/>
  <feMerge><feMergeNode in="d"/><feMergeNode in="gr"/></feMerge>
</filter>
<filter id="lit" x="-25%" y="-25%" width="160%" height="160%" color-interpolation-filters="sRGB">
  <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lum"/>
  <feComposite in="lum" in2="SourceAlpha" operator="in" result="lumIn"/>
  <feGaussianBlur in="lumIn" stdDeviation="0.9" result="bump"/>
  <feDiffuseLighting in="bump" surfaceScale="3" diffuseConstant="1.3" lighting-color="#ffffff" result="diff"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting>
  <feComposite in="SourceGraphic" in2="diff" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="shaded"/>
  <feSpecularLighting in="bump" surfaceScale="3" specularConstant="0.45" specularExponent="26" lighting-color="#fff8ec" result="spec"><feDistantLight azimuth="225" elevation="52"/></feSpecularLighting>
  <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
  <feComposite in="shaded" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.65" k4="0" result="litOut"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="sb"/>
  <feOffset in="sb" dx="2.2" dy="2.8" result="so"/>
  <feColorMatrix in="so" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.45 0" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="litOut"/></feMerge>
</filter>
<filter id="soft" x="-40%" y="-120%" width="180%" height="340%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter>
<filter id="blur1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.7"/></filter>`;

// One prop, lit and casting its shadow.
const lit = (s) => `<g filter="url(#lit)">${s}</g>`;
// A soft shadow on the ground (y = 124) under something standing there; the
// light is upper left, so it falls a little to the right.
const ground = (cx, rx, op = 0.3) => `<ellipse cx="${f(cx + rx * 0.18)}" cy="124.5" rx="${f(rx)}" ry="4" fill="#1f2933" opacity="${op}" filter="url(#soft)"/>`;
// A soft light around something that glows (a flame, a bulb, a firework).
const glowAround = (s, op = 0.8) => `<g filter="url(#glow)" opacity="${op}">${s}</g>`;

// ---------------------------------------------------------------- helpers
const RED = '#d23a3a';
const GOLD = '#f0b530';
const WHITE = '#f7f5f0';
const BLUE = '#2f5fb3';
const GREEN = '#3c8a45';

function starPts(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${f(cx + rr * Math.cos(a))},${f(cy + rr * Math.sin(a))}`);
  }
  return pts.join(' ');
}
const star = (cx, cy, r, hex) => `<polygon points="${starPts(cx, cy, r)}" fill="${R(hex)}" ${E}/>`;

// A small US flag rippling in the wind, top-left at (x, y), w wide.
function usFlag(x, y, w) {
  const h = w * 0.62;
  const sh = h / 7;
  const wave = (yy) => `M${x},${f(yy)} Q${f(x + w * 0.25)},${f(yy - 3)} ${f(x + w * 0.5)},${f(yy)} T${f(x + w)},${f(yy)}`;
  let s = `<clipPath id="flagclip${x}"><path d="${wave(y)} V${f(y + h)} Q${f(x + w * 0.75)},${f(y + h + 3)} ${f(x + w * 0.5)},${f(y + h)} T${x},${f(y + h)} Z"/></clipPath>`;
  s += `<g clip-path="url(#flagclip${x})"><rect x="${x}" y="${y - 4}" width="${w}" height="${f(h + 8)}" fill="${WHITE}"/>`;
  for (let i = 0; i < 7; i += 2) s += `<rect x="${x}" y="${f(y - 4 + i * sh + 4)}" width="${w}" height="${f(sh)}" fill="${RED}"/>`;
  s += `<rect x="${x}" y="${y - 4}" width="${f(w * 0.42)}" height="${f(sh * 4 + 4)}" fill="#24467f"/>`;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) s += `<circle cx="${f(x + w * 0.08 + c * w * 0.13)}" cy="${f(y + sh * 0.9 + r * sh * 1.9)}" r="${f(w * 0.028)}" fill="#ffffff"/>`;
  // Folds: light and shade across the cloth.
  s += `<rect x="${x}" y="${y - 4}" width="${w}" height="${f(h + 8)}" fill="url(#folds)"/></g>`;
  if (!defs.has('folds')) defs.set('folds', '<linearGradient id="folds" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.25"/><stop offset="0.25" stop-color="#000" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.75" stop-color="#000" stop-opacity="0.2"/><stop offset="1" stop-color="#fff" stop-opacity="0.12"/></linearGradient>');
  return s;
}
// A flag on a metal pole standing on the ground at x.
function flagOnPole(x, top, w) {
  return ground(x, 10, 0.25) + lit(`<rect x="${x - 2.2}" y="${top - 4}" width="4.4" height="${128 - top}" rx="2" fill="${C('#9aa4b1')}"/>` +
    `<circle cx="${x}" cy="${top - 6}" r="4.5" fill="${R(GOLD)}"/>` + usFlag(x + 2, top, w));
}

// A fallen leaf centred on (cx, cy).
function leaf(cx, cy, r, hex, a = 0) {
  const p = 'M0,-10 L3,-4 L9,-6 L6,0 L10,3 L3,4 L2,10 L0,6 L-2,10 L-3,4 L-10,3 L-6,0 L-9,-6 L-3,-4 Z';
  return `<g transform="translate(${cx},${cy}) rotate(${a}) scale(${f(r / 10)})"><path d="${p}" fill="${R(hex)}" stroke="${darker(hex, 0.5)}" stroke-opacity="0.5" stroke-width="${f(9 / r)}" stroke-linejoin="round"/>` +
    `<path d="M0,9 V-7 M0,0 L6,-3 M0,0 L-6,-3 M0,4 L5,3 M0,4 L-5,3" fill="none" stroke="${darker(hex, 0.35)}" stroke-width="${f(9 / r)}" opacity="0.7"/></g>`;
}

// A green leaf on a stem from (x, y), pointing at angle a.
function greenLeaf(x, y, a, l, hex = '#4f8a3f') {
  const w = l * 0.32;
  return `<g transform="translate(${f(x)},${f(y)}) rotate(${f(a)})"><path d="M0,0 C${f(w)},${f(-l * 0.2)} ${f(w * 0.9)},${f(-l * 0.75)} 0,${f(-l)} C${f(-w * 0.8)},${f(-l * 0.7)} ${f(-w)},${f(-l * 0.2)} 0,0 Z" fill="${L(hex)}"/>` +
    `<path d="M0,-2 Q${f(w * 0.15)},${f(-l * 0.5)} 0,${f(-l * 0.92)}" fill="none" stroke="${lighter(hex, 0.5)}" stroke-opacity="0.6" stroke-width="1.1"/></g>`;
}

// A petal pointing up from (0,0): length l, half-width w.
const petal = (l, w) => `M0,0 C${f(w)},${f(-l * 0.25)} ${f(w * 0.95)},${f(-l * 0.85)} 0,${f(-l)} C${f(-w * 0.95)},${f(-l * 0.85)} ${f(-w)},${f(-l * 0.25)} 0,0 Z`;
const petalEdge = (hex) => `stroke="${darker(hex, 0.35)}" stroke-opacity="0.5" stroke-width="0.7"`;

// A flower head: a ring of shaded petals around a golden centre.
function bloom(cx, cy, r, hex, n = 6) {
  let s = `<g transform="translate(${f(cx)},${f(cy)})">`;
  for (let i = 0; i < n; i++) s += `<path transform="rotate(${f((360 / n) * i + jit(6))})" d="${petal(r, r * 0.5)}" fill="${R(hex)}" ${petalEdge(hex)}/>`;
  return s + `<circle r="${f(r * 0.32)}" fill="${R('#f2b632')}"/></g>`;
}
// A flower on a stem growing from the ground.
function stemFlower(x, y, hex, r = 10) {
  return lit(`<path d="M${x},${y} Q${x - 3},${f((y + 124) / 2)} ${x},124" fill="none" stroke="#3d6b33" stroke-width="3" stroke-linecap="round"/>` +
    greenLeaf(x - 1, y + 30, -50, 18) + bloom(x, y, r, hex));
}
// A tulip on a stem growing from the ground.
function tulip(x, y, hex) {
  return lit(`<path d="M${x},${y + 8} Q${x + 3},${f((y + 124) / 2)} ${x},124" fill="none" stroke="#3d6b33" stroke-width="3" stroke-linecap="round"/>` +
    greenLeaf(x + 1, y + 40, 40, 22) +
    `<path d="M${x - 9},${y - 4} Q${x - 11},${y + 14} ${x},${y + 15} Q${x + 11},${y + 14} ${x + 9},${y - 4} L${x + 5},${y + 2} L${x},${y - 8} L${x - 5},${y + 2} Z" fill="${R(hex)}" ${petalEdge(hex)}/>` +
    `<path d="M${x},${y - 8} Q${x - 4},${y + 4} ${x},${y + 15}" fill="none" stroke="${darker(hex, 0.25)}" stroke-width="1" opacity="0.6"/>`);
}

// A firework burst: glowing streaks with bright tips.
function burst(cx, cy, r, hex) {
  let streaks = '';
  for (let i = 0; i < 14; i++) {
    const a = (i * 2 * Math.PI) / 14 + jit(0.08);
    const rr = r * (0.85 + jit(0.15));
    streaks += `<path d="M${f(cx + rr * 0.3 * Math.cos(a))},${f(cy + rr * 0.3 * Math.sin(a))} L${f(cx + rr * Math.cos(a))},${f(cy + rr * Math.sin(a) + 2)}" stroke="${hex}" stroke-width="3.2" stroke-linecap="round"/>`;
    streaks += `<circle cx="${f(cx + rr * Math.cos(a))}" cy="${f(cy + rr * Math.sin(a) + 2)}" r="2.6" fill="${lighter(hex, 0.6)}"/>`;
  }
  return glowAround(`<circle cx="${cx}" cy="${cy}" r="${f(r * 0.9)}" fill="${hex}" opacity="0.35"/>${streaks}`, 0.9) + streaks + `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#fffbe6"/>`;
}

// A snowflake with a frosty glow.
function snowflake(cx, cy, r) {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    s += `<path d="M${cx},${cy} L${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}" stroke="#e8f3ff" stroke-width="3.6" stroke-linecap="round"/>`;
    for (const d of [-0.5, 0.5]) {
      const bx = cx + r * 0.6 * Math.cos(a);
      const by = cy + r * 0.6 * Math.sin(a);
      s += `<path d="M${f(bx)},${f(by)} L${f(bx + r * 0.32 * Math.cos(a + d * 2))},${f(by + r * 0.32 * Math.sin(a + d * 2))}" stroke="#e8f3ff" stroke-width="2.6" stroke-linecap="round"/>`;
    }
  }
  return glowAround(s.replaceAll('#e8f3ff', '#6aa8e6'), 0.9) + lit(s.replaceAll('#e8f3ff', '#cfe4fb'));
}

// An apple centred on (cx, cy).
function apple(cx, cy, r, withHeart = false) {
  return `<path d="M${cx},${f(cy - r * 0.7)} C${f(cx + r * 0.6)},${f(cy - r * 1.1)} ${f(cx + r * 1.15)},${f(cy - r * 0.5)} ${f(cx + r)},${f(cy + r * 0.2)} C${f(cx + r * 0.9)},${f(cy + r * 0.9)} ${f(cx + r * 0.4)},${f(cy + r * 1.1)} ${cx},${f(cy + r * 0.85)} C${f(cx - r * 0.4)},${f(cy + r * 1.1)} ${f(cx - r * 0.9)},${f(cy + r * 0.9)} ${f(cx - r)},${f(cy + r * 0.2)} C${f(cx - r * 1.15)},${f(cy - r * 0.5)} ${f(cx - r * 0.6)},${f(cy - r * 1.1)} ${cx},${f(cy - r * 0.7)} Z" fill="${R('#d0312d')}" ${E}/>` +
    `<path d="M${cx},${f(cy - r * 0.7)} Q${cx + 2},${f(cy - r * 1.25)} ${cx + 5},${f(cy - r * 1.35)}" fill="none" stroke="#5b3a1e" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M${cx + 2},${f(cy - r * 1.0)} q${f(r * 0.5)},${f(-r * 0.55)} ${f(r * 0.9)},${f(-r * 0.15)} q${f(-r * 0.45)},${f(r * 0.45)} ${f(-r * 0.9)},${f(r * 0.15)} Z" fill="${L('#4f9a3f')}"/>` +
    `<ellipse cx="${f(cx - r * 0.45)}" cy="${f(cy - r * 0.2)}" rx="${f(r * 0.16)}" ry="${f(r * 0.3)}" fill="#ffffff" opacity="0.55" filter="url(#blur1)"/>` +
    (withHeart ? heartPath(cx, cy + r * 0.15, r * 0.32, '#ffd6e0') : '');
}
function heartPath(cx, cy, r, fill) {
  return `<path d="M${f(cx)},${f(cy + r * 0.9)} C${f(cx - r * 1.3)},${f(cy + r * 0.1)} ${f(cx - r * 1.1)},${f(cy - r)} ${f(cx - r * 0.45)},${f(cy - r * 0.9)} C${f(cx - r * 0.1)},${f(cy - r * 0.85)} ${f(cx)},${f(cy - r * 0.55)} ${f(cx)},${f(cy - r * 0.4)} C${f(cx)},${f(cy - r * 0.55)} ${f(cx + r * 0.1)},${f(cy - r * 0.85)} ${f(cx + r * 0.45)},${f(cy - r * 0.9)} C${f(cx + r * 1.1)},${f(cy - r)} ${f(cx + r * 1.3)},${f(cy + r * 0.1)} ${f(cx)},${f(cy + r * 0.9)} Z" fill="${fill}"/>`;
}
const heart = (cx, cy, r, hex = '#d62a3a') => heartPath(cx, cy, r, R(hex)).replace('/>', ` ${E}/>`) +
  `<ellipse cx="${f(cx - r * 0.5)}" cy="${f(cy - r * 0.4)}" rx="${f(r * 0.18)}" ry="${f(r * 0.3)}" fill="#ffffff" opacity="0.5" transform="rotate(30 ${f(cx - r * 0.5)} ${f(cy - r * 0.4)})" filter="url(#blur1)"/>`;

// A decorated egg centred on (cx, cy).
function egg(cx, cy, r, hex, band, a = 0) {
  return `<g transform="translate(${cx},${cy}) rotate(${a})">` +
    `<path d="M0,${f(-r * 1.25)} C${f(r * 0.85)},${f(-r * 1.25)} ${f(r)},${f(r * 0.2)} ${f(r)},${f(r * 0.35)} C${f(r)},${f(r)} ${f(r * 0.5)},${f(r * 1.05)} 0,${f(r * 1.05)} C${f(-r * 0.5)},${f(r * 1.05)} ${f(-r)},${f(r)} ${f(-r)},${f(r * 0.35)} C${f(-r)},${f(r * 0.2)} ${f(-r * 0.85)},${f(-r * 1.25)} 0,${f(-r * 1.25)} Z" fill="${R(hex)}" ${E}/>` +
    `<path d="M${f(-r * 0.97)},${f(r * 0.05)} Q${f(-r * 0.5)},${f(-r * 0.35)} 0,${f(r * 0.05)} T${f(r * 0.97)},${f(r * 0.05)}" fill="none" stroke="${band}" stroke-width="${f(r * 0.26)}" stroke-linecap="round"/>` +
    `<circle cx="${f(-r * 0.35)}" cy="${f(r * 0.6)}" r="${f(r * 0.13)}" fill="${band}"/><circle cx="${f(r * 0.35)}" cy="${f(r * 0.6)}" r="${f(r * 0.13)}" fill="${band}"/></g>`;
}

// A hat brim: a flat band with rounded ends.
const brim = (x, y, w, h, hex) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${f(h / 2)}" fill="${V(hex)}" ${E}/>`;

// ---------------------------------------------------------------- Mother's Day
// (the approved mock-up): roses, a peony, daisies and forget-me-nots in a pot.
const MD_DEFS = `
<radialGradient id="pk1" cx="0.5" cy="0.95" r="1"><stop offset="0" stop-color="#fbe3ea"/><stop offset="0.55" stop-color="#f3a9bf"/><stop offset="1" stop-color="#d9708f"/></radialGradient>
<radialGradient id="pk2" cx="0.5" cy="0.95" r="1"><stop offset="0" stop-color="#fff2f5"/><stop offset="0.5" stop-color="#f7c4d3"/><stop offset="1" stop-color="#e48fab"/></radialGradient>
<radialGradient id="rs1" cx="0.5" cy="0.95" r="1"><stop offset="0" stop-color="#f6a0a0"/><stop offset="0.5" stop-color="#d9475a"/><stop offset="1" stop-color="#9e2236"/></radialGradient>
<radialGradient id="rs2" cx="0.5" cy="0.9" r="1"><stop offset="0" stop-color="#f08a92"/><stop offset="0.6" stop-color="#c8344b"/><stop offset="1" stop-color="#861a2c"/></radialGradient>
<radialGradient id="rsc" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#e2596b"/><stop offset="1" stop-color="#7a1426"/></radialGradient>
<linearGradient id="wh" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e9e4dc"/><stop offset="0.6" stop-color="#fbf9f4"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<radialGradient id="dc" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#ffd85a"/><stop offset="0.6" stop-color="#f0a21f"/><stop offset="1" stop-color="#b86a0e"/></radialGradient>
<linearGradient id="lf" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f5a2c"/><stop offset="0.55" stop-color="#4f8a3f"/><stop offset="1" stop-color="#86b866"/></linearGradient>
<linearGradient id="lf2" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#284d27"/><stop offset="0.6" stop-color="#3f7a36"/><stop offset="1" stop-color="#6fa556"/></linearGradient>
<linearGradient id="pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f4a2a"/><stop offset="0.3" stop-color="#c4693d"/><stop offset="0.55" stop-color="#df8a58"/><stop offset="0.72" stop-color="#c46a3e"/><stop offset="1" stop-color="#7e3f22"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a522f"/><stop offset="0.35" stop-color="#d2774a"/><stop offset="0.55" stop-color="#eba06f"/><stop offset="0.75" stop-color="#cf7546"/><stop offset="1" stop-color="#874526"/></linearGradient>
<linearGradient id="rimTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b183"/><stop offset="1" stop-color="#c06a3e"/></linearGradient>
<radialGradient id="soil" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#4a2f1e"/><stop offset="1" stop-color="#22140c"/></radialGradient>
<radialGradient id="bl" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#bcd4ff"/><stop offset="1" stop-color="#4f74c9"/></radialGradient>`;

function mdLeaf(x, y, a, l, g) {
  const w = l * 0.32;
  return `<g transform="translate(${f(x)},${f(y)}) rotate(${f(a)})"><path d="M0,0 C${f(w)},${f(-l * 0.2)} ${f(w * 0.9)},${f(-l * 0.75)} ${f(jit(2))},${f(-l)} C${f(-w * 0.8)},${f(-l * 0.7)} ${f(-w)},${f(-l * 0.2)} 0,0 Z" fill="url(#${g})"/>` +
    `<path d="M0,-2 Q${f(w * 0.15)},${f(-l * 0.5)} 0,${f(-l * 0.92)}" fill="none" stroke="#a9cf88" stroke-opacity="0.55" stroke-width="1.1"/></g>`;
}
function rose(cx, cy, r, outer = 'rs1', inner = 'rs2', edge = '#6a1020') {
  let s = `<g transform="translate(${f(cx)},${f(cy)})">`;
  for (let i = 0; i < 6; i++) s += `<path transform="rotate(${f(60 * i + jit(8))}) scale(${f(1 + jit(0.08))})" d="${petal(r, r * 0.72)}" fill="url(#${outer})" stroke="${edge}" stroke-opacity="0.45" stroke-width="0.7"/>`;
  for (let i = 0; i < 5; i++) s += `<path transform="rotate(${f(72 * i + 30 + jit(8))})" d="${petal(r * 0.72, r * 0.55)}" fill="url(#${inner})" stroke="${edge}" stroke-opacity="0.45" stroke-width="0.7"/>`;
  s += `<circle r="${f(r * 0.42)}" fill="url(#rsc)"/>`;
  s += `<path d="M${f(-r * 0.3)},${f(r * 0.05)} C${f(-r * 0.3)},${f(-r * 0.35)} ${f(r * 0.3)},${f(-r * 0.35)} ${f(r * 0.28)},${f(r * 0.02)} C${f(r * 0.25)},${f(r * 0.25)} ${f(-r * 0.12)},${f(r * 0.25)} ${f(-r * 0.1)},0 C${f(-r * 0.08)},${f(-r * 0.15)} ${f(r * 0.12)},${f(-r * 0.12)} ${f(r * 0.1)},${f(r * 0.04)}" fill="none" stroke="#5e0f1d" stroke-width="${f(r * 0.07)}" stroke-linecap="round" opacity="0.8"/>`;
  return s + `<path d="M${f(-r * 0.75)},${f(-r * 0.35)} Q${f(-r * 0.5)},${f(-r * 0.8)} ${f(-r * 0.05)},${f(-r * 0.85)}" fill="none" stroke="#ffd0d6" stroke-width="${f(r * 0.08)}" stroke-linecap="round" opacity="0.6"/></g>`;
}
function peony(cx, cy, r) {
  let s = `<g transform="translate(${f(cx)},${f(cy)})">`;
  [[9, 1, 0.62, 'pk1'], [8, 0.78, 0.6, 'pk2'], [6, 0.55, 0.58, 'pk1'], [5, 0.36, 0.55, 'pk2']].forEach(([n, l, w, g], k) => {
    for (let i = 0; i < n; i++) s += `<path transform="rotate(${f((360 / n) * i + k * 17 + jit(10))}) scale(${f(1 + jit(0.1))})" d="${petal(r * l, r * l * w)}" fill="url(#${g})" stroke="#b8577a" stroke-opacity="0.5" stroke-width="0.7"/>`;
  });
  s += `<circle r="${f(r * 0.16)}" fill="#fff4c9" opacity="0.9"/>`;
  return s + `<path d="M${f(-r * 0.8)},${f(-r * 0.2)} Q${f(-r * 0.6)},${f(-r * 0.75)} ${f(-r * 0.1)},${f(-r * 0.9)}" fill="none" stroke="#ffffff" stroke-width="${f(r * 0.07)}" stroke-linecap="round" opacity="0.55"/></g>`;
}
function daisy(cx, cy, r, tilt = 0) {
  let s = `<g transform="translate(${f(cx)},${f(cy)}) rotate(${tilt}) scale(1,0.86)">`;
  for (let i = 0; i < 16; i++) s += `<path transform="rotate(${f(22.5 * i + jit(4))})" d="${petal(r * (0.95 + jit(0.06)), r * 0.17)}" fill="url(#wh)" stroke="#b9b2a6" stroke-opacity="0.55" stroke-width="0.7"/>`;
  s += `<circle r="${f(r * 0.34)}" fill="url(#dc)"/>`;
  for (let i = 0; i < 9; i++) s += `<circle cx="${f(jit(r * 0.2))}" cy="${f(jit(r * 0.2))}" r="${f(r * 0.04)}" fill="#8a4e0b" opacity="0.6"/>`;
  return s + '</g>';
}
function forgetMeNot(cx, cy, r) {
  let s = '';
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    s += `<circle cx="${f(cx + r * 0.62 * Math.cos(a))}" cy="${f(cy + r * 0.62 * Math.sin(a))}" r="${f(r * 0.48)}" fill="url(#bl)"/>`;
  }
  return s + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.28)}" fill="#ffe27a"/>`;
}
// A terracotta pot: centre x, rim top y, rim width w, base y.
function pot(cx, top, w, bottom, bottomW = w * 0.7) {
  const l = cx - w / 2;
  const r = cx + w / 2;
  const rimH = 9;
  return `<path d="M${l + 3},${top + rimH} L${f(cx - bottomW / 2)},${bottom} Q${cx},${bottom + 3} ${f(cx + bottomW / 2)},${bottom} L${r - 3},${top + rimH} Z" fill="url(#pot)"/>` +
    `<path d="M${l + 10},${top + rimH + 4} L${f(cx - bottomW / 2 + 6)},${bottom - 4}" stroke="#f3b98c" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="${l}" y="${top}" width="${w}" height="${rimH}" rx="2.5" fill="url(#rim)"/>` +
    `<path d="M${l + 1},${top + rimH} H${r - 1}" stroke="#5e2c15" stroke-opacity="0.45" stroke-width="1.6"/>` +
    `<ellipse cx="${cx}" cy="${top + 1}" rx="${f(w / 2 - 1)}" ry="3.2" fill="url(#rimTop)"/>` +
    `<ellipse cx="${cx}" cy="${top + 1.2}" rx="${f(w / 2 - 5)}" ry="2.2" fill="url(#soil)"/>` +
    `<path d="M${l + 18},${top + 3} Q${cx + 8},${top + 7} ${r},${top + 4} V${top + rimH + 6} Q${cx + 12},${top + rimH + 2} ${l + 26},${top + rimH} Z" fill="#3a1a0c" opacity="0.28" filter="url(#blur1)"/>`;
}

// ---------------------------------------------------------------- the icons
// Each: { slug, name, when (shown on hover), w, tileX, art() } where art()
// returns { behind (drawn before the tile), front (after it), defs }.
// Coordinates are relative to the tile: it fills x tileX..tileX+128 and
// y 0..128; negative y is the headroom above it (TOP high), where hats sit.
// Nothing is drawn on the tile's face.
const ICONS = [
  {
    slug: 'labor-day', name: 'Labor Day', when: 'first Monday in September', w: 140, tileX: 12,
    // A yellow hard hat sitting on top of the tile.
    art: () => ({ front: lit(`<g transform="rotate(-5 56 -10)">
      <path d="M22,-6 A34,32 0 0 1 90,-6 Z" fill="${R('#f5c21b')}" ${E}/>
      <path d="M50,-36 Q48,-22 51,-6 M62,-36 Q64,-22 61,-6" stroke="${darker('#f5c21b', 0.2)}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M48,-35 Q46,-22 49,-7" stroke="${lighter('#f5c21b', 0.6)}" stroke-width="1.6" fill="none" opacity="0.8"/>
      ${brim(8, -9, 96, 10, '#f5c21b')}</g>`) }),
  },
  {
    slug: 'grandparents-day', name: 'Grandparents Day', when: 'Sunday after Labor Day', w: 236, tileX: 0,
    // Reading glasses resting on top of the tile; knitting beside it.
    art: () => ({ front: lit(`
      <path d="M28,-12 L14,-20 M100,-12 L114,-20" fill="none" stroke="#5a3d25" stroke-width="4" stroke-linecap="round"/>
      <circle cx="46" cy="-13" r="13" fill="${R('#cfe6f5')}" fill-opacity="0.55" stroke="#5a3d25" stroke-width="4.5"/>
      <circle cx="82" cy="-13" r="13" fill="${R('#cfe6f5')}" fill-opacity="0.55" stroke="#5a3d25" stroke-width="4.5"/>
      <path d="M40,-19 Q43,-22 48,-21 M76,-19 Q79,-22 84,-21" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.8"/>
      <path d="M59,-14 Q64,-19 69,-14" fill="none" stroke="#5a3d25" stroke-width="4.5" stroke-linecap="round"/>`) +
      ground(186, 32) + lit(`
      <rect x="146" y="36" width="5" height="90" rx="2.5" fill="${C('#c9a46a')}" transform="rotate(-55 150 40)"/>
      <rect x="216" y="34" width="5" height="90" rx="2.5" fill="${C('#c9a46a')}" transform="rotate(52 220 38)"/>
      <circle cx="150" cy="40" r="5.5" fill="${R('#b8865a')}"/><circle cx="222" cy="38" r="5.5" fill="${R('#b8865a')}"/>
      <circle cx="186" cy="94" r="30" fill="${R('#b84a8a')}"/>
      <path d="M160,84 Q186,72 212,86 M157,96 Q186,84 215,100 M162,110 Q186,98 208,114 M172,68 Q160,92 170,120 M198,66 Q212,92 202,122" fill="none" stroke="${darker('#b84a8a', 0.3)}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
      <path d="M166,80 Q182,72 200,76" fill="none" stroke="${lighter('#b84a8a', 0.5)}" stroke-width="2.2" stroke-linecap="round" opacity="0.8"/>
      <path d="M210,110 Q224,122 234,112" fill="none" stroke="#b84a8a" stroke-width="3.5" stroke-linecap="round"/>`) }),
  },
  {
    slug: 'patriot-day', name: 'Patriot Day', when: 'Sep 11', w: 230, tileX: 0,
    art: () => ({ front: flagOnPole(150, 20, 74) }),
  },
  {
    slug: 'hispanic-heritage-month', name: 'Hispanic Heritage Month begins', when: 'Sep 15', w: 256, tileX: 64,
    // Papel picado strung above the tile, past both sides.
    art: () => {
      const colors = ['#e83e8c', '#f28c28', '#f2c230', '#2fb36b', '#2f9be0', '#8e5bd6', '#e83e8c', '#f28c28'];
      const yAt = (x) => -44 + 15 * (1 - ((x - 128) / 126) ** 2);
      let s = `<path d="M2,-44 Q128,-14 254,-44" fill="none" stroke="#4a3b2c" stroke-width="2"/>`;
      [8, 38, 68, 98, 128, 158, 188, 218].forEach((x, i) => {
        const y = yAt(x + 11);
        const tilt = (x + 11 - 128) / 16;
        s += `<g transform="rotate(${f(tilt)} ${x + 11} ${f(y)})"><path d="M${x},${f(y)} h22 v22 l-3.7,4 l-3.7,-4 l-3.7,4 l-3.7,-4 l-3.7,4 l-3.5,-4 Z" fill="${L(colors[i])}"/>` +
          `<circle cx="${x + 7}" cy="${f(y + 9)}" r="2.4" fill="#fff" opacity="0.85"/><circle cx="${x + 15}" cy="${f(y + 9)}" r="2.4" fill="#fff" opacity="0.85"/><path d="M${x + 6},${f(y + 16)} q5,3 10,0" stroke="#fff" stroke-width="2" fill="none" opacity="0.85"/></g>`;
      });
      return { front: lit(s) };
    },
  },
  {
    slug: 'constitution-day', name: 'Constitution Day', when: 'Sep 17', w: 236, tileX: 0,
    art: () => ({ front: ground(186, 44, 0.25) + lit(`<g transform="rotate(-8 186 90)">
      <rect x="148" y="68" width="76" height="46" fill="${L('#f1e2bd')}"/>
      <path d="M158,82 h56 M158,92 h56 M158,102 h40" stroke="#a88d5c" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>
      <rect x="140" y="62" width="12" height="58" rx="6" fill="${C('#e3cf9f')}"/>
      <rect x="220" y="62" width="12" height="58" rx="6" fill="${C('#e3cf9f')}"/></g>`) + lit(`
      <path d="M206,18 C226,16 232,36 214,58 L196,92 L192,90 L206,54 C192,52 190,26 206,18 Z" fill="${L('#f4f6f9')}" ${E}/>
      <path d="M206,22 L194,90" stroke="#8a97a6" stroke-width="2" fill="none"/>
      <path d="M200,30 L210,38 M198,40 L212,46 M200,50 L214,54" stroke="#c3ccd6" stroke-width="1.4" opacity="0.8"/>`) }),
  },
  {
    slug: 'first-day-of-fall', name: 'First day of fall', when: 'about Sep 22', w: 214, tileX: 40,
    // Leaves piled on the ground on both sides of the tile.
    art: () => ({ front: ground(24, 18, 0.22) + ground(190, 22, 0.22) + lit(
      leaf(12, 86, 10, '#c0392b', 40) + leaf(30, 96, 9, '#f2b632', 25) + leaf(22, 110, 14, '#e0652b', -20)) + lit(
      leaf(186, 82, 9, '#e0652b', 60) + leaf(178, 100, 9, '#f2b632', -10) + leaf(196, 98, 12, '#c0392b', 15) + leaf(184, 114, 13, '#e0652b', -25) + leaf(204, 114, 10, '#f2b632', 30)) }),
  },
  {
    slug: 'world-teachers-day', name: "World Teachers' Day", when: 'Oct 5', w: 200, tileX: 0,
    // A red apple beside the tile.
    art: () => ({ front: ground(166, 26) + lit(apple(166, 96, 26)) }),
  },
  {
    slug: 'indigenous-peoples-day', name: "Indigenous Peoples' Day", when: 'second Monday in October', w: 230, tileX: 0,
    art: () => ({ front: ground(184, 36) + lit(`
      <rect x="178" y="40" width="12" height="9" rx="3" fill="${R('#c9a46a')}"/>
      <circle cx="184" cy="84" r="38" fill="${R('#c9a46a')}"/>
      <circle cx="184" cy="84" r="30" fill="${R('#fdf6e3')}"/>
      <path d="M184,58 v6 M184,104 v6 M158,84 h6 M204,84 h6" stroke="#5b4a35" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M184,58 L192,84 L184,110 L176,84 Z" fill="${L('#f4f2ee')}" ${E}/>
      <path d="M184,58 L192,84 L176,84 Z" fill="${L(RED)}"/>
      <circle cx="184" cy="84" r="3.5" fill="${R('#c9a46a')}"/>
      <path d="M162,70 A28,28 0 0 1 182,57" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>`) }),
  },
  {
    slug: 'halloween', name: 'Halloween', when: 'Oct 31', w: 238, tileX: 0,
    // A jack-o'-lantern, lit from inside.
    art: () => ({ front: ground(183, 44, 0.32) + lit(`
      <path d="M182,48 q1,-12 12,-17" fill="none" stroke="#4b6b2a" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="160" cy="88" rx="24" ry="36" fill="${R('#e9781a')}"/>
      <ellipse cx="206" cy="88" rx="24" ry="36" fill="${R('#e9781a')}"/>
      <ellipse cx="183" cy="88" rx="28" ry="38" fill="${R('#f59a33')}" ${E}/>`) +
      glowAround(`<path d="M160,74 l10,-12 l10,12 Z M186,74 l10,-12 l10,12 Z M176,86 l7,-8 l7,8 Z M154,96 Q183,124 212,96 Z" fill="#ffcf3f"/>`, 0.7) +
      `<path d="M160,74 l10,-12 l10,12 Z M186,74 l10,-12 l10,12 Z" fill="${R('#ffdf6a')}" stroke="#7a3a08" stroke-width="1.2"/>
      <path d="M176,86 l7,-8 l7,8 Z" fill="${R('#ffdf6a')}" stroke="#7a3a08" stroke-width="1.2"/>
      <path d="M154,96 Q183,124 212,96 L204,100 L198,94 L190,102 L183,96 L176,102 L168,94 L162,100 Z" fill="${R('#ffd24a')}" stroke="#7a3a08" stroke-width="1.2"/>` }),
  },
  {
    slug: 'election-day', name: 'Election Day', when: 'Tuesday after the first Monday in November', w: 244, tileX: 0,
    // A ballot box beside the tile, with an "I voted" sticker on its front.
    art: () => ({ front: ground(190, 46) + lit(`
      <path d="M168,30 h44 v42 h-44 Z" fill="${L('#ffffff')}" ${E}/>
      <path d="M178,46 l7,8 l16,-16" fill="none" stroke="${GREEN}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`) + lit(`
      <path d="M150,62 h80 l8,62 h-96 Z" fill="${L(BLUE)}" ${E}/>
      <rect x="164" y="56" width="52" height="10" rx="3" fill="${V('#1d3f80')}"/>`) + lit(`<g transform="rotate(-10 190 96)">
      <circle cx="190" cy="96" r="17" fill="${R('#f7f5f0')}" ${E}/>
      <path d="M177,100 h26 M179,106 h22" stroke="${RED}" stroke-width="3.4"/>${star(190, 88, 7, BLUE)}</g>`) }),
  },
  {
    slug: 'veterans-day', name: 'Veterans Day', when: 'Nov 11', w: 230, tileX: 0,
    // A flag beside the tile and a red, white and blue rosette at its foot.
    art: () => ({ front: flagOnPole(152, 30, 56) + ground(196, 18, 0.25) + lit(`
      <path d="M188,108 L180,128 L188,124 L194,128 Z" fill="${L(RED)}"/>
      <path d="M204,108 L212,128 L204,124 L198,128 Z" fill="${L(BLUE)}"/>
      <circle cx="196" cy="100" r="16" fill="${R(RED)}" ${E}/>
      <circle cx="196" cy="100" r="11" fill="${R('#f7f5f0')}"/>${star(196, 100, 8, BLUE)}`) }),
  },
  {
    slug: 'thanksgiving', name: 'Thanksgiving', when: 'fourth Thursday in November', w: 246, tileX: 0,
    // A pilgrim hat on top of the tile; a pumpkin and corn beside it.
    art: () => ({ front: lit(`<g transform="rotate(-5 52 -10)">
      <path d="M30,-6 L36,-46 H70 L76,-6 Z" fill="${L('#3a3633')}" ${E}/>
      <rect x="32" y="-21" width="42" height="9" fill="${V('#6b4a2a')}"/>
      <rect x="46" y="-22" width="13" height="11" fill="none" stroke="${GOLD}" stroke-width="3"/>
      ${brim(8, -9, 90, 10, '#3a3633')}</g>`) +
      ground(190, 44) + lit(`
      <ellipse cx="166" cy="96" rx="30" ry="26" fill="${R('#ec7f1f')}" ${E}/>
      <path d="M154,74 Q148,96 156,118 M178,74 Q184,96 176,118" fill="none" stroke="${darker('#ec7f1f', 0.25)}" stroke-width="2.6"/>
      <path d="M166,72 q2,-10 8,-14" fill="none" stroke="#4b6b2a" stroke-width="5" stroke-linecap="round"/>`) + lit(`
      <g transform="rotate(18 214 88)">
        <ellipse cx="214" cy="88" rx="13" ry="32" fill="${C(GOLD)}"/>
        <path d="M206,70 h16 M204,82 h20 M204,94 h20 M206,106 h16 M214,58 v60" stroke="${darker(GOLD, 0.25)}" stroke-width="2" opacity="0.7"/>
        <path d="M214,118 Q196,112 200,92 Q208,104 214,118 Z M214,118 Q232,112 228,92 Q220,104 214,118 Z" fill="${L('#a5b56b')}"/></g>`) }),
  },
  {
    slug: 'winter-solstice', name: 'Winter solstice', when: 'about Dec 21', w: 216, tileX: 0,
    // Snow piled on top of the tile; snowflakes beside it.
    art: () => ({ front: lit(`<path d="M10,3 Q4,-8 18,-12 Q28,-26 50,-20 Q66,-30 86,-18 Q104,-20 112,-8 Q120,-2 118,3 Z" fill="${V('#ffffff')}"/>
      <path d="M16,-2 Q50,-8 96,-4 Q108,-3 114,0" fill="none" stroke="#c9dcef" stroke-width="3" stroke-linecap="round"/>
      <path d="M26,-14 Q40,-22 54,-18" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`) +
      snowflake(170, 46, 20) + snowflake(196, 96, 15) + snowflake(150, 102, 11) }),
  },
  {
    slug: 'christmas', name: 'Christmas', when: 'Dec 25', w: 250, tileX: 26,
    // A Santa hat sitting on top of the tile, its tip flopping down beside the
    // left edge; a present beside the tile.
    art: () => ({ front: lit(`<path d="M34,-6 C40,-34 66,-46 92,-36 C104,-30 110,-16 112,-6 Z" fill="${R('#d32f2f')}"/>
      <path d="M44,-28 C26,-34 12,-22 13,4" fill="none" stroke="#c62828" stroke-width="14" stroke-linecap="round"/>
      <path d="M50,-34 C38,-38 28,-32 22,-24" fill="none" stroke="#ef6b6b" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`) + lit(`
      <circle cx="13" cy="12" r="11" fill="${R('#ffffff')}"/>
      <rect x="28" y="-12" width="90" height="15" rx="7.5" fill="${V('#ffffff')}"/>`) +
      ground(204, 38) + lit(`
      <rect x="172" y="70" width="64" height="54" fill="${L('#2e8b45')}"/>
      <rect x="166" y="58" width="76" height="16" fill="${L('#3aa356')}" ${E}/>
      <rect x="198" y="58" width="12" height="66" fill="${C(GOLD)}"/>`) + lit(`
      <path d="M204,58 C192,40 176,46 186,56 Z M204,58 C216,40 232,46 222,56 Z" fill="${R(GOLD)}" ${E}/>
      <circle cx="204" cy="57" r="4" fill="${R(GOLD)}"/>`) }),
  },
  {
    slug: 'new-years-day', name: "New Year's Day", when: 'Jan 1', w: 330, tileX: 101,
    art: () => ({ front: burst(46, 48, 38, '#ec4f9a') + burst(68, 104, 20, '#f6c23e') + burst(282, 42, 34, '#3aa5ea') + burst(262, 100, 22, '#36c27a') }),
  },
  {
    slug: 'mlk-day', name: 'Martin Luther King Jr. Day', when: 'third Monday in January', w: 156, tileX: 28,
    // A white dove perched on top of the tile.
    art: () => ({ front: lit(`<g transform="translate(14,-38)"><path d="M70,8 C58,-2 40,4 36,16 C20,14 6,22 2,32 C18,30 26,34 34,36 C46,42 64,38 74,26 C82,24 86,20 88,16 C82,14 76,12 70,8 Z" fill="${R('#f4f6f9')}" ${E}/>
      <path d="M46,22 C40,6 22,-2 10,4 C20,8 28,18 34,26 Z" fill="${L('#e3e8ee')}" ${E}/>
      <path d="M18,6 C26,10 32,16 36,22 M24,4 C30,10 36,14 40,20" stroke="#c7cfd8" stroke-width="1.4" fill="none"/>
      <path d="M52,38 v5 M60,38 v5" stroke="#e08a6a" stroke-width="2" stroke-linecap="round"/>
      <circle cx="74" cy="15" r="2.6" fill="#1f2933"/><circle cx="74.8" cy="14.2" r="0.8" fill="#ffffff"/>
      <path d="M88,16 L96,18 L88,20 Z" fill="${L(GOLD)}"/></g>`) }),
  },
  {
    slug: 'black-history-month', name: 'Black History Month begins', when: 'Feb 1', w: 166, tileX: 30,
    // A bow in red, yellow and green sitting on top of the tile, its ribbons
    // hanging down beside the left edge.
    art: () => {
      const tail = (d) => `<path d="${d}" fill="none" stroke="#c62828" stroke-width="10" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#f2c230" stroke-width="6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#2e8b45" stroke-width="2.4" stroke-linecap="round"/>`;
      return { front: lit(tail('M54,-10 C34,-8 18,6 16,40 C15,60 20,76 14,98') + tail('M48,-10 C34,-8 24,10 24,50')) + lit(`
        <path d="M58,-12 C40,-34 20,-28 24,-14 C20,-2 40,4 58,-12 Z" fill="${R('#c62828')}" ${E}/>
        <path d="M58,-12 C76,-34 96,-28 92,-14 C96,-2 76,4 58,-12 Z" fill="${R('#2e8b45')}" ${E}/>
        <circle cx="58" cy="-12" r="8" fill="${R('#f2c230')}"/>`) };
    },
  },
  {
    slug: 'groundhog-day', name: 'Groundhog Day', when: 'Feb 2', w: 196, tileX: 0,
    // The groundhog peeks out from behind the tile's right side.
    art: () => ({
      behind: lit(`<path d="M110,70 C110,40 130,26 152,28 C176,30 188,48 186,70 C184,92 170,106 150,106 L110,106 Z" fill="${R('#9b6b3d')}"/>
        <circle cx="132" cy="34" r="8" fill="${R('#8a5d33')}"/><circle cx="172" cy="38" r="8" fill="${R('#8a5d33')}"/>
        <circle cx="132" cy="35" r="3.5" fill="#d9a884"/><circle cx="172" cy="39" r="3.5" fill="#d9a884"/>`),
      front: lit(`<ellipse cx="158" cy="74" rx="20" ry="15" fill="${R('#e0bf98')}"/>
        <circle cx="146" cy="56" r="4.5" fill="#1f1a16"/><circle cx="170" cy="56" r="4.5" fill="#1f1a16"/>
        <circle cx="147.5" cy="54.5" r="1.4" fill="#ffffff"/><circle cx="171.5" cy="54.5" r="1.4" fill="#ffffff"/>
        <ellipse cx="158" cy="68" rx="5.5" ry="4" fill="${R('#4a2c17')}"/>
        <path d="M158,72 v5 M153,78 q5,4 10,0" fill="none" stroke="#4a2c17" stroke-width="2" stroke-linecap="round"/>
        <rect x="154" y="78" width="8" height="7" rx="1.5" fill="${V('#ffffff')}"/>`) + lit(`
        <ellipse cx="140" cy="98" rx="9" ry="7" fill="${R('#8a5d33')}"/><ellipse cx="182" cy="98" rx="9" ry="7" fill="${R('#8a5d33')}"/>`),
    }),
  },
  {
    slug: 'valentines-day', name: "Valentine's Day", when: 'Feb 14', w: 226, tileX: 0,
    // A red bow sitting on top of the tile; a heart beside it.
    art: () => ({ front: lit(`<path d="M62,-14 C42,-34 22,-28 28,-14 C22,0 42,6 62,-14 Z" fill="${R('#d62a3a')}" ${E}/>
      <path d="M62,-14 C82,-34 102,-28 96,-14 C102,0 82,6 62,-14 Z" fill="${R('#d62a3a')}" ${E}/>
      <path d="M58,-12 L48,4 L56,1 L58,6 Z M66,-12 L76,4 L68,1 L66,6 Z" fill="${L('#b51f2a')}"/>
      <circle cx="62" cy="-14" r="7" fill="${R('#b51f2a')}"/>`) + ground(182, 30) + lit(heart(182, 80, 36)) }),
  },
  {
    slug: 'presidents-day', name: "Presidents' Day", when: 'third Monday in February', w: 266, tileX: 0,
    // Mount Rushmore beside the tile: four faces carved into a craggy granite
    // mountain, with pine trees along its foot.
    art: () => {
      const face = (cx, cy, s, a) => `<g transform="translate(${cx},${cy}) rotate(${a}) scale(${s})">` +
        `<path d="M-12,-20 C-14,-34 14,-34 12,-20 C14,-6 12,10 4,18 C0,22 -4,22 -8,18 C-14,10 -14,-6 -12,-20 Z" fill="${R('#c2bcb2')}"/>` +
        `<path d="M-10,-13 q3,-2 6,0 M3,-13 q3,-2 6,0" stroke="#5f5a53" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
        `<path d="M0,-12 L-2.5,2 L2,3" fill="none" stroke="#6f6a62" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M-5,9 Q0,11 5,9" fill="none" stroke="#5f5a53" stroke-width="1.8" stroke-linecap="round"/>` +
        `<path d="M-11,-18 C-12,-28 -4,-32 2,-30" fill="none" stroke="#ece7e0" stroke-width="2" stroke-linecap="round" opacity="0.8"/></g>`;
      let pines = '';
      for (const [x, h] of [[142, 22], [154, 28], [168, 20], [182, 26], [198, 22], [212, 30], [228, 24], [242, 28], [256, 20]]) {
        pines += `<path d="M${x},${124 - h} L${x + 8},124 L${x - 8},124 Z" fill="${L('#2f5a33')}"/>`;
      }
      return { front: ground(200, 62, 0.28) + lit(`<path d="M134,124 L138,96 L146,74 L152,66 L160,50 L170,42 L178,30 L192,26 L204,18 L218,24 L230,32 L240,46 L250,58 L256,78 L262,100 L264,124 Z" fill="${L('#938d85')}" ${E}/>
        <path d="M150,72 L160,84 M226,40 L236,60 M246,70 L254,92 M172,104 L184,112 M214,100 L226,108" stroke="#6f6a62" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
        <path d="M178,30 L192,26 L204,18 L218,24 L212,30 L198,30 Z" fill="#b5afa6" opacity="0.6"/>`) +
        lit(face(164, 70, 0.92, -6) + face(190, 64, 1, -2) + face(216, 70, 0.94, 3) + face(240, 82, 0.86, 8)) + lit(pines) };
    },
  },
  {
    slug: 'daylight-saving-time', name: 'Daylight saving time begins', when: 'second Sunday in March', w: 226, tileX: 0,
    art: () => ({ front: ground(184, 38) + lit(`
      <path d="M162,114 l-8,10 M206,114 l8,10" stroke="#3a3633" stroke-width="5" stroke-linecap="round"/>
      <path d="M150,62 C140,46 150,34 166,40 Z" fill="${R('#d23a3a')}"/><path d="M218,62 C228,46 218,34 202,40 Z" fill="${R('#d23a3a')}"/>
      <rect x="179" y="40" width="10" height="8" rx="2" fill="${C('#9aa4b1')}"/>
      <circle cx="184" cy="84" r="36" fill="${R('#d23a3a')}" ${E}/>
      <circle cx="184" cy="84" r="28" fill="${R('#fbfaf7')}"/>
      <path d="M184,62 v4 M184,102 v4 M162,84 h4 M202,84 h4" stroke="#33302d" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M184,84 V68 M184,84 L196,92" stroke="#33302d" stroke-width="3.6" stroke-linecap="round"/>
      <circle cx="184" cy="84" r="3.2" fill="#33302d"/>
      <path d="M164,72 A26,26 0 0 1 180,60" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8"/>`) }),
  },
  {
    slug: 'pi-day', name: 'Pi Day', when: 'Mar 14', w: 244, tileX: 0,
    art: () => ({ front: ground(187, 48) + lit(`
      <path d="M138,96 L148,120 H226 L236,96 Z" fill="${L('#cdb08a')}" ${E}/>
      <ellipse cx="187" cy="94" rx="51" ry="20" fill="${R('#e3b261')}"/>
      <path d="M140,94 Q187,124 234,94" fill="none" stroke="#b9822f" stroke-width="2.6"/>
      <ellipse cx="187" cy="91" rx="40" ry="13" fill="${R('#a3283d')}"/>
      <path d="M168,84 h38 M179,84 v15 M196,84 v11 q0,5 6,5" fill="none" stroke="#f2d7a1" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`) }),
  },
  {
    slug: 'st-patricks-day', name: "St. Patrick's Day", when: 'Mar 17', w: 226, tileX: 0,
    // A green top hat on top of the tile; a four-leaf clover beside it.
    art: () => ({ front: lit(`<g transform="rotate(-5 52 -10)">
      <path d="M32,-6 L36,-46 H68 L72,-6 Z" fill="${C('#2e8b45')}" ${E}/>
      <rect x="34" y="-22" width="36" height="9" fill="${V('#33302d')}"/>
      <rect x="46" y="-23" width="12" height="11" fill="none" stroke="${GOLD}" stroke-width="3"/>
      ${brim(10, -9, 84, 10, '#2e8b45')}</g>`) + ground(190, 20) + lit(`
      <path d="M186,92 Q190,112 202,124" fill="none" stroke="#2a7a3a" stroke-width="5" stroke-linecap="round"/>` +
      [0, 90, 180, 270].map((a) => `<g transform="rotate(${a} 186 84)">${heart(186, 64, 18, '#3aa356')}</g>`).join('') +
      `<circle cx="186" cy="84" r="4.5" fill="${R('#2a7a3a')}"/>`) }),
  },
  {
    slug: 'first-day-of-spring', name: 'First day of spring', when: 'about Mar 20', w: 232, tileX: 47,
    // Flowers growing on both sides of the tile.
    art: () => ({ front: ground(24, 20, 0.2) + ground(204, 26, 0.2) +
      tulip(13, 66, '#e83e8c') + stemFlower(33, 88, '#f7f3ec') + tulip(188, 72, '#f2b632') + stemFlower(206, 90, '#b48ce0') + tulip(222, 62, '#e0652b') }),
  },
  {
    slug: 'easter', name: 'Easter', when: 'date varies', w: 246, tileX: 0,
    art: () => ({ front: ground(190, 44) + lit(`<path d="M150,78 Q190,10 230,78" fill="none" stroke="#a06a30" stroke-width="6" stroke-linecap="round"/>`) + lit(
      egg(166, 72, 13, '#f5a8c8', '#e83e8c', -15) + egg(190, 66, 14, '#a8d8f5', '#2f7fd0', 5) + egg(214, 72, 13, '#fff1a8', '#f28c28', 15)) + lit(`
      <path d="M142,76 H238 L228,122 H152 Z" fill="${L('#c98d4a')}" ${E}/>
      <path d="M146,90 H234 M150,106 H230" stroke="#9a6328" stroke-width="2.6"/>
      <path d="M162,78 v42 M180,78 v42 M198,78 v42 M216,78 v42" stroke="#9a6328" stroke-width="2"/>
      <rect x="140" y="74" width="100" height="7" rx="3.5" fill="${V('#d39a58')}"/>`) }),
  },
  {
    slug: 'earth-day', name: 'Earth Day', when: 'Apr 22', w: 226, tileX: 0,
    // A seedling growing from a little soil on top of the tile; a globe beside it.
    art: () => ({ front: lit(`<path d="M40,-2 Q38,-16 40,-28" fill="none" stroke="#2a7a3a" stroke-width="4" stroke-linecap="round"/>
      <path d="M40,-20 C28,-30 16,-26 16,-20 C24,-14 34,-14 40,-20 Z" fill="${L('#4fa858')}"/>
      <path d="M40,-24 C50,-36 64,-32 64,-26 C56,-18 46,-18 40,-24 Z" fill="${L('#4fa858')}"/>
      <ellipse cx="40" cy="-1" rx="16" ry="5" fill="${R('#6b4a2a')}"/>`) + ground(184, 34) + lit(`
      <circle cx="184" cy="84" r="38" fill="${R('#3b8fd9')}"/>
      <path d="M160,62 C170,56 180,62 178,72 C176,82 164,82 160,92 C156,84 150,70 160,62 Z" fill="${L('#4fa858')}"/>
      <path d="M196,58 C210,62 220,74 216,86 C208,84 204,96 194,94 C188,84 200,78 192,70 C190,64 192,60 196,58 Z" fill="${L('#4fa858')}"/>
      <path d="M176,104 C186,100 196,106 194,116 C186,120 176,116 176,104 Z" fill="${L('#4fa858')}"/>
      <ellipse cx="170" cy="68" rx="9" ry="13" fill="#ffffff" opacity="0.25" transform="rotate(35 170 68)" filter="url(#blur1)"/>`) }),
  },
  {
    slug: 'teacher-appreciation-week', name: 'Teacher Appreciation Week', when: 'first full week of May', w: 222, tileX: 0,
    art: () => ({ front: ground(180, 40) + lit(`
      <rect x="142" y="104" width="76" height="18" rx="2" fill="${L(BLUE)}" ${E}/><rect x="146" y="107" width="70" height="2" fill="#efe6d2"/>
      <rect x="148" y="88" width="66" height="16" rx="2" fill="${L('#e0652b')}" ${E}/><rect x="152" y="91" width="60" height="2" fill="#efe6d2"/>
      <rect x="144" y="72" width="72" height="16" rx="2" fill="${L(GREEN)}" ${E}/><rect x="148" y="75" width="66" height="2" fill="#efe6d2"/>`) + lit(apple(180, 54, 16, true)) }),
  },
  {
    slug: 'mothers-day', name: "Mother's Day", when: 'second Sunday in May', w: 252, tileX: 0,
    art: () => {
      seed = 20261118; // the approved mock-up's arrangement
      let leaves = '';
      for (const [x, y, a, l, g] of [[178, 90, -52, 38, 'lf'], [214, 90, 50, 40, 'lf2'], [186, 88, -20, 44, 'lf2'], [206, 88, 22, 42, 'lf'],
        [170, 92, -78, 30, 'lf2'], [222, 92, 78, 30, 'lf'], [196, 88, 4, 48, 'lf'], [182, 90, -36, 34, 'lf'], [210, 90, 36, 32, 'lf2']]) leaves += mdLeaf(x, y, a, l, g);
      const stems = `<path d="M196,90 Q188,60 180,46 M196,90 Q204,62 216,44 M196,90 Q196,50 198,26 M196,90 Q176,76 162,72 M196,90 Q220,78 234,70" fill="none" stroke="#3d6b33" stroke-width="2.4" stroke-linecap="round"/>`;
      const parts = [
        forgetMeNot(172, 30, 6) + forgetMeNot(226, 26, 5.5) + forgetMeNot(244, 48, 5) + forgetMeNot(150, 50, 5),
        rose(198, 22, 13, 'pk1', 'pk2'), daisy(234, 68, 13, 12), rose(216, 44, 17), daisy(162, 70, 14, -10), peony(180, 50, 23),
      ];
      const breath = Array.from({ length: 18 }, () => `<circle cx="${f(150 + rnd() * 96)}" cy="${f(8 + rnd() * 60)}" r="${f(1.4 + rnd() * 1.2)}" fill="#ffffff" opacity="${f(0.75 + rnd() * 0.25)}"/>`).join('');
      return { defs: MD_DEFS, front: ground(196, 34, 0.32) + lit(stems + leaves) + breath + parts.map(lit).join('') + lit(pot(196, 88, 58, 124, 40)) };
    },
  },
  {
    slug: 'memorial-day', name: 'Memorial Day', when: 'last Monday in May', w: 250, tileX: 0,
    art: () => ({ front: ground(170, 18, 0.22) + lit(`<path d="M168,124 Q164,100 170,80" fill="none" stroke="#2e6b34" stroke-width="4" stroke-linecap="round"/>` +
      greenLeaf(167, 108, -60, 22, '#3a8a45')) + lit(
      [0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a} 170 66)"><ellipse cx="170" cy="50" rx="13" ry="16" fill="${R('#d32f2f')}" stroke="#8e1a1a" stroke-opacity="0.45" stroke-width="0.8"/></g>`).join('') +
      `<circle cx="170" cy="66" r="8" fill="${R('#2b2522')}"/>`) + flagOnPole(212, 34, 34) }),
  },
];

function svg(icon) {
  if (icon.w > MAX_W) throw new Error(`${icon.slug} is ${icon.w} wide; at most ${MAX_W}.`);
  defs = new Map();
  seed = icon.slug.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) | 0;
  const art = icon.art();
  // Art is drawn in the tile's coordinates (its top at y = 0), moved down
  // below the headroom.
  const body = `<g transform="translate(0,${TOP})">${art.behind ? `<g filter="url(#paint)">${art.behind}</g>` : ''}<g transform="translate(${icon.tileX},0)">${TILE}</g><g filter="url(#paint)">${art.front}</g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.w} ${H}" width="${icon.w}" height="${H}" role="img" aria-label="${icon.name}">` +
    `<defs>${FILTERS}${art.defs || ''}${[...defs.values()].join('')}</defs>${body}</svg>\n`;
}

mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) if (/\.(svg|png|webp)$/.test(file)) rmSync(path.join(OUT, file));
const drawn = ICONS.map((icon) => ({ icon, text: svg(icon) }));
// Each SVG is drawn at its own size (the tile 128 px square) on a
// transparent background, then encoded as WebP (quality 90: about a third
// of the PNG's size, no visible difference) by Chromium's own encoder.
const QUALITY = 0.9;
const browser = await chromium.launch({ channel: 'chromium' });
for (const { icon, text } of drawn) {
  const page = await browser.newPage({ viewport: { width: icon.w, height: H }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${text}</body></html>`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: icon.w, height: H } });
  const webp = await page.evaluate(async ({ b64, q }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', q).split(',')[1];
  }, { b64: png.toString('base64'), q: QUALITY });
  writeFileSync(path.join(OUT, `${icon.slug}.webp`), Buffer.from(webp, 'base64'));
  await page.close();
}
await browser.close();
console.log(`Wrote ${ICONS.length} icons to ${path.relative(ROOT, OUT)}/`);

const galleryArg = process.argv.find((a) => a.startsWith('--gallery='));
if (galleryArg) {
  const file = path.resolve(galleryArg.slice('--gallery='.length));
  const rows = drawn.map(({ icon, text }, i) => {
    // The WebP, inline, so the page works on its own wherever it's opened.
    const src = `data:image/webp;base64,${readFileSync(path.join(OUT, `${icon.slug}.webp`)).toString('base64')}`;
    return `<div class="row"><div class="n">${i + 1}</div><div class="name"><b>${icon.name}</b><br><span>${icon.when}</span></div>` +
      `<img src="${src}" height="${H}"><img src="${src}" height="${f((44 * H) / TILE_H)}"><img src="${src}" height="${f((28 * H) / TILE_H)}"></div>`;
  }).join('');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>Holiday icons</title><style>
    body { font: 14px -apple-system, system-ui, sans-serif; margin: 20px; color: #1f2933; background: #fff; }
    .row { display: grid; grid-template-columns: 28px 200px 400px 150px 100px; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid #e3e6ea; }
    .n { color: #9aa4b1; text-align: right; } .name span { color: #5f6b7a; }
    img { justify-self: start; }
  </style><h1>Holiday icons (${ICONS.length})</h1><p>Full size, then with the tile 44 px (settings page) and 28 px (dashboard header) tall.</p>${rows}`);
  console.log(`Gallery: ${file}`);
}
