/* Schoology Live Probe — background service worker.
 *
 * Safari-compatible: uses the webextension-polyfill (loaded via
 * importScripts below) and the browser.* Promise APIs. No chrome.*
 * callbacks, no offscreen document, no DOMParser — the service worker
 * has no DOM, so evidence is computed from the raw fetched HTML string.
 *
 * Storage keys (browser.storage.local):
 *   'probeGradesContext' — { url, sampleTitle, domHasMissing, scrapedAt }
 *     captured by the content script from the logged-in UI. The URL here
 *     is the ONLY URL the probe ever fetches. It is never guessed.
 *   'probeResults' — array of evidence objects, appended to, never
 *     overwritten. Each entry has fetchContext 'service-worker' |
 *     'popup' | 'hidden-tab'.
 *
 * Evidence object (mirrors SPEC runLiveProbe):
 *   { status, finalUrl, loggedIn, bodyLength, containsAssignmentTitle,
 *     containsGrade, containsMissing, assignmentTitleChecked, checkedAt,
 *     fetchContext }
 * loggedIn=false if the final URL contains '/login' or the body contains
 * a login-form marker. A fetch/network error records status 0 and an
 * `error` field instead of pretending the fetch succeeded.
 *
 * No credentials are stored, logged, or sent anywhere except the fetch
 * itself, which reuses the user's existing logged-in browser session
 * (credentials:'include'). Nothing leaves the browser.
 */

importScripts('vendor/browser-polyfill.min.js');

const RESULTS_KEY = 'probeResults';
const CONTEXT_KEY = 'probeGradesContext';

function isLoginPage(finalUrl, body) {
  if (finalUrl && finalUrl.includes('/login')) {
    return true;
  }
  // Login-form markers in the returned HTML (heuristic, recorded as such).
  return /<form[^>]*\b(login|sign-?in)\b/i.test(body) || (/type=["']password["']/i.test(body) && /log\s?in/i.test(body));
}

function buildEvidence(response, body, gradesUrl, assignmentTitle, fetchContext) {
  var finalUrl = response ? response.url : gradesUrl;
  var loggedIn = response ? !isLoginPage(finalUrl, body) : false;
  return {
    status: response ? response.status : 0,
    finalUrl: finalUrl,
    loggedIn: loggedIn,
    bodyLength: body.length,
    containsAssignmentTitle: assignmentTitle ? body.includes(assignmentTitle) : false,
    // Heuristic: a grade-like value (a percent) or a grades-table marker.
    containsGrade: /\b\d{1,3}(\.\d+)?\s*%/.test(body) || /grades-table|course-grade|gradebook/i.test(body),
    containsMissing: /missing/i.test(body),
    assignmentTitleChecked: assignmentTitle || null,
    checkedAt: new Date().toISOString(),
    fetchContext: fetchContext
  };
}

async function runFetchProbe(gradesUrl, assignmentTitle, fetchContext) {
  try {
    var response = await fetch(gradesUrl, { credentials: 'include' });
    var body = await response.text();
    return buildEvidence(response, body, gradesUrl, assignmentTitle, fetchContext);
  } catch (err) {
    return {
      status: 0,
      finalUrl: gradesUrl,
      loggedIn: false,
      bodyLength: 0,
      containsAssignmentTitle: false,
      containsGrade: false,
      containsMissing: false,
      assignmentTitleChecked: assignmentTitle || null,
      checkedAt: new Date().toISOString(),
      fetchContext: fetchContext,
      error: String((err && err.message) || err)
    };
  }
}

async function appendResult(evidence) {
  var stored = await browser.storage.local.get(RESULTS_KEY);
  var results = Array.isArray(stored[RESULTS_KEY]) ? stored[RESULTS_KEY] : [];
  results.push(evidence);
  await browser.storage.local.set({ [RESULTS_KEY]: results });
  return results;
}

async function getContext() {
  var stored = await browser.storage.local.get(CONTEXT_KEY);
  return stored[CONTEXT_KEY] || null;
}

async function runHiddenTabProbe(gradesUrl, assignmentTitle) {
  var tab = await browser.tabs.create({ url: gradesUrl, active: false });
  try {
    // Wait for the content script's grades-page-seen for THIS tab, or
    // ask it directly once the page reports complete. 30 s cap.
    var scrape = await new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        finish(null);
      }, 30000);
      function finish(value) {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        browser.runtime.onMessage.removeListener(onSeen);
        resolve(value);
      }
      function onSeen(message, sender) {
        if (message && message.type === 'grades-page-seen' && sender.tab && sender.tab.id === tab.id) {
          finish(message);
        }
      }
      browser.runtime.onMessage.addListener(onSeen);
      // Also poll: once the tab is complete, ask the content script.
      var poll = setInterval(async function () {
        try {
          var current = await browser.tabs.get(tab.id);
          if (current.status === 'complete') {
            clearInterval(poll);
            var direct = await browser.tabs.sendMessage(tab.id, { type: 'scrape-now' });
            finish(direct);
          }
        } catch (e) {
          clearInterval(poll);
          finish(null);
        }
      }, 1000);
    });

    if (!scrape) {
      return {
        status: 0,
        finalUrl: gradesUrl,
        loggedIn: false,
        bodyLength: 0,
        containsAssignmentTitle: false,
        containsGrade: false,
        containsMissing: false,
        assignmentTitleChecked: assignmentTitle || null,
        checkedAt: new Date().toISOString(),
        fetchContext: 'hidden-tab',
        error: 'Timed out waiting for the hidden tab to render (30 s)'
      };
    }
    var titleToCheck = assignmentTitle || scrape.sampleTitle;
    return {
      status: 200,
      finalUrl: scrape.url,
      loggedIn: !scrape.url.includes('/login'),
      bodyLength: null,
      containsAssignmentTitle: !!(titleToCheck && scrape.sampleTitle === titleToCheck),
      containsGrade: true, // Rendered DOM was grade-like (content script only reports grades-like pages).
      containsMissing: scrape.domHasMissing,
      assignmentTitleChecked: titleToCheck || null,
      checkedAt: new Date().toISOString(),
      fetchContext: 'hidden-tab',
      sampleTitle: scrape.sampleTitle,
      domHasMissing: scrape.domHasMissing,
      note: 'Rendered-DOM evidence from a background tab, not a fetch. bodyLength is null: no HTML was fetched in this path.'
    };
  } finally {
    try {
      await browser.tabs.remove(tab.id);
    } catch (e) {
      /* Tab may already be closed by the user; nothing to do. */
    }
  }
}

browser.runtime.onMessage.addListener(function (message, sender) {
  if (!message || typeof message.type !== 'string') {
    return undefined;
  }

  if (message.type === 'grades-page-seen') {
    // Only accept captures from real Schoology tabs, never from the popup.
    if (sender.tab && sender.tab.url) {
      var context = {
        url: message.url,
        sampleTitle: message.sampleTitle || null,
        domHasMissing: !!message.domHasMissing,
        scrapedAt: message.scrapedAt || new Date().toISOString()
      };
      return browser.storage.local.set({ [CONTEXT_KEY]: context }).then(function () {
        return { ok: true };
      });
    }
    return Promise.resolve({ ok: false });
  }

  if (message.type === 'run-probe') {
    // Primary test: fetch from the SERVICE WORKER context.
    return (async function () {
      var context = message.gradesUrl ? null : await getContext();
      var gradesUrl = message.gradesUrl || (context && context.url);
      if (!gradesUrl) {
        return { ok: false, error: 'No Grades URL captured yet — visit a Schoology Grades page first.' };
      }
      var title = message.assignmentTitle || (context && context.sampleTitle) || null;
      var evidence = await runFetchProbe(gradesUrl, title, 'service-worker');
      await appendResult(evidence);
      return { ok: true, evidence: evidence };
    })();
  }

  if (message.type === 'hidden-tab-probe') {
    return (async function () {
      var context = message.gradesUrl ? null : await getContext();
      var gradesUrl = message.gradesUrl || (context && context.url);
      if (!gradesUrl) {
        return { ok: false, error: 'No Grades URL captured yet — visit a Schoology Grades page first.' };
      }
      var title = message.assignmentTitle || (context && context.sampleTitle) || null;
      var evidence = await runHiddenTabProbe(gradesUrl, title);
      await appendResult(evidence);
      return { ok: true, evidence: evidence };
    })();
  }

  if (message.type === 'record-evidence') {
    // The popup ran the fetch in ITS OWN page context and hands the
    // evidence here for storage, so all three paths live in one list.
    return appendResult(message.evidence).then(function () {
      return { ok: true };
    });
  }

  if (message.type === 'get-probe-state') {
    return (async function () {
      var stored = await browser.storage.local.get([RESULTS_KEY, CONTEXT_KEY]);
      return {
        ok: true,
        context: stored[CONTEXT_KEY] || null,
        results: Array.isArray(stored[RESULTS_KEY]) ? stored[RESULTS_KEY] : []
      };
    })();
  }

  if (message.type === 'clear-probe-results') {
    return browser.storage.local.remove(RESULTS_KEY).then(function () {
      return { ok: true };
    });
  }

  return undefined;
});
