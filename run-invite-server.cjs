#!/usr/bin/env node
// Серверная часть приглашений: миграция + патч кода + патч спеков.
const fs = require('fs');
const { execSync } = require('child_process');
const mig = '1799000000000-MakePasswordHashNullable.ts';
const dest = `src/migrations/${mig}`;
if (fs.existsSync(dest)) {
  console.log(`SKIP: ${dest} exists`);
} else {
  fs.copyFileSync(`migrations/${mig}`, dest);
  console.log(`OK: ${dest} created`);
}
for (const f of ['patch-invite-server.cjs', 'patch-invite-specs.cjs']) {
  console.log(`\n--- ${f} ---`);
  execSync(`node ${f}`, { stdio: 'inherit' });
}
