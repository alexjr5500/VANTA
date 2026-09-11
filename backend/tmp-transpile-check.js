const ts = require('typescript');
const fs = require('fs');
const files = [
  'c:/VANTA/backend/prisma/seed.ts',
  'c:/VANTA/backend/prisma/verify-admin.ts',
];
let allOk = true;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS },
    fileName: f,
  });
  if (out.diagnostics && out.diagnostics.length) {
    allOk = false;
    console.log('DIAG in', f);
    for (const d of out.diagnostics) {
      console.log(' -', d.messageText);
    }
  } else {
    console.log('OK (transpiles clean):', f);
  }
}
console.log(allOk ? 'ALL-FILES-TRANSPILE-CLEAN' : 'TRANSPILE-ERRORS');