// page-fetch.js — read Schoology from inside an open Schoology page.
//
// Some browsers (Safari, seen live on 2026-11-14) send the background
// worker's requests to Schoology WITHOUT the family's sign-in, so Schoology
// answers with its sign-in page. A request made by the content script in a
// Schoology tab is a same-site request from that page and carries the
// sign-in in every browser.
//
// The same code runs everywhere, with no browser check: the background reads
// Schoology itself first, and only when Schoology says "signed out" does it
// ask an open Schoology tab to make the same read-only GET requests
// (background.js). Chrome and Firefox never need the second step.
//
// No browser APIs here (both sides are injected), so it is unit-tested.

export const PAGE_FETCH = 'page-fetch';

// --- Content-script side ----------------------------------------------------

// Answer a { type: 'page-fetch', url, accept } message: a read-only GET of a
// page on THIS page's own site, with the page's sign-in. Never another site,
// never anything but GET. Returns { status, url, text } or { error }.
export async function answerPageFetch(message, { origin, fetchImpl = fetch } = {}) {
  let target;
  try {
    target = new URL(String(message && message.url));
  } catch {
    return { error: 'Bad address' };
  }
  if (!origin || target.origin !== origin) return { error: 'Another site' };
  try {
    const headers = message.accept ? { Accept: String(message.accept) } : {};
    const res = await fetchImpl(target.href, { method: 'GET', credentials: 'include', headers });
    return { status: res.status, url: res.url || target.href, text: await res.text() };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

// --- Background side --------------------------------------------------------

// A fetch() look-alike that runs in a Schoology page. `send(message)` delivers
// the message to a content script and resolves with its answer. The result
// has what schoology.js reads: { ok, status, url, text(), json() }.
export function pageFetchVia(send) {
  return async (url, options = {}) => {
    const accept = (options.headers && (options.headers.Accept || options.headers.accept)) || null;
    const reply = await send({ type: PAGE_FETCH, url: String(url), accept });
    if (!reply || typeof reply.status !== 'number') {
      throw new Error((reply && reply.error) || 'The Schoology page did not answer');
    }
    const text = typeof reply.text === 'string' ? reply.text : '';
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      url: reply.url || String(url),
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
}

// Send to the first of `tabIds` whose content script answers, and keep using
// that tab. `sendToTab(tabId, message)` is browser.tabs.sendMessage.
export function firstTabSender(tabIds, sendToTab) {
  let chosen = null;
  return async (message) => {
    const order = chosen === null ? tabIds : [chosen];
    let lastError = new Error('No Schoology page is open');
    for (const tabId of order) {
      try {
        const reply = await sendToTab(tabId, message);
        // undefined: that tab has no content script listening (an old page).
        if (reply !== undefined && reply !== null) {
          chosen = tabId;
          return reply;
        }
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  };
}

// Which open tabs can read `site`: pages on that site, not its sign-in page.
// The active tab first (the one the family is looking at).
export function readableTabs(tabs, site) {
  return (tabs || [])
    .filter((t) => {
      try {
        const u = new URL(t.url);
        return u.origin === site && !/^\/login(\/|$)/i.test(u.pathname);
      } catch {
        return false;
      }
    })
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)))
    .map((t) => t.id);
}
