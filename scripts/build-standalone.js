const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const replacements = {
  '/*__CUEVAULT_CSS__*/': fs.readFileSync(path.join(root, 'src/style.css'), 'utf8'),
  '/*__CUEVAULT_JSZIP__*/': fs.readFileSync(path.join(root, 'node_modules/jszip/dist/jszip.min.js'), 'utf8'),
  '/*__CUEVAULT_CORE__*/': fs.readFileSync(path.join(root, 'src/vault-core.js'), 'utf8'),
  '/*__CUEVAULT_APP__*/': fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
};
for (const [marker, content] of Object.entries(replacements)) {
  if (!html.includes(marker)) throw new Error(`Missing placeholder: ${marker}`);
  html = html.replace(marker, content.replaceAll('</script', '<\\/script'));
}
fs.writeFileSync(path.join(root, 'CueVault.html'), html);
console.log('Built CueVault.html (self-contained; no runtime network requests).');
