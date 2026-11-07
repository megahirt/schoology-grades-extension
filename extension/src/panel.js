// panel.js — the dashboard as a panel docked to the right edge of Schoology
// pages. Safari has no side-panel API for extensions (Chrome's sidePanel and
// Firefox's sidebar_action have no Safari equivalent), so the content script
// draws this panel inside the Schoology page instead. It works the same in
// Safari on Mac and iPhone and in Chrome.
//
// Layout (see the "Schoology Dashboard Panel" design):
//   - wide screens: a 380 px panel slides in from the right; a tab on its
//     left edge opens and closes it. While closed, the tab shows each child's
//     initial in their GO/NO-GO color (when the badge is turned on).
//   - narrow screens (phones, ≤ 600 px): the panel is a bottom sheet over a
//     dimmed page; tapping the dimmed page or the × closes it.
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

import { mountDashboard, DASHBOARD_CSS, escapeHtml, initials } from './dashboard-view.js';
import { summarizeStudent, DEFAULT_SETTINGS } from './rules.js';
import { getSettings, getDashboards, getTurnedIn, getMarkedDone } from './storage.js';

export const PANEL_HOST_ID = 'sgd-panel-host';

const PANEL_CSS = `
:host { all: initial; }
.wrap {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(380px, 92vw);
  z-index: 2147483646;
  transform: translateX(100%);
  transition: transform 0.2s ease;
  visibility: hidden;
}
.wrap.open { transform: none; visibility: visible; }
.sheet {
  height: 100%; overflow: hidden; box-sizing: border-box;
  background: #fff; border-left: 1px solid #e5e7eb;
  box-shadow: -4px 0 16px rgba(15, 23, 42, 0.08);
  display: flex; flex-direction: column;
}
.sheet > .body-host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.sheet .sgd { flex: 1 1 auto; min-height: 0; }
.sheet .sgd > .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.grip { display: none; }
.backdrop { display: none; }
.tab {
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
.tab:hover { background: #111827; }
.tab:focus-visible { outline: 3px solid #93b4f5; outline-offset: 2px; }
.tab.open { right: min(380px, 92vw); padding: 15px 0; }
.tab.open .kids { display: none; }
.tab svg { display: block; }
.kids { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.kid { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.kid-i { width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 11px; display: flex; align-items: center; justify-content: center; }
.kid-i.go { background: #1b7a3e; } .kid-i.nogo { background: #b42318; } .kid-i.unknown { background: #f2b84b; color: #3d2c00; }
@media (max-width: 600px) {
  .wrap { top: auto; left: 0; width: 100%; height: 85vh; transform: translateY(100%); }
  .sheet { border-left: none; border-radius: 18px 18px 0 0; box-shadow: 0 -6px 24px rgba(15, 23, 42, 0.18); }
  .grip { display: block; align-self: center; width: 40px; height: 5px; border-radius: 3px; background: #d3d7dc; margin-top: 8px; flex: 0 0 auto; }
  .backdrop { display: block; position: fixed; inset: 0; z-index: 2147483645; background: rgba(15, 23, 42, 0.32); border: none; padding: 0; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
  .backdrop.open { opacity: 1; pointer-events: auto; }
  .tab.open { display: none; }
}
@media (prefers-reduced-motion: reduce) { .wrap, .tab, .backdrop { transition: none; } }
`;

const CHEVRON_LEFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const CHEVRON_RIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// Per-child verdicts for the closed tab: [{ name, verdict: 'GO'|'NO-GO'|'UNKNOWN' }].
// Empty when the GO/NO-GO badge is turned off.
export async function tabVerdicts() {
  const settings = { ...DEFAULT_SETTINGS, ...((await getSettings()) || {}) };
  if (!settings.showGoNoGo) return [];
  const dashboards = (await getDashboards()) || {};
  const turnedIn = (await getTurnedIn()) || {};
  const done = (await getMarkedDone()) || {};
  return Object.entries(dashboards).map(([uid, d]) => ({
    name: d.studentName || 'Student',
    verdict: d.error ? 'UNKNOWN' : summarizeStudent(d.courses || [], settings, turnedIn[uid], done[uid]).verdict.verdict,
  }));
}

// mountPanel({ document, browser, open = false, onOpenChange })
//   open         — start opened or closed.
//   onOpenChange — called with true/false when the user opens or closes it
//                  (not when setOpen() is called), so the state can be saved.
// Returns { setOpen, isOpen, refreshTab, destroy }.
export function mountPanel({ document, browser, open = false, onOpenChange } = {}) {
  document.getElementById(PANEL_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    `<style>${PANEL_CSS}\n${DASHBOARD_CSS}</style>` +
    '<button class="backdrop" type="button" tabindex="-1" aria-label="Close dashboard panel"></button>' +
    '<button class="tab" type="button" aria-expanded="false"></button>' +
    '<div class="wrap"><aside class="sheet" aria-label="Homework dashboard">' +
    '<div class="grip" aria-hidden="true"></div><div class="body-host"></div></aside></div>';
  document.documentElement.append(host);

  const wrap = shadow.querySelector('.wrap');
  const tab = shadow.querySelector('.tab');
  const backdrop = shadow.querySelector('.backdrop');
  const bodyHost = shadow.querySelector('.body-host');
  let dashboard = null;
  let isOpen = false;
  let verdicts = [];

  function drawTab() {
    const label = verdicts.map((v) => `${v.name}: ${v.verdict}`).join('. ');
    tab.setAttribute('aria-label', isOpen
      ? 'Hide homework dashboard'
      : `Show homework dashboard${label ? `. ${label}.` : ''}`);
    tab.classList.toggle('open', isOpen);
    const kids = verdicts.map((v) => {
      const cls = v.verdict === 'GO' ? 'go' : v.verdict === 'NO-GO' ? 'nogo' : 'unknown';
      const first = escapeHtml(initials(v.name).charAt(0));
      return `<span class="kid"><span class="kid-i ${cls}">${first}</span><span>${escapeHtml(v.verdict === 'UNKNOWN' ? '?' : v.verdict)}</span></span>`;
    }).join('');
    tab.innerHTML = (isOpen ? CHEVRON_RIGHT : CHEVRON_LEFT) + (kids ? `<span class="kids" aria-hidden="true">${kids}</span>` : '');
  }

  async function refreshTab() {
    try {
      verdicts = await tabVerdicts();
    } catch {
      verdicts = [];
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
    tab.setAttribute('aria-expanded', String(isOpen));
    drawTab();
  }

  function userToggle(next) {
    setOpen(next);
    if (onOpenChange) onOpenChange(isOpen);
  }

  tab.addEventListener('click', () => userToggle(!isOpen));
  backdrop.addEventListener('click', () => userToggle(false));

  // Keep the tab's verdicts current while the panel is closed.
  const WATCHED = ['dashboards', 'settings', 'turnedIn', 'markedDone'];
  function onStorageChanged(changes, area) {
    if (area === 'local' && WATCHED.some((k) => k in changes)) refreshTab();
  }
  browser.storage.onChanged.addListener(onStorageChanged);

  setOpen(open);
  refreshTab();
  return {
    setOpen,
    isOpen: () => isOpen,
    refreshTab,
    destroy() {
      browser.storage.onChanged.removeListener(onStorageChanged);
      if (dashboard) dashboard.destroy();
      host.remove();
    },
  };
}
