(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CueVaultCore = api;
})(globalThis, function (root) {
  'use strict';

  const HEADER_BYTES = 52;
  const MAGIC = [0x56, 0x4c, 0x54, 0x31]; // VLT1
  const VERSION = 1;
  const KDF_ID = 1; // PBKDF2-HMAC-SHA-256
  const CIPHER_ID = 1; // AES-256-GCM
  const ITERATIONS = 600000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const TAG_BYTES = 16;
  const MAX_FILES = 200;
  const MAX_TOTAL_PLAIN_BYTES = 40 * 1024 * 1024;
  const MAX_CIPHER_BYTES = 50 * 1024 * 1024;
  const MAX_PATH_LENGTH = 240;

  class VaultError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'VaultError';
      this.code = code;
    }
  }

  function cryptoApi() {
    const c = root.crypto;
    if (!c || !c.subtle || !c.getRandomValues) {
      throw new VaultError('unsupported', 'يتطلب هذا المتصفح Web Crypto في سياق آمن.');
    }
    return c;
  }

  function normalizedPassword(password) {
    if (typeof password !== 'string' || password.length === 0) {
      throw new VaultError('password', 'أدخل كلمة المرور.');
    }
    const normalized = password.normalize('NFC');
    if ([...normalized].length < 10) {
      throw new VaultError('password', 'اجعل كلمة المرور 10 أحرف على الأقل؛ ويفضل 12 حرفًا أو أكثر.');
    }
    return normalized;
  }

  function normalizePath(name) {
    if (typeof name !== 'string' || !name.trim()) throw new VaultError('path', 'يوجد اسم ملف غير صالح.');
    const path = name.replace(/\\/g, '/');
    if (path.length > MAX_PATH_LENGTH || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
      throw new VaultError('path', 'أحد مسارات الملفات غير صالح.');
    }
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/.test(part))) {
      throw new VaultError('path', 'أحد مسارات الملفات غير صالح.');
    }
    return parts.join('/');
  }

  function validateFiles(files) {
    if (!Array.isArray(files) || files.length === 0) throw new VaultError('empty', 'اختر ملفًا واحدًا على الأقل.');
    if (files.length > MAX_FILES) throw new VaultError('limit', `الحد الأقصى ${MAX_FILES} ملفًا.`);
    let total = 0;
    const seen = new Set();
    const mapped = files.map((file) => {
      const name = normalizePath(file.name);
      const key = name.toLocaleLowerCase('en-US');
      if (seen.has(key)) throw new VaultError('duplicate', 'يوجد ملفان بالاسم نفسه (مع تجاهل اختلاف حالة الأحرف). أعد تسمية أحدهما.');
      seen.add(key);
      const size = Number(file.size ?? file.data?.byteLength ?? 0);
      if (!Number.isSafeInteger(size) || size < 0) throw new VaultError('limit', 'تعذر قراءة حجم أحد الملفات.');
      total += size;
      return { file, name, size };
    });
    if (total > MAX_TOTAL_PLAIN_BYTES) throw new VaultError('limit', 'إجمالي الملفات أكبر من الحد التجريبي البالغ 40 ميبيبايت.');
    return mapped;
  }

  async function deriveKey(password, salt) {
    const c = cryptoApi();
    const material = await c.subtle.importKey(
      'raw', new TextEncoder().encode(normalizedPassword(password)),
      'PBKDF2', false, ['deriveKey']
    );
    return c.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function makeHeader(salt, iv, ciphertextBytes) {
    const header = new Uint8Array(HEADER_BYTES);
    header.set(MAGIC, 0);
    header[4] = VERSION;
    header[5] = KDF_ID;
    header[6] = CIPHER_ID;
    header[7] = 0;
    const view = new DataView(header.buffer);
    view.setUint32(8, ITERATIONS, false);
    header.set(salt, 12);
    header.set(iv, 28);
    view.setBigUint64(40, BigInt(ciphertextBytes), false);
    view.setUint32(48, HEADER_BYTES, false);
    return header;
  }

  async function createVault(files, password, onProgress) {
    const c = cryptoApi();
    const normalized = normalizedPassword(password);
    const mapped = validateFiles(files);
    const JSZip = root.JSZip;
    if (!JSZip) throw new VaultError('unsupported', 'مكتبة ضغط الملفات غير متاحة.');
    const zip = new JSZip();
    for (let i = 0; i < mapped.length; i++) {
      const { file, name } = mapped[i];
      let data;
      if (file.data instanceof Uint8Array) data = file.data;
      else if (file.data instanceof ArrayBuffer) data = new Uint8Array(file.data);
      else if (file.arrayBuffer) data = new Uint8Array(await file.arrayBuffer());
      else throw new VaultError('read', 'تعذرت قراءة أحد الملفات.');
      zip.file(name, data, { date: file.lastModified ? new Date(file.lastModified) : new Date(), createFolders: false });
      if (onProgress) onProgress({ phase: 'zip', fraction: (i + 1) / mapped.length });
    }
    const plain = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } }, (metadata) => {
      if (onProgress) onProgress({ phase: 'zip', fraction: metadata.percent / 100 });
    });
    if (plain.byteLength > MAX_CIPHER_BYTES - TAG_BYTES) throw new VaultError('limit', 'حجم الأرشيف المضغوط تجاوز الحد التجريبي البالغ 50 ميبيبايت.');
    const salt = c.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = c.getRandomValues(new Uint8Array(IV_BYTES));
    const header = makeHeader(salt, iv, plain.byteLength + TAG_BYTES);
    if (onProgress) onProgress({ phase: 'key', fraction: 0 });
    const key = await deriveKey(normalized, salt);
    if (onProgress) onProgress({ phase: 'encrypt', fraction: 0 });
    const encrypted = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, plain));
    const result = new Uint8Array(header.byteLength + encrypted.byteLength);
    result.set(header, 0);
    result.set(encrypted, header.byteLength);
    return result;
  }

  function parseHeader(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.byteLength < HEADER_BYTES + TAG_BYTES || bytes.byteLength > HEADER_BYTES + MAX_CIPHER_BYTES) {
      throw new VaultError('bad-vault', 'ملف الخزنة تالف أو يتجاوز حد الحجم التجريبي.');
    }
    for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new VaultError('bad-vault', 'هذا ليس ملف خزنة Cue معروفًا.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const iterations = view.getUint32(8, false);
    const cipherLengthBig = view.getBigUint64(40, false);
    if (bytes[4] !== VERSION || bytes[5] !== KDF_ID || bytes[6] !== CIPHER_ID || bytes[7] !== 0 ||
        iterations !== ITERATIONS || view.getUint32(48, false) !== HEADER_BYTES ||
        cipherLengthBig > BigInt(MAX_CIPHER_BYTES) || cipherLengthBig < BigInt(TAG_BYTES) ||
        cipherLengthBig !== BigInt(bytes.byteLength - HEADER_BYTES)) {
      throw new VaultError('bad-vault', 'رأس ملف الخزنة أو حجمه غير صالح.');
    }
    return { salt: bytes.slice(12, 28), iv: bytes.slice(28, 40), header: bytes.slice(0, HEADER_BYTES), encrypted: bytes.slice(HEADER_BYTES) };
  }

  async function inspectZip(zip) {
    const names = Object.keys(zip.files);
    if (names.length > MAX_FILES * 3) throw new VaultError('bad-vault', 'يحتوي الأرشيف على عناصر أكثر من المسموح.');
    let fileCount = 0;
    let total = 0;
    const seen = new Set();
    const entries = [];
    for (const key of names) {
      const entry = zip.files[key];
      if (entry.dir) continue;
      const name = normalizePath(entry.name);
      const collisionKey = name.toLocaleLowerCase('en-US');
      if (seen.has(collisionKey)) throw new VaultError('bad-vault', 'يحتوي الأرشيف على أسماء ملفات متكررة.');
      seen.add(collisionKey);
      fileCount++;
      const data = await Promise.resolve(entry._data);
      const size = Number(data && data.uncompressedSize);
      if (!Number.isSafeInteger(size) || size < 0) throw new VaultError('bad-vault', 'تعذر التحقق من أحجام ملفات الأرشيف.');
      total += size;
      if (fileCount > MAX_FILES || total > MAX_TOTAL_PLAIN_BYTES) throw new VaultError('bad-vault', 'الأرشيف يتجاوز حدود النسخة التجريبية.');
      entries.push({ name, size });
    }
    return entries;
  }

  async function openVault(vaultData, password) {
    const c = cryptoApi();
    const bytes = vaultData instanceof Uint8Array ? vaultData : new Uint8Array(vaultData);
    const parsed = parseHeader(bytes);
    const key = await deriveKey(password, parsed.salt);
    let plaintext;
    try {
      plaintext = new Uint8Array(await c.subtle.decrypt(
        { name: 'AES-GCM', iv: parsed.iv, additionalData: parsed.header, tagLength: 128 }, key, parsed.encrypted
      ));
    } catch (_) {
      throw new VaultError('bad-vault', 'كلمة المرور غير صحيحة أو ملف الخزنة تالف.');
    }
    try {
      const JSZip = root.JSZip;
      if (!JSZip) throw new Error('JSZip unavailable');
      // AES-GCM already authenticates every ZIP byte; avoid JSZip's eager CRC pass.
      const zip = await JSZip.loadAsync(plaintext, { checkCRC32: false, createFolders: false });
      const entries = await inspectZip(zip);
      return { zip, entries };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError('bad-vault', 'تم التحقق من التشفير لكن محتويات الخزنة غير صالحة.');
    }
  }

  async function extractFile(opened, name) {
    const entry = opened && opened.zip && opened.zip.file(name);
    if (!entry) throw new VaultError('read', 'تعذر العثور على الملف داخل الخزنة.');
    return entry.async('uint8array');
  }

  return {
    HEADER_BYTES, ITERATIONS, MAX_FILES, MAX_TOTAL_PLAIN_BYTES, MAX_CIPHER_BYTES,
    VaultError, createVault, openVault, extractFile, parseHeader, normalizePath
  };
});
