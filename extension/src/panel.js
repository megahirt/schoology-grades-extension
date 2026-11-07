// panel.js — the dashboard as a panel docked to the right edge of Schoology
// pages. Safari has no side-panel API for extensions (Chrome's sidePanel and
// Firefox's sidebar_action have no Safari equivalent), so the content script
// draws this panel inside the Schoology page instead. It works the same in
// Safari on Mac and iPhone and in Chrome.
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

import { mountDashboard, DASHBOARD_CSS } from './dashboard-view.js';

export const PANEL_HOST_ID = 'sgd-panel-host';

const PANEL_CSS = `
:host { all: initial; }
.wrap {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(380px, 92vw);
  z-index: 2147483646;
  transform: translateX(100%);
  transition: transform 0.2s ease;
}
.wrap.open { transform: none; }
.sheet {
  height: 100%; overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px 24px;
  background: #fff; border-left: 1px solid #ddd;
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.18);
  visibility: hidden;
}
.wrap.open .sheet { visibility: visible; }
.tab {
  position: absolute; left: -40px; top: 96px;
  width: 40px; height: 44px; padding: 0;
  border: none; border-radius: 8px 0 0 8px;
  background: #2e7d32; color: #fff; font-size: 20px; line-height: 44px;
  cursor: pointer; box-shadow: -2px 2px 6px rgba(0, 0, 0, 0.2);
}
.tab:hover { background: #256628; }
.tab:focus-visible { outline: 3px solid #90caf9; outline-offset: 1px; }
.close {
  position: absolute; top: 8px; right: 10px;
  border: none; background: none; color: #666;
  font: 20px/1 -apple-system, "Segoe UI", sans-serif; cursor: pointer; padding: 4px;
}
.close:hover { color: #222; }
@media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }
`;

// mountPanel({ document, browser, open = false, onOpenChange })
//   open         — start opened or closed.
//   onOpenChange — called with true/false when the user opens or closes it
//                  (not when setOpen() is called), so the state can be saved.
// Returns { setOpen, isOpen, destroy }.
export function mountPanel({ document, browser, open = false, onOpenChange } = {}) {
  document.getElementById(PANEL_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    `<style>${PANEL_CSS}\n${DASHBOARD_CSS}</style>` +
    '<div class="wrap" part="panel">' +
    '<button class="tab" type="button" aria-expanded="false" title="Schoology Dashboard">📚</button>' +
    '<aside class="sheet" aria-label="Schoology Dashboard">' +
    '<button class="close" type="button" aria-label="Close dashboard panel">×</button>' +
    '<div class="body"></div></aside></div>';
  document.documentElement.append(host);

  const wrap = shadow.querySelector('.wrap');
  const tab = shadow.querySelector('.tab');
  const body = shadow.querySelector('.body');
  let dashboard = null;
  let isOpen = false;

  function setOpen(next) {
    isOpen = Boolean(next);
    if (isOpen && !dashboard) {
      dashboard = mountDashboard(body, {
        browser,
        showDemo: false,
        openOptions: () => browser.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
      });
    }
    wrap.classList.toggle('open', isOpen);
    tab.setAttribute('aria-expanded', String(isOpen));
    tab.setAttribute('aria-label', isOpen ? 'Hide Schoology Dashboard' : 'Show Schoology Dashboard');
  }

  function userToggle(next) {
    setOpen(next);
    if (onOpenChange) onOpenChange(isOpen);
  }

  tab.addEventListener('click', () => userToggle(!isOpen));
  shadow.querySelector('.close').addEventListener('click', () => userToggle(false));

  setOpen(open);
  return {
    setOpen,
    isOpen: () => isOpen,
    destroy() {
      if (dashboard) dashboard.destroy();
      host.remove();
    },
  };
}
