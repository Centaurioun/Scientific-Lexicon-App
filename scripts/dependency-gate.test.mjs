import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selected = {
  'wink-nlp': '2.4.0',
  'wink-eng-lite-web-model': '1.8.1',
  ahocorasick: '1.0.2',
  dexie: '4.4.7',
  zod: '4.6.7',
};
const toolchain = {
  next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1', typescript: '7.0.2',
  '@types/node': '26.6.11', '@types/react': '19.3.3', '@types/react-dom': '19.3.0',
  '@playwright/test': '1.65.1', vite: '8.4.0', vitest: '5.1.2',
};
const allExpected = process.env.G1_INTENTIONAL_WRONG_VERSION === '1'
  ? { ...selected, 'wink-nlp': '0.0.0' }
  : { ...selected, ...toolchain };

function loadLock() {
  const lockPath = path.join(root, 'package-lock.json');
  assert.ok(fs.existsSync(lockPath), 'authoritative package-lock.json is missing');
  return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
}

test('qualified direct package versions exactly match the npm lock', () => {
  const lock = loadLock();
  for (const [name, version] of Object.entries(allExpected)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} version mismatch`);
  }
});

test('excluded R21 package is absent from the complete npm lock graph', () => {
  const lock = loadLock();
  assert.equal(Object.keys(lock.packages).some((p) => p.endsWith('/node_modules/@jimtkelly/aho-corasick') || p === 'node_modules/@jimtkelly/aho-corasick'), false);
});

test('every locked tarball has Subresource Integrity metadata', () => {
  const lock = loadLock();
  const missing = Object.entries(lock.packages)
    .filter(([key, meta]) => key !== '' && meta.resolved && !meta.integrity)
    .map(([key]) => key);
  assert.deepEqual(missing, []);
});

test('all direct dependency and toolchain entry points resolve after npm ci', () => {
  const require = createRequire(import.meta.url);
  for (const name of Object.keys(allExpected)) {
    if (name.startsWith('@types/')) {
      assert.ok(fs.existsSync(path.join(root, 'node_modules', name, 'package.json')), `${name} package is installed`);
    } else {
      assert.doesNotThrow(() => require.resolve(name), `${name} entry point`);
    }
  }
});
