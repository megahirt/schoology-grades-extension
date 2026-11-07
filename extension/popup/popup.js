// popup.js — the toolbar popup. Renders the shared dashboard view
// (src/dashboard-view.js); the same view is shown in the in-page panel on
// Schoology pages (src/panel.js).

import browser from 'webextension-polyfill';
import { mountDashboard, DASHBOARD_CSS } from '../src/dashboard-view.js';

const style = document.createElement('style');
style.textContent = DASHBOARD_CSS;
document.head.append(style);

mountDashboard(document.getElementById('dashboard'), { browser, openLinksInActiveTab: true });
