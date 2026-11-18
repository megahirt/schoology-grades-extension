// panel.js — the dashboard as a panel on the right edge of Schoology
// pages. Safari has no side-panel API for extensions (Chrome's sidePanel and
// Firefox's sidebar_action have no Safari equivalent), so the content script
// draws this panel inside the Schoology page instead. It works the same in
// Safari on Mac and iPhone and in Chrome.
//
// Layout (see the "Schoology Dashboard Panel" design):
//   - wide screens: a 437 px panel slides in from the right; a tab on its
//     left edge opens and closes it. While closed, the tab shows each child's
//     initial in their GO/NO-GO color (when the badge is turned on).
//   - narrow windows (≤ 600 px): the panel is a bottom sheet over a dimmed
//     page; tapping the dimmed page or the × closes it.
//   - phones: the dashboard fills the screen and the × closes it. It is
//     scaled to the screen, because Schoology's page is zoomed out.
//
// The panel lives in a shadow root so Schoology's CSS cannot restyle it and
// its CSS cannot leak into Schoology. It never touches Schoology's own
// elements: it only appends one host element to <html>. The parser reads
// Schoology's grades with querySelectorAll, which does not enter shadow
// roots, so the panel can never be mistaken for grades.
//
// The dashboard inside is the same view as the toolbar popup
// (dashboard-view.js). It is only built the first time the panel opens, so
// a closed panel costs one small button per page.

import { mountDashboard, DASHBOARD_CSS, escapeHtml, initials, isPartial, refreshRunning, MISSING_IMG, noGoCircle } from './dashboard-view.js';
import { summarizeStudent, effectiveSettings, isStudentAccount } from './rules.js';
import { getSettings, getDashboards, getTurnedIn, getMarkedDone, storageGet, changedFor } from './storage.js';

export const PANEL_HOST_ID = 'sgd-panel-host';

// Schoology's layout never gets narrower than 980 px (below that it scrolls
// sideways; measured on Home, Grades, Courses and Calendar). The panel docks
// beside Schoology only when both fit side by side: 980 + 437 = 1417 px.
// Narrower windows get the floating panel over the page, and phones the
// bottom sheet. Pure CSS media queries, so it follows window resizes and
// browser zoom on its own.
export const SCHOOLOGY_MIN_WIDTH = 980;
export const PANEL_WIDTH = 437;
export const DOCK_MIN_WIDTH = SCHOOLOGY_MIN_WIDTH + PANEL_WIDTH;

// The bottom sheet's look in narrow windows.
const SHEET_RULES = (p) => `
  ${p}.wrap .sheet, ${p} .sheet { border-left: none; border-radius: 18px 18px 0 0; box-shadow: 0 -2px 4px rgba(15, 23, 42, 0.20), 0 -10px 28px rgba(15, 23, 42, 0.48), 0 -24px 56px rgba(15, 23, 42, 0.36); }
  ${p}.wrap .grip, ${p} .grip { display: block; align-self: center; width: 40px; height: 5px; border-radius: 3px; background: #d3d7dc; margin-top: 8px; flex: 0 0 auto; }
  ${p}.backdrop { display: block; position: fixed; inset: 0; z-index: 2147483645; background: rgba(15, 23, 42, 0.32); border: none; padding: 0; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
  ${p}.backdrop.open { opacity: 1; pointer-events: auto; }
  ${p}.edge-tab.open { display: none; }
`;

// A phone is a screen whose short side is 600 CSS px or less. Returns null on
// anything else, or where to draw on a phone:
//   s    — how much to scale up: page pixels per device pixel right now
//          (about 2.4 on a zoomed-out Schoology page, 1 on a mobile page)
//   x, y — top-left of what the screen shows, in page pixels
//   w, h — the screen's size in device pixels
//   r    — gap between the right edge of what's shown and the page's
// It follows pinch-zoom, so the sheet stays the same size on the glass.
export function phoneMetrics(win) {
  const scr = win && win.screen;
  const vv = win && win.visualViewport;
  if (!scr || !vv) return null;
  const short = Math.min(scr.width, scr.height);
  if (!(short > 0 && short <= 600) || !(vv.width > 0)) return null;
  let s = vv.width / scr.width;
  if (Math.abs(s - 1) < 0.05) s = 1;
  const layoutW = win.document.documentElement.clientWidth || vv.width;
  return {
    s,
    x: vv.offsetLeft,
    y: vv.offsetTop,
    w: vv.width / s,
    h: vv.height / s,
    r: Math.max(0, layoutW - (vv.offsetLeft + vv.width)),
  };
}

const PANEL_CSS = `
:host { all: initial; }
.wrap {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(${PANEL_WIDTH}px, 92vw);
  z-index: 2147483646;
  transform: translateX(100%);
  transition: transform 0.2s ease;
  visibility: hidden;
}
.wrap.open { transform: none; visibility: visible; }
.sheet {
  height: 100%; overflow: hidden; box-sizing: border-box;
  background: #fff; border-left: 1px solid #d3d7dc;
  /* A deep, layered shadow so the panel's edge stands out over Schoology. */
  box-shadow: -2px 0 4px rgba(15, 23, 42, 0.20), -10px 0 28px rgba(15, 23, 42, 0.44), -28px 0 64px rgba(15, 23, 42, 0.36);
  display: flex; flex-direction: column;
}
/* Docked beside Schoology (wide windows): a plain edge, no shadow. */
@media (min-width: ${DOCK_MIN_WIDTH}px) { .sheet { box-shadow: none; } }
.sheet > .body-host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.sheet .sgd { flex: 1 1 auto; min-height: 0; }
.sheet .sgd > .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.grip { display: none; }
.backdrop { display: none; }
.edge-tab {
  position: fixed; right: 0; top: 96px; z-index: 2147483647;
  width: 48px; padding: 10px 0 12px; box-sizing: border-box;
  border: none; border-radius: 12px 0 0 12px;
  background: #1f2933; color: #fff;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  cursor: pointer; box-shadow: -2px 2px 10px rgba(15, 23, 42, 0.22);
  font: 700 9px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.02em;
  transition: right 0.2s ease;
}
.edge-tab:hover { background: #111827; }
.edge-tab:focus-visible { outline: 3px solid #93b4f5; outline-offset: 2px; }
.edge-tab.open { right: min(${PANEL_WIDTH}px, 92vw); padding: 15px 0; }
.edge-tab.open .kids { display: none; }
.edge-tab svg { display: block; }
.tab-spin { display: block; animation: sgd-tab-spin 0.9s linear infinite; }
@keyframes sgd-tab-spin { to { transform: rotate(360deg); } }
.kids { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.kid { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.kid-pic { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: #e7ecf3; color: #334155; font-size: 11px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85); }
.kid-m { display: flex; align-items: center; gap: 3px; font-size: 11px; line-height: 1; color: #fff; }
.kid-m .missing-icon { width: 11px; height: 10px; display: block; }
.kid-m .hg { font-size: 10px; }
.kid-pic.nogo-circle { background: none; display: block; }
.kid-unknown { font-size: 10px; font-weight: 800; color: #3d2c00; background: #f2b84b; border-radius: 4px; padding: 1px 5px; }
@media (max-width: 600px) {
  .wrap { top: auto; left: 0; width: 100%; height: 85vh; transform: translateY(100%); }
${SHEET_RULES('')}
}
/* Phones (.phone is set from script, see phoneMetrics): Schoology has no
   mobile layout, so a phone lays the page out about 980 px wide and zooms
   out. A media query sees 980 px, and anything drawn at page scale is tiny.
   The dashboard fills the screen (the × closes it) and the tab is sized in
   device pixels; both are placed on the part of the page the screen shows
   and enlarged by --s to match. They are enlarged with zoom, not a scale
   transform: Safari on iPhone draws a scaled layer at its small size and
   stretches it, which made the whole dashboard blurry. The boxes that are
   positioned on the page (.wrap, .tab-pos) are in page pixels and carry no
   zoom; only what's inside them is zoomed. */
.phone.wrap {
  left: var(--vx); top: var(--vy); right: auto; bottom: auto;
  width: calc(var(--vw) * var(--s)); height: calc(var(--vh) * var(--s));
  transform: translateY(100%);
  pointer-events: none;
}
.phone.wrap.open { transform: none; }
.phone.wrap .sheet { zoom: var(--s); height: 100%; pointer-events: auto; border-left: none; border-radius: 0; box-shadow: none; }
.phone.wrap .grip, .phone.backdrop { display: none; }
.tab-pos { display: contents; }
.phone.tab-pos { display: block; position: fixed; right: var(--vr); top: calc(var(--vy) + 96px * var(--s)); z-index: 2147483647; }
.phone.edge-tab { position: static; zoom: var(--s); }
.phone.edge-tab.open { display: none; }
@media (prefers-reduced-motion: reduce) { .wrap, .edge-tab, .backdrop { transition: none; } }
.notice {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
  max-width: min(560px, calc(100vw - 32px)); box-sizing: border-box;
  display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px;
  background: #1f2933; color: #fff; border-radius: 10px; box-shadow: 0 6px 20px rgba(15, 23, 42, 0.3);
  font: 14px/1.35 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.notice[hidden] { display: none; }
.notice button { font: inherit; font-size: 13px; font-weight: 600; border-radius: 8px; cursor: pointer; flex: 0 0 auto; }
.notice .reload { border: none; background: #fff; color: #1f2933; padding: 7px 12px; }
.notice .dismiss { border: none; background: transparent; color: #cbd2d9; padding: 4px 6px; font-size: 18px; line-height: 1; }
`;

const CHEVRON_LEFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g stroke-width="2"><path d="M15 6l-6 6 6 6"/></g></svg>';
const SPINNER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><g stroke-width="2.25"><path d="M12 3a9 9 0 1 0 9 9"/></g></svg>';
const CHEVRON_RIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g stroke-width="2"><path d="M9 6l6 6-6 6"/></g></svg>';

// Per-child summary for the closed tab:
//   [{ name, pictureUrl, missing, overdue, nogo, unknown }]
// Missing and Overdue counts always show (when non-zero). NO-GO (or "?" for
// UNKNOWN) shows only for parents with the badge turned on; GO shows nothing.
export async function tabSummaries() {
  const dashboards = (await getDashboards()) || {};
  const settings = effectiveSettings(await getSettings(), { isStudent: isStudentAccount(await storageGet('account', null), dashboards) });
  const uids = Object.keys(dashboards);
  const isStudent = uids.length === 1 && uids[0] === 'self';
  const verdictsOn = settings.showGoNoGo && !isStudent;
  const turnedIn = (await getTurnedIn()) || {};
  const done = (await getMarkedDone()) || {};
  return Object.entries(dashboards).map(([uid, d]) => {
    // Marks are a student's own, except that a parent can mark Overdue work
    // turned in (as on the dashboard), so a parent's marks count on Overdue only.
    const full = summarizeStudent(d.courses || [], settings, [], []);
    const overdueIds = new Set(full.overdueItems.map((a) => String(a.id)));
    const sum = isStudent
      ? summarizeStudent(d.courses || [], settings, turnedIn[uid], done[uid])
      : summarizeStudent(d.courses || [], settings, (turnedIn[uid] || []).filter((id) => overdueIds.has(String(id))), []);
    const unknown = Boolean(d.error || isPartial(d));
    return {
      name: d.studentName || 'Student',
      pictureUrl: d.pictureUrl || null,
      missing: unknown ? 0 : sum.missingCount,
      overdue: unknown ? 0 : sum.overdueItems.length,
      nogo: verdictsOn && !unknown && sum.verdict.verdict === 'NO-GO',
      unknown: verdictsOn && unknown,
    };
  });
}

// mountPanel({ document, browser, open = false, onOpenChange })
//   open         — start opened or closed.
//   onOpenChange — called with true/false when the user opens or closes it
//                  (not when setOpen() is called), so the state can be saved.
// Returns { setOpen, isOpen, refreshTab, destroy }.
// Docking: while the panel is open, <html> gets a class; in a window at
// least DOCK_MIN_WIDTH wide that class makes Schoology's page give up the
// panel's width (its content reflows into the space left). The class and one
// small style element are removed when the panel closes or goes away.
const DOCK_CLASS = 'sgd-panel-open';
const DOCK_STYLE_ID = 'sgd-dock-style';
const DOCK_CSS = `
@media (min-width: ${DOCK_MIN_WIDTH}px) {
  html.${DOCK_CLASS} { margin-right: ${PANEL_WIDTH}px !important; transition: margin-right 0.2s ease; }
}
@media (prefers-reduced-motion: reduce) { html.${DOCK_CLASS} { transition: none; } }
`;

export function mountPanel({ document, browser, open = false, onOpenChange } = {}) {
  document.getElementById(PANEL_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    `<style>${PANEL_CSS}\n${DASHBOARD_CSS}</style>` +
    '<button class="backdrop" type="button" tabindex="-1" aria-label="Close dashboard panel"></button>' +
    '<div class="tab-pos"><button class="edge-tab" type="button" aria-expanded="false"></button></div>' +
    '<div class="notice" role="status" hidden><span class="notice-text">This page loaded while the dashboard was switching between your children, so it may show the wrong child.</span>' +
    '<button class="reload" type="button">Reload page</button><button class="dismiss" type="button" aria-label="Dismiss">×</button></div>' +
    '<div class="wrap"><aside class="sheet" aria-label="Grades dashboard">' +
    '<div class="grip" aria-hidden="true"></div><div class="body-host"></div></aside></div>';
  document.documentElement.append(host);

  const wrap = shadow.querySelector('.wrap');
  const tab = shadow.querySelector('.edge-tab');
  const backdrop = shadow.querySelector('.backdrop');
  const bodyHost = shadow.querySelector('.body-host');
  const notice = shadow.querySelector('.notice');
  // When Schoology's server sent this page (it renders "viewing as" then).
  // The page that triggers a refresh was sent before the refresh began.
  const perf = document.defaultView && document.defaultView.performance;
  const nav = perf && perf.getEntriesByType ? perf.getEntriesByType('navigation')[0] : null;
  const loadedAt = perf && perf.timeOrigin
    ? perf.timeOrigin + (nav && nav.responseStart > 0 ? nav.responseStart : 0)
    : Date.now();
  let dashboard = null;
  let isOpen = false;

  function applyDock() {
    const on = isOpen;
    let style = document.getElementById(DOCK_STYLE_ID);
    if (on && !style) {
      style = document.createElement('style');
      style.id = DOCK_STYLE_ID;
      style.textContent = DOCK_CSS;
      (document.head || document.documentElement).append(style);
    }
    document.documentElement.classList.toggle(DOCK_CLASS, on);
  }
  let kids = [];
  let busy = false;

  function drawTab() {
    const parts = kids.map((k) => {
      const bits = [];
      if (k.missing) bits.push(`${k.missing} missing`);
      if (k.overdue) bits.push(`${k.overdue} overdue`);
      if (k.nogo) bits.push('NO-GO');
      if (k.unknown) bits.push('verdict unknown');
      return `${k.name}${bits.length ? `: ${bits.join(', ')}` : ''}`;
    }).join('. ');
    tab.setAttribute('aria-label', isOpen
      ? 'Hide grades dashboard'
      : `Show grades dashboard${parts ? `. ${parts}.` : ''}`);
    tab.classList.toggle('open', isOpen);
    const html = kids.map((k) => {
      const pic = k.nogo ? noGoCircle('kid-pic nogo-circle') : k.pictureUrl
        ? `<img class="kid-pic" src="${escapeHtml(k.pictureUrl)}" alt="" data-initials="${escapeHtml(initials(k.name))}">`
        : `<span class="kid-pic">${escapeHtml(initials(k.name))}</span>`;
      return `<span class="kid">${pic}` +
        (k.missing ? `<span class="kid-m">${MISSING_IMG}${k.missing}</span>` : '') +
        (k.overdue ? `<span class="kid-m"><span class="hg">😬</span>${k.overdue}</span>` : '') +
        (k.unknown ? '<span class="kid-unknown">?</span>' : '') +
        '</span>';
    }).join('');
    const spinner = busy && !isOpen ? `<span class="tab-spin" aria-hidden="true">${SPINNER}</span>` : '';
    tab.innerHTML = (isOpen ? CHEVRON_RIGHT : CHEVRON_LEFT) + spinner + (html ? `<span class="kids" aria-hidden="true">${html}</span>` : '');
    // A Schoology picture that fails to load falls back to the initials.
    for (const img of tab.querySelectorAll('img.kid-pic')) {
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.className = 'kid-pic';
        span.textContent = img.dataset.initials || '?';
        img.replaceWith(span);
      }, { once: true });
    }
    if (busy && !isOpen) tab.setAttribute('aria-label', `${tab.getAttribute('aria-label')} Refreshing grades.`);
  }


  async function refreshTab() {
    try {
      kids = await tabSummaries();
      busy = refreshRunning(await storageGet('refreshState', null));
    } catch {
      kids = [];
    }
    drawTab();
  }

  function setOpen(next) {
    isOpen = Boolean(next);
    if (isOpen && !dashboard) {
      dashboard = mountDashboard(bodyHost, {
        browser,
        showDemo: false,
        openOptions: () => browser.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
        onClose: () => userToggle(false),
      });
    }
    wrap.classList.toggle('open', isOpen);
    backdrop.classList.toggle('open', isOpen);
    applyDock();
    tab.setAttribute('aria-expanded', String(isOpen));
    drawTab();
  }

  function userToggle(next) {
    setOpen(next);
    if (onOpenChange) onOpenChange(isOpen);
  }

  notice.querySelector('.reload').addEventListener('click', () => document.defaultView.location.reload());
  notice.querySelector('.dismiss').addEventListener('click', () => { notice.hidden = true; });

  // A parent refresh briefly switches Schoology's "viewing as" child. If this
  // page loaded during that window it may show another child: say so once.
  let noticeShown = false;
  async function checkLoadedDuringRefresh() {
    if (noticeShown) return;
    const state = await storageGet('refreshState', null);
    if (!state || state.running || !state.finishedAt) return;
    const start = Date.parse(state.startedAt || '');
    const end = Date.parse(state.finishedAt);
    if (!(loadedAt >= start && loadedAt <= end)) return;
    const account = await storageGet('account', null);
    if (!account || account.type !== 'parent') return;
    noticeShown = true;
    notice.hidden = false;
  }

  // Phones: size and place the sheet and the tab for the screen, and keep
  // them there through scrolling, pinch-zoom and rotation.
  const win = document.defaultView;
  let phoneFrame = 0;
  function applyPhone() {
    phoneFrame = 0;
    const m = phoneMetrics(win);
    for (const el of [wrap, tab, tab.parentElement, backdrop]) el.classList.toggle('phone', Boolean(m));
    if (!m) return;
    const px = (n) => `${Math.round(n * 100) / 100}px`;
    host.style.setProperty('--s', String(Math.round(m.s * 1000) / 1000));
    host.style.setProperty('--vx', px(m.x));
    host.style.setProperty('--vy', px(m.y));
    host.style.setProperty('--vw', px(m.w));
    host.style.setProperty('--vh', px(m.h));
    host.style.setProperty('--vr', px(m.r));
  }
  function queuePhone() {
    if (phoneFrame) return;
    phoneFrame = win.requestAnimationFrame ? win.requestAnimationFrame(applyPhone) : win.setTimeout(applyPhone, 16);
  }
  const vv = win && win.visualViewport;
  if (vv) {
    vv.addEventListener('resize', queuePhone);
    vv.addEventListener('scroll', queuePhone);
  }
  applyPhone();

  tab.addEventListener('click', () => userToggle(!isOpen));
  backdrop.addEventListener('click', () => userToggle(false));

  // Keep the tab's verdicts current while the panel is closed.
  const WATCHED = ['dashboards', 'settings', 'turnedIn', 'markedDone', 'refreshState'];
  function onStorageChanged(changes, area) {
    if (area === 'local' && changedFor(changes, WATCHED)) refreshTab();
    if (area === 'local' && changedFor(changes, ['refreshState'])) checkLoadedDuringRefresh().catch(() => {});
  }
  browser.storage.onChanged.addListener(onStorageChanged);
  // The page waits to learn who is signed in before the panel shows
  // (content.js), so a refresh may have finished in the meantime: check now.
  checkLoadedDuringRefresh().catch(() => {});

  setOpen(open);
  refreshTab();
  return {
    setOpen,
    isOpen: () => isOpen,
    refreshTab,
    // True when the open panel sits beside Schoology rather than over it.
    isDocked: () => isOpen && document.defaultView.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`).matches,
    destroy() {
      browser.storage.onChanged.removeListener(onStorageChanged);
      if (vv) {
        vv.removeEventListener('resize', queuePhone);
        vv.removeEventListener('scroll', queuePhone);
      }
      if (dashboard) dashboard.destroy();
      document.documentElement.classList.remove(DOCK_CLASS);
      document.getElementById(DOCK_STYLE_ID)?.remove();
      host.remove();
    },
  };
}
