/* Schoology Live Probe — popup.
 *
 * Three probes, run in order. Each records its own evidence entry in
 * browser.storage.local under 'probeResults' (via the background), with
 * its own fetchContext so the three paths can be compared:
 *   1. service-worker — the background fetches the Grades URL.
 *   2. popup — THIS page fetches the same URL (same code, different
 *      execution context: an extension page with a DOM).
 *   3. hidden-tab — the background opens the URL in a background tab,
 *      lets the content script read the rendered DOM, then closes it.
 *
 * Verdict (plain language, shown in the popup):
 *   PROVEN — the latest service-worker entry has loggedIn=true AND
 *     containsAssignmentTitle AND containsMissing matches what the
 *     content script saw in the rendered DOM.
 *   FAILED — a service-worker entry exists but does not meet PROVEN.
 *   INCONCLUSIVE — no service-worker entry yet, or no DOM capture to
 *     compare against. A FAILED/PROVEN verdict needs both sides.
 */

(function () {
  'use strict';

  var contextEl = document.getElementById('context');
  var verdictEl = document.getElementById('verdict');
  var latestEl = document.getElementById('latest');
  var btnSw = document.getElementById('btn-sw');
  var btnPopup = document.getElementById('btn-popup');
  var btnHiddenTab = document.getElementById('btn-hidden-tab');
  var btnCopy = document.getElementById('btn-copy');
  var btnClear = document.getElementById('btn-clear');

  var state = { context: null, results: [] };

  function isLoginPage(finalUrl, body) {
    if (finalUrl && finalUrl.includes('/login')) {
      return true;
    }
    return /<form[^>]*\b(login|sign-?in)\b/i.test(body) || (/type=["']password["']/i.test(body) && /log\s?in/i.test(body));
  }

  // Same evidence shape as the background's runFetchProbe, executed here
  // in the popup page context instead of the service worker.
  async function runPopupFetch(gradesUrl, assignmentTitle) {
    try {
      var response = await fetch(gradesUrl, { credentials: 'include' });
      var body = await response.text();
      return {
        status: response.status,
        finalUrl: response.url,
        loggedIn: !isLoginPage(response.url, body),
        bodyLength: body.length,
        containsAssignmentTitle: assignmentTitle ? body.includes(assignmentTitle) : false,
        containsGrade: /\b\d{1,3}(\.\d+)?\s*%/.test(body) || /grades-table|course-grade|gradebook/i.test(body),
        containsMissing: /missing/i.test(body),
        assignmentTitleChecked: assignmentTitle || null,
        checkedAt: new Date().toISOString(),
        fetchContext: 'popup'
      };
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
        fetchContext: 'popup',
        error: String((err && err.message) || err)
      };
    }
  }

  function render() {
    if (state.context) {
      contextEl.textContent =
        'URL: ' + state.context.url +
        '\nSample title: ' + (state.context.sampleTitle || '(none found)') +
        '\nRendered DOM has "Missing": ' + (state.context.domHasMissing ? 'yes' : 'no') +
        '\nCaptured: ' + state.context.scrapedAt;
    } else {
      contextEl.textContent = 'No Grades page captured yet. Open a Schoology Grades page in a tab first, wait a few seconds, then reopen this popup.';
    }

    var hasUrl = !!(state.context && state.context.url);
    btnSw.disabled = !hasUrl;
    btnPopup.disabled = !hasUrl;
    btnHiddenTab.disabled = !hasUrl;

    var swEntries = state.results.filter(function (r) { return r.fetchContext === 'service-worker'; });
    var latestSw = swEntries.length ? swEntries[swEntries.length - 1] : null;
    var latest = state.results.length ? state.results[state.results.length - 1] : null;

    if (latest) {
      latestEl.textContent = JSON.stringify(latest, null, 2);
    } else {
      latestEl.textContent = 'No probe results yet.';
    }

    verdictEl.className = 'inconclusive';
    if (!latestSw) {
      verdictEl.textContent = 'Verdict: not run yet. Run probe 1 (service worker) first.';
    } else if (!state.context) {
      verdictEl.textContent = 'Verdict: INCONCLUSIVE — service-worker fetch ran, but no rendered-DOM capture exists to compare "Missing" against. Visit a Grades page first, then re-run.';
    } else if (latestSw.loggedIn && latestSw.containsAssignmentTitle && latestSw.containsMissing === state.context.domHasMissing) {
      verdictEl.className = 'proven';
      verdictEl.textContent = 'Verdict: PROVEN — service-worker fetch returned the logged-in Grades page, found the assignment title, and "Missing" matches the rendered DOM.';
    } else {
      verdictEl.className = 'failed';
      verdictEl.textContent = 'Verdict: FAILED — service-worker fetch did not return the logged-in Grades page with the assignment title and matching "Missing". See the evidence below; try probes 2 and 3 to see if another path works.';
    }
  }

  async function refresh() {
    try {
      var reply = await browser.runtime.sendMessage({ type: 'get-probe-state' });
      if (reply && reply.ok) {
        state.context = reply.context;
        state.results = reply.results;
      }
    } catch (err) {
      latestEl.textContent = 'Could not reach the probe background: ' + String((err && err.message) || err);
    }
    render();
  }

  function setBusy(disabled) {
    btnSw.disabled = disabled;
    btnPopup.disabled = disabled;
    btnHiddenTab.disabled = disabled;
  }

  btnSw.addEventListener('click', async function () {
    setBusy(true);
    try {
      await browser.runtime.sendMessage({ type: 'run-probe' });
    } finally {
      setBusy(false);
      refresh();
    }
  });

  btnPopup.addEventListener('click', async function () {
    setBusy(true);
    try {
      var evidence = await runPopupFetch(state.context.url, state.context.sampleTitle);
      await browser.runtime.sendMessage({ type: 'record-evidence', evidence: evidence });
      state.results.push(evidence);
    } finally {
      setBusy(false);
      refresh();
    }
  });

  btnHiddenTab.addEventListener('click', async function () {
    setBusy(true);
    latestEl.textContent = 'Hidden-tab probe running (up to 30 s)…';
    try {
      await browser.runtime.sendMessage({ type: 'hidden-tab-probe' });
    } finally {
      setBusy(false);
      refresh();
    }
  });

  btnCopy.addEventListener('click', async function () {
    var payload = JSON.stringify({ context: state.context, results: state.results }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      btnCopy.textContent = 'Copied.';
      setTimeout(function () { btnCopy.textContent = 'Copy all results (JSON)'; }, 2000);
    } catch (err) {
      latestEl.textContent = payload;
    }
  });

  btnClear.addEventListener('click', async function () {
    await browser.runtime.sendMessage({ type: 'clear-probe-results' });
    refresh();
  });

  refresh();
})();
