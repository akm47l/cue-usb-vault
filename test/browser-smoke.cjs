const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const { chromium } = require('playwright-core');

globalThis.crypto = webcrypto;
globalThis.JSZip = require('jszip');
const Core = require('../src/vault-core.js');

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-vault-smoke-'));
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const sourcePath = path.join(temp, 'input-arabic.txt');
    await fs.writeFile(sourcePath, 'محتوى اختباري محلي\n');
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../CueVault.html')).href);
    assert.match(await page.title(), /خزنة Cue/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile viewport should not overflow horizontally');
    const support = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: Boolean(window.crypto?.subtle), zip: typeof window.JSZip }));
    assert.deepEqual(support, { secure: true, subtle: true, zip: 'function' });

    await page.locator('#create-files').setInputFiles(sourcePath);
    await page.locator('#create-password').fill('كلمة مرور اختبار طويلة 2026');
    await page.locator('#confirm-password').fill('كلمة مرور اختبار طويلة 2026');
    const [vaultDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#create-button').click()
    ]);
    const vaultPath = await vaultDownload.path();
    const vaultBytes = new Uint8Array(await fs.readFile(vaultPath));
    const nodeOpened = await Core.openVault(vaultBytes, 'كلمة مرور اختبار طويلة 2026');
    assert.equal(nodeOpened.entries.length, 1);
    assert.equal(new TextDecoder().decode(await Core.extractFile(nodeOpened, 'input-arabic.txt')), 'محتوى اختباري محلي\n');

    await page.locator('#tab-open').click();
    await page.locator('#open-vault-file').setInputFiles(vaultPath);
    await page.locator('#open-password').fill('كلمة مرور خاطئة للاختبار');
    await page.locator('#open-button').click();
    await page.locator('#open-status.error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#open-status').textContent(), /غير صحيحة|تالف/);
    await page.locator('#open-password').fill('كلمة مرور اختبار طويلة 2026');
    await page.locator('#open-button').click();
    await page.locator('#opened-panel').waitFor({ state: 'visible' });
    assert.match(await page.locator('#opened-summary').textContent(), /1 ملف/);
    const [plainDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.file-row button').click()
    ]);
    assert.equal(await fs.readFile(await plainDownload.path(), 'utf8'), 'محتوى اختباري محلي\n');
    await page.locator('#close-vault-button').click();
    assert.deepEqual(await page.evaluate(() => window.__CUEVAULT_TEST__.getState()), { open: false, files: 0 });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    console.log('PASS: Chromium file:// + WebCrypto + عرض هاتف بلا تجاوز + إنشاء وتنزيل الخزنة + رفض كلمة مرور خاطئة + فتحها وتنزيل ملف عربي + إغلاقها + بلا طلبات شبكة.');
    await context.close();
  } finally {
    await browser.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
