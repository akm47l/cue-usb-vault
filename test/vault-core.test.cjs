const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
globalThis.JSZip = require('jszip');
const Core = require('../src/vault-core.js');

(async () => {
  const files = [
    { name: 'مجلد/رسالة.txt', data: new TextEncoder().encode('مرحبا من الخزنة') },
    { name: 'empty.bin', data: new Uint8Array(0) },
    { name: 'binary.dat', data: new Uint8Array([0, 1, 2, 127, 128, 255]) }
  ];
  const pass = 'كلمة مرور تجريبية 2026';
  const vault = await Core.createVault(files, pass);
  assert.equal(String.fromCharCode(...vault.slice(0, 4)), 'VLT1');
  assert.equal(new DataView(vault.buffer, vault.byteOffset).getUint32(8), Core.ITERATIONS);
  const opened = await Core.openVault(vault, pass);
  assert.deepEqual(opened.entries.map((entry) => entry.name).sort(), ['binary.dat', 'empty.bin', 'مجلد/رسالة.txt'].sort());
  assert.equal(new TextDecoder().decode(await Core.extractFile(opened, 'مجلد/رسالة.txt')), 'مرحبا من الخزنة');
  assert.deepEqual([...await Core.extractFile(opened, 'binary.dat')], [0, 1, 2, 127, 128, 255]);
  assert.equal((await Core.extractFile(opened, 'empty.bin')).length, 0);
  await assert.rejects(() => Core.openVault(vault, 'كلمة مرور خاطئة تمامًا'), /غير صحيحة|تالف/);
  const changed = vault.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(() => Core.openVault(changed, pass), /غير صحيحة|تالف/);
  await assert.rejects(() => Core.openVault(vault.slice(0, -1), pass), /غير صالح|تالف/);
  const badHeader = vault.slice();
  badHeader[8] ^= 1;
  await assert.rejects(() => Core.openVault(badHeader, pass), /غير صالح|تالف/);
  await assert.rejects(() => Core.createVault([{ name: '../escape.txt', data: new Uint8Array([1]) }], pass), /مسارات|غير صالح/);
  await assert.rejects(() => Core.createVault([{ name: 'short', data: new Uint8Array([1]) }], 'قصير'), /10 أحرف/);
  console.log('PASS: إنشاء/فتح/استخراج + UTF-8 + ملف فارغ + بايتات ثنائية + كلمة مرور خاطئة + تلاعب/بتر + مسار غير صالح + كلمة مرور قصيرة');
})().catch((error) => { console.error(error); process.exit(1); });
