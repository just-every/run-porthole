// A shared build is scoped to one workflow run and verified before every reuse.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [mode, directory = '.'] = process.argv.slice(2);
if (!['write', 'check'].includes(mode)) throw Error('Usage: ci-build.mjs write|check [ROOT]');
const root = resolve(directory);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.GITHUB_SHA && head !== process.env.GITHUB_SHA) throw Error('Checkout differs from workflow SHA');
const digest = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
function files(path) {
 const info = lstatSync(resolve(root, path));
 if (info.isSymbolicLink()) throw Error(`Shared build contains a symlink: ${path}`);
 if (info.isDirectory()) return readdirSync(resolve(root, path)).sort().flatMap(name => files(`${path}/${name}`));
 if (!info.isFile()) throw Error(`Shared build contains a non-file: ${path}`);
 return [path];
}
const paths = [...files('dist'), ...files('src/routeTree.gen.ts')];
if (!paths.includes('dist/server/wrangler.json') || !paths.some(path => path.startsWith('dist/client/'))) throw Error('Shared production build is incomplete');
const manifest = {
 schema: 1, head, lock: digest('pnpm-lock.yaml'),
 files: Object.fromEntries(paths.map(path => [path, digest(path)])),
};
const receipt = resolve(root, '.cache/verify-build.json');
if (mode === 'write') {
 mkdirSync(resolve(root, '.cache'), { recursive: true });
 writeFileSync(receipt, JSON.stringify(manifest) + '\n');
} else if (JSON.stringify(JSON.parse(readFileSync(receipt, 'utf8'))) !== JSON.stringify(manifest)) {
 throw Error('Shared production build is stale or modified');
}
console.log(`Shared production build ${mode}: ${head} (${paths.length} files)`);
