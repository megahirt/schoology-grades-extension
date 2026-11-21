// Web feature suite: the student persona on the dashboard page
// (/__ext/popup/dashboard.html), as the Playwright original did in Chromium.
// Ported from test/e2e/extension.spec.js "student persona: 1 Missing, no
// verdict shown to students, quarter grades". See test/web/helpers.mjs.
/* global shown */ // in page-side readers: see inDashboard (helpers.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAIT_PREFIX, attr, attrIn, clickDashboard, count, countIn, expectDashboard, hoverDashboard, inDashboard, refreshNow, shownCount, shownIn, shownText, signIn, skipReason, text,
  textIn, freshStart, useMock, visible, withSession,
} from './helpers.mjs';


test('student persona: 1 Missing, no verdict shown to students, quarter grades', { skip: skipReason(), timeout: 240_000 }, async () => {
  await withSession(async ({ browser, base }) => {
    await freshStart({ browser, base });
    const see = (read, expected, message, ...args) => expectDashboard(browser, read, expected, message, { args });
    await signIn(browser, base, 'student');
    await useMock(browser, base);
    await browser.url(`${base}/__ext/popup/dashboard.html`);
    await refreshNow(browser, base);

    // Alex Student's data: Algebra 2 at 68% (below 75) is a low class, and
    // American Literature has 1 Missing item. The student's name comes from
    // the home page (data-user-name).
    await see(shownText, 'Hi, Alex', 'heading shown', 'h1, h2, h3, [role="heading"]', 'Hi, Alex');
    // The same card as parents get, without the GO/NO-GO verdict (parents only).
    await see(text, 'Alex Student', 'card name', '.card .card-name');
    await see(text, /^1\s*Missing$/, 'Missing stat', '.card .stat', 'Missing');
    assert.equal(await inDashboard(browser, (root, q) => q('*').filter((e) => !e.children.length && /^(NO-GO|GO)$/.test(e.textContent.trim())).length), 0, 'no GO/NO-GO text');
    assert.equal(await inDashboard(browser, count, '.card-head [role="img"][aria-label="NO-GO"], .card-head .pill'), 0, 'no verdict disc or pill');
    await see(visible, true, 'Missing · 1 shown', 'Missing · 1');
    await see(shownCount, 1, 'Persuasive Essay Draft Missing card shown', '.missing-card', 'Persuasive Essay Draft');
    // Algebra 2 has nested quarters: Quarter 2 (68%) with Semester 1 (74%) beside it.
    await see(text, 'Q2', 'quarter column', '.class-cols .col-q');
    await see(text, 'Sem', 'semester column', '.class-cols .col-o');
    await see(visible, true, 'quarter dates', 'Quarter 2 is from Oct 19 to Dec 15.');
    // Down on Quarter 1 (80% -> 68%): no "vs Q1" pill.
    await see(countIn, 0, 'no up-pill on Algebra 2', '.class', 'Algebra 2', '.up-pill');

    // The class name opens its grade chart; clicking again closes it.
    await clickDashboard(browser, 'button.class-toggle', { within: '.class', withinText: 'Algebra 2' });
    await see(attrIn, 'true', 'Algebra 2 expanded', '.class', 'Algebra 2', 'button.class-toggle', 'aria-expanded');
    await see(shownIn, 1, 'Algebra 2 chart shown', '.class', 'Algebra 2', 'svg.gchart');
    await see(countIn, 2, 'two graded Algebra 2 items', '.class', 'Algebra 2', 'svg.gchart .gc-dot');
    await see(countIn, 1, 'dashed passing line', '.class', 'Algebra 2', 'svg.gchart .gc-pass');
    await see(attrIn, `${base}/course/1001/student_grades`, 'chart link', '.class', 'Algebra 2', 'a.chart-link', 'href');
    await see(textIn, /Highest score/, 'class best', '.class', 'Algebra 2', '.class-best');
    // Desktop hover shows the nearest assignment: date, title and its grade.
    await hoverDashboard(browser, '.class svg.gchart .gc-hit', { fx: 0.9 });
    await see(attrIn, 'visible', 'hover marker', '.class', 'Algebra 2', 'svg.gchart .gc-hover', 'visibility');
    await see(textIn, /^[A-Z][a-z]{2} \d{1,2} · Factoring Worksheet · 70%$/, 'hover tip', '.class', 'Algebra 2', 'svg.gchart .gc-tip');
    await clickDashboard(browser, '.class-row .week-row', { within: '.class', withinText: 'Algebra 2' }); // anywhere on the row toggles too
    await see(countIn, 0, 'Algebra 2 chart closed', '.class', 'Algebra 2', 'svg.gchart');
    // Assignment titles link to Schoology.
    await see(attr, /\/assignment\/5101$/, 'essay link', '.missing-card a.item-title', 'Persuasive Essay Draft', 'href');
    await see(textIn, '68', 'Algebra 2 quarter grade', '.class', 'Algebra 2', '.class-grade');
    await see(textIn, '74', 'Algebra 2 semester grade', '.class', 'Algebra 2', '.class-overall');
    // A class with no quarter grade shows a dash; its semester grade stands.
    await see(textIn, '—', 'Literature quarter grade', '.class', 'American Literature', '.class-grade');
    await see(textIn, '82', 'Literature semester grade', '.class', 'American Literature', '.class-overall');
    // This week's bar: last week's Missing essay carries into this week.
    await see(attrIn, 'American Literature: 0 of 1 done this week', 'Literature bar', '.class', 'American Literature', '.seg-bar', 'aria-label');
    await see(textIn, '0 of 1', 'Literature week label', '.class', 'American Literature', '.week-label');
    // Opening a class lists this week's work and any Missing work above its chart.
    await clickDashboard(browser, '.class-row', { within: '.class', withinText: 'American Literature' });
    await see((root, q) => {
      const wk = q('.class', 'American Literature').flatMap((c) => q('.wk', 'Persuasive Essay Draft', c))[0];
      return shown(wk && wk.querySelector('[role="img"][aria-label="Missing"], img[alt="Missing"]'));
    }, true, 'Missing icon shown on the essay in its class');
    await clickDashboard(browser, '.class-row', { within: '.class', withinText: 'American Literature' });
    await see(countIn, 0, 'Literature week list closed', '.class', 'American Literature', '.week-list');
    // Submitted, ungraded work waits on the teacher (no Undo: Schoology reported it).
    await see(shownCount, 1, 'Poetry Journal waiting, shown', '.waiting', 'Poetry Journal');
    await see(text, (t) => t !== null && !/Submitted/.test(t), 'journal has no Submitted text', '.waiting', 'Poetry Journal');
    assert.equal(await inDashboard(browser, (root, q) => q('button', null, q('.waiting', 'Poetry Journal')[0]).filter((b) => /Undo/.test(b.getAttribute('aria-label') || b.textContent)).length), 0, 'no Undo on the journal');
    await see(countIn, 0, 'journal not marked Missing', '.waiting', 'Poetry Journal', '.missing-tag');

    // Marking the Missing item turned in (students only): a notice explains
    // it's only a note; "I understand" applies the mark.
    const essay = '.missing-card';
    const ESSAY = 'Persuasive Essay Draft';
    const markEssay = () => clickDashboard(browser, 'button', { within: essay, withinText: ESSAY, label: /as turned in$/ });
    const undoEssay = () => clickDashboard(browser, 'button', { within: essay, withinText: ESSAY, label: /^Undo: Persuasive Essay Draft$/ });
    await markEssay();
    await see(text, /doesn't submit it or turn it in for you/, 'mark notice', '[role="alertdialog"]');
    await see(visible, true, 'not marked yet', 'Missing · 1');
    await clickDashboard(browser, 'button', { hasText: 'I understand' });
    await see(count, 0, 'notice closed', '[role="alertdialog"]');
    // The week's done count went up, so the rocket flies along the bar.
    await see((root, q) => q('.wk-rocket').some((e) => e.classList.contains('fly')), true, 'rocket flies');
    // It stays where it is, struck through, with Undo; the counts go down.
    await see((root, q, s, h) => q(s, h)[0]?.classList.contains('marked') ?? null, true, 'essay marked', essay, ESSAY);
    await see(visible, true, 'Missing · 0', 'Missing · 0');
    await see(textIn, '1 of 1', 'Literature week label after mark', '.class', 'American Literature', '.week-label');
    // Not moved to Submitted, not graded yet (only the journal is there).
    await see(visible, true, 'Submitted count', 'Submitted, not graded yet · 1');
    await see(count, 0, 'essay not waiting', '.waiting', ESSAY);
    // Undo puts it back. The notice shows again on the next mark, until
    // "Do not show again" is ticked.
    await undoEssay();
    await see(visible, true, 'Missing · 1 after undo', 'Missing · 1');
    await see(textIn, '0 of 1', 'Literature week label after undo', '.class', 'American Literature', '.week-label');
    await markEssay();
    await clickDashboard(browser, 'input#sgd-mark-skip');
    await see((root) => root.querySelector('#sgd-mark-skip')?.checked ?? null, true, 'Do not show again ticked');
    await clickDashboard(browser, 'button', { hasText: 'I understand' });
    await see(visible, true, 'Missing · 0 (2)', 'Missing · 0');
    await undoEssay();
    await see(visible, true, 'Missing · 1 (2)', 'Missing · 1');
    await markEssay();
    await see(visible, true, 'Missing · 0 (3)', 'Missing · 0');
    assert.equal(await inDashboard(browser, count, '[role="alertdialog"]'), 0, 'no notice now');
    await undoEssay();
    await see(visible, true, 'Missing · 1 (3)', 'Missing · 1');

    // New since you last looked. The first look: nothing is news.
    await see(count, 0, 'nothing new on the first look', '.new-in, .new-cue');
    const seenKey = () => browser.execute(() => Object.keys(localStorage).find((k) => k.startsWith('sgd:seenItems')) || null);
    await browser.waitUntil(seenKey, { timeout: 15_000, interval: 200, timeoutMsg: `${WAIT_PREFIX} no seenItems saved` });
    // Forget the Missing item and the good news, as if they had just appeared.
    // (Storage is the shim's localStorage; the page reloads right after.)
    await browser.execute(() => {
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith('sgd:seenItems')) continue;
        const v = JSON.parse(localStorage.getItem(k));
        for (const uid of Object.keys(v)) v[uid] = v[uid].filter((key) => !/^(missing|grade|record|up):/.test(key));
        localStorage.setItem(k, JSON.stringify(v));
      }
    });
    await browser.refresh();
    // The Missing item fades in; it is not good news, so no celebration.
    await see(count, 1, 'Missing item fades in', '.missing-card.new-in');
    // Good news (a good grade, a record, a class up): one celebration only.
    assert.ok((await inDashboard(browser, count, '[data-cue]')) > 0, 'good news to celebrate');
    await inDashboard(browser, (root) => root.querySelector('[data-cue]').scrollIntoView({ block: 'center' }));
    await see(count, 1, 'one celebration', '.new-cue');
    // Seen now (once that's saved): nothing is news on the next look.
    const newKeys = await inDashboard(browser, (root) => [...root.querySelectorAll('[data-new]')].map((el) => el.dataset.new));
    await inDashboard(browser, (root) => [...root.querySelectorAll('[data-new]')].pop().scrollIntoView({ block: 'center' }));
    await browser.waitUntil(
      () => browser.execute((keys) => {
        const saved = Object.keys(localStorage).filter((k) => k.startsWith('sgd:seenItems'))
          .flatMap((k) => Object.values(JSON.parse(localStorage.getItem(k))).flat());
        return keys.every((k) => saved.includes(k));
      }, newKeys),
      { timeout: 15_000, interval: 200, timeoutMsg: `${WAIT_PREFIX} not all shown items saved as seen: ${JSON.stringify(newKeys)}` },
    );
    await browser.refresh();
    await see(shownCount, 1, 'card name shown after reload', '.card-name');
    await see(count, 0, 'nothing new after seeing it', '.new-in, .new-cue');
    await browser.execute(() => window.scrollTo(0, 0));
    // Dev builds: "Replay animations" plays them all again on request.
    await clickDashboard(browser, 'button', { hasText: 'Replay animations' });
    await see(count, 1, 'replayed Missing fade-in', '.missing-card.new-in');
    await inDashboard(browser, (root) => root.querySelector('[data-cue]').scrollIntoView({ block: 'center' }));
    await see((root) => shown(root.querySelector('.new-cue')), true, 'replayed celebration shown');
    await browser.execute(() => window.scrollTo(0, 0));

    // Each section heading carries its emoji.
    await see(shownIn, 1, 'Missing heading icon shown', '.sec-h', 'Missing', 'img.missing-icon');
    await see(textIn, '🏛️', 'Classes heading emoji', '.sec-h', 'Classes', '.sec-emoji');
    // Header: the extension's logo beside the title.
    await see(shownCount, 1, 'header logo shown', '.head-row img.head-logo');
    // Footer: a small About link to the promo site, in a new tab.
    await see(text, 'About', 'About link', '.credit .about-link');
    await see(attr, 'https://schoology.hirtfamily.net/', 'About href', '.credit .about-link', null, 'href');
    await see(attr, '_blank', 'About target', '.credit .about-link', null, 'target');
  });
});
