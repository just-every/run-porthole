import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { parse } from '/workspace/run-porthole/scripts/edition-authoring/vendor/yaml/index.mjs';
const root = '/workspace/run-porthole';
const exec = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
const check = () => exec(['scripts/ci-build.mjs', 'check']);
assert.equal(exec(['scripts/ci-build.mjs', 'write']).status, 0);
assert.equal(check().status, 0);
const path = root + '/dist/server/wrangler.json', receipt = root + '/.cache/verify-build.json';
const original = readFileSync(path), originalReceipt = readFileSync(receipt);
try {
 writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]));
 assert.notEqual(check().status, 0, 'modified output is refused');
 writeFileSync(path, original);
 writeFileSync(receipt, originalReceipt.toString().replace(/"head":"[a-f0-9]+"/, '"head":"'+'0'.repeat(40)+'"'));
 assert.notEqual(check().status, 0, 'another commit is refused');
 writeFileSync(receipt, originalReceipt);
 symlinkSync('/etc/hostname', root + '/dist/unsafe-ci-link');
 assert.notEqual(check().status, 0, 'symlinked output is refused');
 unlinkSync(root + '/dist/unsafe-ci-link');
 writeFileSync(root + '/dist/extra-ci-file', 'changed');
 assert.notEqual(check().status, 0, 'extra output is refused');
 unlinkSync(root + '/dist/extra-ci-file');
 assert.notEqual(exec(['scripts/ci-build.mjs','check'], {GITHUB_SHA:'0'.repeat(40)}).status, 0, 'workflow/checkout mismatch is refused');
 const reused = exec(['--input-type=module','-e',"import {run} from './scripts/verify-app.mjs'; run('pnpm run build')"], {SEED_VERIFY_PREBUILT:'1'});
 assert.equal(reused.status, 0, reused.stderr);
 assert.match(reused.stdout, /Using the verified production build/);
 const failed = exec(['--input-type=module','-e',"import {run} from './scripts/verify-app.mjs'; run('exit 7')"]);
 assert.equal(failed.status, 7, 'command failures still fail the shard');
 assert.match(failed.stdout, /VERIFY_TIMING.*"exit":7/);
 writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]));
 const refused = exec(['--input-type=module','-e',"import {run} from './scripts/verify-app.mjs'; run('pnpm run build')"], {SEED_VERIFY_PREBUILT:'1'});
 assert.notEqual(refused.status, 0, 'stale build is never silently reused');
} finally {
 writeFileSync(path, original); writeFileSync(receipt, originalReceipt);
 for (const name of ['unsafe-ci-link','extra-ci-file']) try { unlinkSync(root + '/dist/' + name); } catch {}
}
assert.equal(check().status, 0);
parse(readFileSync(root+'/.github/workflows/verify.yml','utf8'));
console.log('PASS: build reuse, changed bytes, extra files, symlink, wrong commit, wrong workflow SHA, failure propagation, timing output, workflow YAML parse.');
