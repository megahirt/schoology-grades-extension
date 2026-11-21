import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../mock-server/server.js';

const FAKE_BG = 'console.log("fake background");\n';
let dir;
let web;
let plain;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dist-web-'));
  mkdirSync(path.join(dir, 'popup'));
  writeFileSync(path.join(dir, 'background.js'), FAKE_BG);
  writeFileSync(path.join(dir, 'content.js'), 'console.log("fake content");\n');
  writeFileSync(path.join(dir, 'popup', 'dashboard.html'), '<!doctype html><title>d</title>');
  web = await startServer(0, { webExt: dir });
  plain = await startServer(0);
});
afterAll(async () => {
  await web.close();
  await plain.close();
});

// fetch() tidies `..` away before sending; this sends the path as written.
const rawStatus = (port, rawPath) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

describe('mock server with a web build of the extension', () => {
  it('serves /__ext files with the right type', async () => {
    const js = await fetch(`${web.url}/__ext/background.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/^(text|application)\/javascript/);
    expect(await js.text()).toBe(FAKE_BG);
    const html = await fetch(`${web.url}/__ext/popup/dashboard.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toMatch(/^text\/html/);
    expect((await fetch(`${web.url}/__ext/nope.js`)).status).toBe(404);
  });

  it('refuses paths outside dist-web', async () => {
    for (const p of ['/__ext/../package.json', '/__ext/%2e%2e/package.json']) {
      expect(await rawStatus(web.port, p)).toBe(404);
    }
  });

  it('injects the two scripts into mock pages', async () => {
    const html = await (await fetch(`${web.url}/login`)).text();
    expect(html).toContain('<script src="/__ext/background.js"></script><script src="/__ext/content.js"></script></body>');
  });

  it('no injection without webExt', async () => {
    const html = await (await fetch(`${plain.url}/login`)).text();
    expect(html).not.toContain('/__ext/');
  });
});
