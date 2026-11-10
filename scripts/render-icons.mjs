// Renders site/img/logo.svg to the extension's toolbar and store icons.
// Usage: node scripts/render-icons.mjs  (uses your installed Google Chrome)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../site/img/logo.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: new URL(`../extension/icons/icon${size}.png`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
