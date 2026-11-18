(() => {
  'use strict';
  const Core = window.CueVaultCore;
  const $ = (id) => document.getElementById(id);
  const state = { selectedFiles: [], opened: null, vaultName: '' };
  const createInput = $('create-files');
  const vaultInput = $('open-vault-file');

  function showStatus(target, text, kind = 'info') {
    target.textContent = text;
    target.className = `status ${kind}`;
    target.hidden = !text;
  }
  function formatBytes(value) {
    if (value < 1024) return `${value} بايت`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ك.ب`;
    return `${(value / (1024 * 1024)).toFixed(1)} م.ب`;
  }
  function setBusy(button, busy, text) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? text : button.dataset.label;
  }
  function clearFileInput(input) { input.value = ''; }
  function setTab(tab) {
    document.querySelectorAll('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
    $('main-status').hidden = true;
  }
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));

  createInput.addEventListener('change', () => {
    state.selectedFiles = Array.from(createInput.files || []);
    const target = $('chosen-files');
    target.replaceChildren();
    if (!state.selectedFiles.length) {
      target.textContent = 'لم تُحدد ملفات بعد.';
      return;
    }
    let total = 0;
    state.selectedFiles.forEach((file) => {
      total += file.size;
      const item = document.createElement('li');
      const name = file.webkitRelativePath || file.name;
      item.textContent = `${name} — ${formatBytes(file.size)}`;
      target.append(item);
    });
    $('selected-summary').textContent = `${state.selectedFiles.length} ملف · ${formatBytes(total)}`;
  });

  $('create-button').addEventListener('click', async () => {
    const button = $('create-button');
    const status = $('create-status');
    const password = $('create-password').value;
    const confirm = $('confirm-password').value;
    if (!state.selectedFiles.length) return showStatus(status, 'اختر ملفات أولًا.', 'error');
    if (password !== confirm) return showStatus(status, 'كلمتا المرور غير متطابقتين.', 'error');
    setBusy(button, true, 'جارٍ تجهيز الخزنة…');
    try {
      const result = await Core.createVault(state.selectedFiles, password, (progress) => {
        if (progress.phase === 'key') button.textContent = 'اشتقاق مفتاح الحماية…';
        else if (progress.phase === 'encrypt') button.textContent = 'تشفير الخزنة…';
        else button.textContent = 'ضغط الملفات…';
      });
      const blob = new Blob([result], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cue-vault-${date}.cuevault`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      showStatus(status, `أُنشئت الخزنة المشفّرة (${formatBytes(result.byteLength)}). احفظ ملف .cuevault على USB؛ وإذا نُزّل إلى مجلد التنزيلات فانقله يدويًا.`, 'success');
      $('create-password').value = '';
      $('confirm-password').value = '';
    } catch (error) {
      showStatus(status, error.message || 'تعذر إنشاء الخزنة.', 'error');
    } finally {
      setBusy(button, false, '');
    }
  });

  vaultInput.addEventListener('change', () => {
    const file = (vaultInput.files || [])[0];
    $('vault-file-name').textContent = file ? `${file.name} — ${formatBytes(file.size)}` : 'لم يُحدد ملف خزنة بعد.';
    $('open-button').disabled = !file;
    $('open-status').hidden = true;
  });

  $('open-button').addEventListener('click', async () => {
    const button = $('open-button');
    const file = (vaultInput.files || [])[0];
    const status = $('open-status');
    if (!file) return showStatus(status, 'اختر ملف .cuevault من USB أو من الجهاز.', 'error');
    if (file.size > Core.HEADER_BYTES + Core.MAX_CIPHER_BYTES) return showStatus(status, 'حجم الخزنة يتجاوز الحد التجريبي.', 'error');
    setBusy(button, true, 'جارٍ التحقق وفتح الخزنة…');
    try {
      const result = await Core.openVault(new Uint8Array(await file.arrayBuffer()), $('open-password').value);
      state.opened = result;
      state.vaultName = file.name;
      $('open-password').value = '';
      renderOpened(result.entries);
      $('open-form').hidden = true;
      $('opened-panel').hidden = false;
      $('opened-title').textContent = file.name;
      showStatus($('main-status'), `فُتحت الخزنة. ملفاتها تبقى في ذاكرة الصفحة إلى أن تغلقها.`, 'success');
      $('main-status').hidden = false;
    } catch (error) {
      $('open-password').value = '';
      showStatus(status, error.message || 'تعذر فتح الخزنة.', 'error');
    } finally {
      setBusy(button, false, '');
    }
  });

  function renderOpened(entries) {
    const list = $('vault-files');
    list.replaceChildren();
    $('opened-summary').textContent = `${entries.length} ملف`;
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'الخزنة فارغة.';
      list.append(empty);
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement('article');
      row.className = 'file-row';
      const details = document.createElement('div');
      details.className = 'file-details';
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const size = document.createElement('span');
      size.textContent = formatBytes(entry.size);
      details.append(name, size);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary small';
      button.textContent = 'تنزيل';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const old = button.textContent;
        button.textContent = 'جارٍ التحضير…';
        try {
          const data = await Core.extractFile(state.opened, entry.name);
          const blob = new Blob([data], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = entry.name.replaceAll('/', '__');
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (error) {
          showStatus($('main-status'), error.message || 'تعذر تنزيل الملف.', 'error');
        } finally {
          button.disabled = false;
          button.textContent = old;
        }
      });
      row.append(details, button);
      list.append(row);
    });
  }

  $('close-vault-button').addEventListener('click', () => {
    state.opened = null;
    state.vaultName = '';
    $('vault-files').replaceChildren();
    $('open-password').value = '';
    $('open-form').hidden = false;
    $('opened-panel').hidden = true;
    clearFileInput(vaultInput);
    $('vault-file-name').textContent = 'لم يُحدد ملف خزنة بعد.';
    $('open-button').disabled = true;
    $('main-status').hidden = true;
    showStatus($('open-status'), 'أُغلقت الخزنة؛ لا يحتفظ التطبيق بقائمة الملفات بعد الإغلاق. قد تبقى نسخ مؤقتة في ذاكرة المتصفح حتى يستعيدها النظام.', 'info');
  });

  $('create-reset').addEventListener('click', () => {
    state.selectedFiles = [];
    clearFileInput(createInput);
    $('chosen-files').textContent = 'لم تُحدد ملفات بعد.';
    $('selected-summary').textContent = '';
    $('create-password').value = '';
    $('confirm-password').value = '';
    $('create-status').hidden = true;
  });

  // For local automated verification; exposes no secrets or persistent state.
  window.__CUEVAULT_TEST__ = Object.freeze({ getState: () => ({ open: Boolean(state.opened), files: state.opened?.entries?.length ?? 0 }) });
})();
