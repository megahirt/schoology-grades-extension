/* Schoology Live Probe — content script.
 *
 * Read-only. It NEVER modifies the Schoology page: it only reads the
 * rendered DOM, captures the exact Grades page URL the user is looking at,
 * and reports one sample assignment title + whether "Missing" text appears.
 *
 * It does NOT guess URL patterns for fetching. The URL it reports is the
 * URL the probe later fetches — whatever the logged-in UI actually used.
 *
 * Runs on https://*.schoology.com/* (see manifest.json). It only sends a
 * 'grades-page-seen' message when the page looks like a Grades page:
 * the URL contains "grade" OR the rendered page contains grade-like
 * content (a grades table / course grade / "Missing" marker). That
 * heuristic only decides whether to report; it never constructs a URL.
 */

(function () {
  'use strict';

  function scrapeGradesPage() {
    var bodyText = document.body ? document.body.innerText || '' : '';
    var domHasMissing = /missing/i.test(bodyText);

    // One sample assignment title from the rendered DOM. Try the most
    // specific selectors first, then fall back to the first plausible
    // table-row cell. This is a SAMPLE for the fetch comparison only —
    // the probe does not depend on any one selector being right.
    var sampleTitle = null;
    var candidates = document.querySelectorAll(
      '.assignment-title, ' +
        'td.assignment-title, ' +
        'a[href*="assignment"], ' +
        'table.grades-table tbody tr td:first-child, ' +
        'table tbody tr td:first-child'
    );
    for (var i = 0; i < candidates.length; i++) {
      var text = (candidates[i].textContent || '').trim().replace(/\s+/g, ' ');
      // Skip navigation / chrome text and implausibly short or long strings.
      if (text.length >= 3 && text.length <= 120 && !/^(home|courses|grades|calendar|messages|resources)$/i.test(text)) {
        sampleTitle = text;
        break;
      }
    }

    var urlLooksLikeGrades = /grade/i.test(window.location.href);
    var domLooksLikeGrades =
      !!document.querySelector('table.grades-table, .gradebook, .course-grades, .course-grade') ||
      /grade report|grades/i.test(bodyText.slice(0, 2000));

    return {
      type: 'grades-page-seen',
      url: window.location.href,
      sampleTitle: sampleTitle,
      domHasMissing: domHasMissing,
      isGradesLike: urlLooksLikeGrades || domLooksLikeGrades,
      scrapedAt: new Date().toISOString()
    };
  }

  function reportIfGradesPage() {
    var result = scrapeGradesPage();
    if (!result.isGradesLike) {
      return null;
    }
    // The background stores this as the probe context (exact URL + sample).
    browser.runtime.sendMessage(result).catch(function () {
      /* Popup/background may not be listening; the scrape-now path below
         covers the hidden-tab flow, which asks explicitly. */
    });
    return result;
  }

  // Report shortly after load (grades content may render after document_idle).
  // A single delayed re-check covers pages that fill in via JS.
  reportIfGradesPage();
  setTimeout(reportIfGradesPage, 3000);

  // The background asks for a fresh scrape when it opens this page in a
  // hidden tab: reply synchronously with the rendered-DOM evidence.
  browser.runtime.onMessage.addListener(function (message) {
    if (message && message.type === 'scrape-now') {
      return Promise.resolve(scrapeGradesPage());
    }
    return undefined;
  });
})();
