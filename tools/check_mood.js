const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('<项目目录>/deploy/index.html', 'utf8');
const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
let errors = [];
scripts.forEach((s, i) => {
  const code = s.replace(/<script[^>]*>|<\/script>/gi, '');
  if (!code.trim()) return;
  try { new vm.Script(code); }
  catch(e) { errors.push('Script ' + i + ': ' + e.message); }
});
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('JS syntax OK');
