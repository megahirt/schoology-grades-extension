# Promo site plan: Homework Dashboard for Schoology

Status: agreed with Chris on 2026-11-08 and built in the same PR (v1).
Lines marked **(my call)** are defaults Claude chose. Chris can change any of them.

## Why this site exists

Chris is the parent of three students at NPC, a school that uses Schoology.
He built this extension and needs two kinds of reader to say yes to it:

1. **Families (parents first, then students).** They arrive from an email or
   a QR code, usually on a phone. In the first 30 seconds they should feel
   they've finally found a way to keep their student accountable, to praise
   the student when things go well, and to stay on top of Schoology (homework,
   what's due, what's missing and grades) without effort.
2. **The people who have to approve it: NPC administrators, IT and teachers.**
   Students' school MacBooks only run Safari extensions that IT has approved.
   The site has to show three things: the extension **helps** (with research
   and honest citations), it's **safe** (read-only, no server, no data
   collected, open source), and it's **good for teachers** (fewer missing
   assignments, fewer surprises at report-card time).

Chris also wants teachers he knows and students with their own phones to try
it early, since school MacBooks can't install it yet.

## Tone and claims

- Calm and plain. Not overly bold, and no hype words.
- It is a *research-based* way to organize grades and homework. The site never
  claims the extension itself has been studied. The wording is "built on
  research about…", not "proven to…".
- Every feature section has a "What the research says" part and a "What we
  avoid" part. The avoid parts cover surveillance and over-monitoring,
  controlling homework help, rewards that crowd out motivation, streaks that
  reset to zero, and rankings.
- **Every page says "Made by an NPC dad. Not affiliated with NPC or
  Schoology."** Schoology is a trademark of its owner. The site never uses
  NPC's or Schoology's logos.
- Public repo rule: only made-up people (the Rivera family and the teachers
  Ms. Park, Mr. Ortiz, Mr. Chen, Mrs. Hall, Mr. Young and Ms. Teacher). No real
  grades, names or IDs anywhere, screenshots included.

## Site structure

| Page | File | For | Contents |
|---|---|---|---|
| Home | `site/index.html` | everyone | Headline, an install button that matches the visitor's device, the three goals (research-based, parents, students), a short feature tour with screenshots, and links to the other pages |
| Features & research | `site/features.html` | parents, students, admins | One section per feature with a desktop shot, a phone shot, "What the research says", "What we avoid" and citations |
| Install | `site/install.html` | everyone | Every browser, with honest notes about phones |
| For schools | `site/schools.html` | IT and administrators | Permissions, what it reads, where data lives, what it never does, open source, how to review the code, how to allow it on managed Macs |
| For NPC families | `site/npc.html` | NPC families | Short setup checklists for a parent and for a student |
| For teachers | `site/teachers.html` | teachers | What families see, what their Missing marks mean to families, and why missing-work alerts help |
| Research | `site/research.html` | anyone who checks sources | The full, numbered list of citations with DOIs |
| Privacy | `site/privacy.html` | required by the stores | Privacy policy: no data collected, everything stays in the browser |

**(my call)** NPC instructions: a dedicated "For NPC families" page with two
short checklists (parent and student), plus an NPC-specific note on the For
schools page about the IT approval Safari needs. The alternative was one
checklist on the home page. That's too long for the phone-first home page,
and the IT details don't belong there.

## Features, with the research behind each

Feature names are taken from `extension/src/*.js`. Numbers in brackets point
to the citation list below.

| Feature | What it does | Research for | What we avoid, and why |
|---|---|---|---|
| **GO / NO-GO** (parents only, optional) | One verdict per student from family rules: below the passing grade, or at the Missing limit, is NO-GO, and the reason is stated | Weekly alerts to parents about missing work and low grades cut course failures by 27% [1]. Parents underestimate missing work [1]. Rule-setting is the parent involvement that helps most [3] | Surveillance and control backfire. Parents mostly know what teens choose to tell them [6], and controlling involvement hurts [4, 5, 7]. So students never see a verdict, there are no alerts or pings, and the student sees the same information the parent sees |
| **Missing work first**, with "turned in" and "done" marks | Teacher-marked Missing items first, biggest first. The family can mark paper work turned in or done | Specific missing-work information is the active ingredient in [1]. Feedback works when it's about the task [9, 10] | A plain zero is never called Missing, and marks never notify anyone. That avoids false alarms and shaming |
| **Due today / tomorrow** | What's due in the next two days | Near goals beat distant ones [12]. Planning when and where to act helps people follow through [13] | No countdown timers and no nagging |
| **This week's ring** | Fills as this week's work is graded or turned in. Fresh every Monday | Watching progress toward a goal helps people reach it, more so when it's recorded [11]. Near goals build self-efficacy [12] | A weekly reset is a fresh goal, not a streak to lose. Broken streaks make people give up [15] |
| **Up since last quarter** ("▲ 6% vs Q1") | Shows only when a class went up | Comparing with your own past builds engagement [16]. Feedback about progress on the task works [9] | Drops show nothing. Feedback that turns attention to the self ("your grade dropped") often makes performance worse [10] |
| **Records** (personal bests) | Highest score, best week, longest run with nothing missing, highest class grade. They only go up | Personal-best goals predict engagement [16]. Praise effort and process, not ability [17] | No resets to zero, no rankings, no comparing siblings [15, 18]. No points, coins or badges to collect, because rewards for doing a task can crowd out motivation [8, 14] |
| **Doing well** | Recent good grades, so there's something specific to praise | Specific, task-focused praise [9, 17]. | No generic "great job!" and no praise for being smart [17] |
| **Grade trend and chart** | Each class's grade over time, with the passing line | Self-monitoring [11] | No class averages or peer data, so no comparison [18] |
| **Daily log** | Saves one entry per day in the browser, so trends and records are honest | Recording progress makes monitoring work better [11] | Stays on the device. Never sent anywhere |
| **Share a picture** | Copies a picture of the dashboard or opens the share menu | Talking about school and plans with your teen ("academic socialization") is the involvement most linked to achievement [2] | The family chooses who to share with. No social feed, no public scores |
| **Settings sliders** | Passing grade 60–80, Missing limit 1–6, Doing-well level 75–90. The verdict is on or off | Clear rules and structure from parents help [3, 7]. Autonomy support [7, 14] | Families set the bar together. Students see the same rules |

The parents-only "Message the teacher" button is deliberately **not** on the
site (Chris's call: it might cause issues). Don't mention it, and the
screenshot script hides its envelope buttons.

## Citations (all checked on 2026-11-08 with web searches, DOIs given)

1. Bergman, P., & Chan, E. W. (2021). Leveraging parents through low-cost technology: The impact of high-frequency information on student achievement. *Journal of Human Resources, 56*(1), 125–158. https://doi.org/10.3368/jhr.56.1.1118-9837R1. Weekly alerts about missed assignments, grades and absences cut course failures by 27% and raised class attendance by 12%. Effects were larger for high schoolers and lower-GPA students. The paper reports parents underestimate missed work ([J-PAL summary](https://www.povertyactionlab.org/node/2353)).
2. Hill, N. E., & Tyson, D. F. (2009). Parental involvement in middle school: A meta-analytic assessment of the strategies that promote achievement. *Developmental Psychology, 45*(3), 740–763. https://doi.org/10.1037/a0015362. Academic socialization is the strongest positive link. Direct homework help was negatively associated with achievement.
3. Patall, E. A., Cooper, H., & Robinson, J. C. (2008). Parent involvement in homework: A research synthesis. *Review of Educational Research, 78*(4), 1039–1101. https://doi.org/10.3102/0034654308325185. Rule-setting about homework had the strongest positive link of the strategies studied. Direct help had mixed or negative links in middle school.
4. Pomerantz, E. M., Moorman, E. A., & Litwack, S. D. (2007). The how, whom, and why of parents' involvement in children's academic lives: More is not always better. *Review of Educational Research, 77*(3), 373–410. https://doi.org/10.3102/003465430305567.
5. Dumont, H., Trautwein, U., Lüdtke, O., Neumann, M., Niggli, A., & Schnyder, I. (2012). Does parental homework involvement mediate the relationship between family background and educational outcomes? *Contemporary Educational Psychology, 37*(1), 55–69. https://doi.org/10.1016/j.cedpsych.2011.09.004. Intrusive and controlling homework involvement and conflict were linked to worse outcomes.
6. Kerr, M., & Stattin, H. (2000). What parents know, how they know it, and several forms of adolescent adjustment: Further support for a reinterpretation of monitoring. *Developmental Psychology, 36*(3), 366–380. https://doi.org/10.1037/0012-1649.36.3.366. What parents know comes mostly from what teens choose to tell them, not from tracking.
7. Grolnick, W. S., & Ryan, R. M. (1989). Parent styles associated with children's self-regulation and competence in school. *Journal of Educational Psychology, 81*(2), 143–154. https://doi.org/10.1037/0022-0663.81.2.143. Autonomy support, involvement and structure.
8. Deci, E. L., Koestner, R., & Ryan, R. M. (1999). A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin, 125*(6), 627–668. https://doi.org/10.1037/0033-2909.125.6.627. Rewards tied to doing or finishing a task lowered intrinsic motivation, more so for children. Positive feedback raised it.
9. Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*(1), 81–112. https://doi.org/10.3102/003465430298487.
10. Kluger, A. N., & DeNisi, A. (1996). The effects of feedback interventions on performance: A historical review, a meta-analysis, and a preliminary feedback intervention theory. *Psychological Bulletin, 119*(2), 254–284. https://doi.org/10.1037/0033-2909.119.2.254. Over a third of feedback interventions lowered performance, more so when feedback pulled attention toward the self.
11. Harkin, B., Webb, T. L., Chang, B. P. I., Prestwich, A., Conner, M., Kellar, I., Benn, Y., & Sheeran, P. (2016). Does monitoring goal progress promote goal attainment? A meta-analysis of the experimental evidence. *Psychological Bulletin, 142*(2), 198–229. https://doi.org/10.1037/bul0000025. Across 138 studies, d = 0.40. The effect was larger when progress was physically recorded or reported.
12. Bandura, A., & Schunk, D. H. (1981). Cultivating competence, self-efficacy, and intrinsic interest through proximal self-motivation. *Journal of Personality and Social Psychology, 41*(3), 586–598. https://doi.org/10.1037/0022-3514.41.3.586.
13. Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions and goal achievement: A meta-analysis of effects and processes. *Advances in Experimental Social Psychology, 38*, 69–119. https://doi.org/10.1016/S0065-2601(06)38002-1.
14. Ryan, R. M., & Deci, E. L. (2000). Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being. *American Psychologist, 55*(1), 68–78. https://doi.org/10.1037/0003-066X.55.1.68.
15. Silverman, J., & Barasch, A. (2023). On or off track: How (broken) streaks affect consumer decisions. *Journal of Consumer Research, 49*(6), 1095–1117. https://doi.org/10.1093/jcr/ucac029. Broken streaks lower future engagement, more so when people blame themselves.
16. Martin, A. J., & Liem, G. A. D. (2010). Academic personal bests (PBs), engagement, and achievement: A cross-lagged panel analysis. *Learning and Individual Differences, 20*(3), 265–270. https://doi.org/10.1016/j.lindif.2010.01.001.
17. Mueller, C. M., & Dweck, C. S. (1998). Praise for intelligence can undermine children's motivation and performance. *Journal of Personality and Social Psychology, 75*(1), 33–52. https://doi.org/10.1037/0022-3514.75.1.33.
18. Hanus, M. D., & Fox, J. (2015). Assessing the effects of gamification in the classroom: A longitudinal study on intrinsic motivation, social comparison, satisfaction, effort, and academic performance. *Computers & Education, 80*, 152–161. https://doi.org/10.1016/j.compedu.2014.08.019. Badges, a leaderboard and coins lowered motivation and final exam scores over a semester. Also: Jivet, I., Scheffel, M., Drachsler, H., & Specht, M. (2017). Awareness is not enough: Pitfalls of learning analytics dashboards in the educational practice. *EC-TEL 2017, LNCS 10474*, 82–96. https://doi.org/10.1007/978-3-319-66610-5_7.

Background reading (not cited on the site): the earlier research report in
this project's notes, "Reward the week, not the login" (2026-11-07).

## Install links and the phone reality check

| Browser | Route | Status today |
|---|---|---|
| Safari on Mac | Mac App Store (a wrapper app with the extension inside) | Not listed yet. Needs the $99/yr Apple Developer Program and App Review (`docs/safari.md`). On school MacBooks, IT must also allow it |
| Safari on iPhone and iPad | App Store, the same as on Mac | Not listed yet. It's the main route for students with their own phones |
| Chrome (desktop) | Chrome Web Store | Not listed yet (`docs/chrome-web-store-setup.md`) |
| Edge (desktop) | Edge Add-ons, or Chrome Web Store installs (Edge allows them) | Not listed yet |
| Firefox (desktop) | addons.mozilla.org | Not listed yet. The Firefox build exists (`npm run build:firefox`) |
| Firefox on Android | addons.mozilla.org, if the listing is marked Android-compatible | Not listed yet. **Untested on Android** |
| Chrome on Android or iPhone | — | **Not possible.** Chrome on phones doesn't run extensions (as of 2026). The site says so and points to Firefox on Android or Safari on iPhone |
| Edge on Android | — | Only a short, hand-picked list of extensions, so not a realistic route |
| The Schoology phone app | — | **Not possible.** The extension works on the Schoology *website* in a browser, not inside Schoology's own app |

**(my call)** Each store button reads "Coming soon" until its listing is
live. Every store URL lives in one file (`site/links.js`), so turning a
button on is a one-line change. Until the listings exist, "Try it early"
points to the GitHub Releases page, with load-unpacked steps for testers
(teachers, and parents on a laptop).

The home page's install button picks the visitor's device: iPhone or iPad →
Safari, Android → Firefox, Mac → Safari, Windows → Chrome or Edge, and
everything else → the Install page.

## Screenshots

The screenshots are the main work. They're made by a script, so they stay
current.

- **Data:** a new "showcase" data set in the mock server
  (`test/mock-server/showcase.js`, chosen with `MOCK_DATA=showcase` or
  `createServer({ dataset: 'showcase' })`). The existing test personas stay
  unchanged, so no tests move.
  - Parent persona: two children with **8 classes each**. **Sam Rivera** is
    doing well (GO, one Missing, a class up since Q1, lots of "Doing well").
    **Jamie Rivera** is NO-GO (3 Missing, one class below the line). Both have
    work due today and tomorrow, and a half-full ring.
  - Student persona: **Sam Rivera**, with the same data the parent sees.
    That shows the student sees what the parent sees.
  - Teachers: Ms. Park, Mr. Ortiz, Mr. Chen, Mrs. Hall, Mr. Young and Ms.
    Teacher.
  - **Dates are relative to the day the script runs**, so "due today",
    "this week" and "▲ vs Q1" always look current.
- **Script:** `npm run site:screenshots` (`scripts/site-screenshots.mjs`).
  It needs a dev build (`npm run build:dev`). It starts the mock server with
  the showcase data, launches Chromium with the extension, logs in, refreshes
  and seeds two weeks of daily log so Records shows a run. Then it captures:
  - desktop (1280×800 at 2×): the parent panel, the student panel, the Missing
    card, the grade chart, Records, the settings page and
    the popup;
  - phone (390×844 at 3×, iPhone size): the same views, each placed in a drawn
    phone frame (CSS, no Apple artwork) and saved as a second image.
  - Output goes to `site/img/` and is committed. Re-run after UI changes.
- **Run it on a Mac.** The share button draws Apple's share icon on Apple
  devices, and the site should show what most NPC families (Macs and iPhones)
  will see.
- Alternatives considered: hand-taken screenshots (go stale), and the
  extension's bundled demo data (only two to three classes, and changing it
  would change the product's own demo).

## Hosting

**(my call)** Plain static HTML and CSS in `site/`, published by a GitHub
Actions workflow (`.github/workflows/pages.yml`) that uploads `site/` to
GitHub Pages. There's no build step and no generator. Reasons: `docs/`
already holds developer notes that shouldn't be published, a `gh-pages`
branch drifts from the code, and eight pages don't need a generator.

One-time step for Chris: GitHub → repo **Settings → Pages → Source: GitHub
Actions**. The site will then be at
`https://megahirt.github.io/schoology-grades-extension/`.

## Not in v1 (later)

- Real store links (when listings exist), and a QR code image that points to
  the home page.
- A short screen recording.
- Checking that it runs in Firefox on Android and Safari on iPhone. Until
  then, the site says these are "coming soon", not "works".
- A custom domain.
