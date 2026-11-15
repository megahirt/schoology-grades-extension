# Building the Firefox package from source

For Mozilla's add-on reviewers. This is the full source of **Grades
Dashboard for Schoology** (also public at
<https://github.com/megahirt/schoology-grades-extension>). The uploaded
package is built from it with [esbuild](https://esbuild.github.io/), which
bundles the modules into one file per page. Nothing is minified or
obfuscated.

## Requirements

- Linux, macOS or Windows
- Node.js 24 (any 24.x) with its npm

The only build tools are npm packages pinned in `package-lock.json`
(esbuild). No network access is needed after `npm ci`.

## Steps

Use the version shown on the submission, for example `1.3.0`:

```bash
npm ci
RELEASE_VERSION=1.3.0 node scripts/build.mjs --firefox
```

The package's contents are now in `dist-firefox/`. They match the uploaded
file exactly.

## Where things are

| Path | What it is |
|---|---|
| `extension/` | The extension's source: `manifest.json`, `background.js`, `content.js`, `src/`, `popup/`, `options/`, `icons/` |
| `scripts/build.mjs` | The build script |
| `scripts/manifest-firefox.mjs` | The manifest changes for Firefox (background script, add-on ID, data collection declaration) |
| `test/` | Unit and end-to-end tests (not needed to build) |
