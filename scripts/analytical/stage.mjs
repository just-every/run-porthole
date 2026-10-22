import { copyFile, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const sourceDirectory = 'workers/analytics';
export const roleNames = Object.freeze(['primary', 'standby']);
export function selectRoles(roles = roleNames) {
 if (!Array.isArray(roles) || !roles.length || roles.some(role => !roleNames.includes(role)) || new Set(roles).size !== roles.length) throw new Error('invalid-analytics-roles');
 return roles;
}
export function productDirectory(role) {
 selectRoles([role]);
 return `${sourceDirectory}/.staged/${role}`;
}
export async function analyticalManifest(root) {
 return JSON.parse(await readFile(join(root, sourceDirectory, 'manifest.json'), 'utf8'));
}
async function privateDirectory(path) {
 try {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('invalid-analytics-stage-directory');
 } catch (error) { if (error.code !== 'ENOENT') throw error; }
 await mkdir(path, { recursive: true, mode: 0o700 });
}
async function clearGeneratedFiles(directory) {
 for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isFile()) throw new Error('invalid-analytics-generated-file');
  await unlink(join(directory, entry.name));
 }
}
/** The kernel is native Worker ESM; staging preserves its modules verbatim.
 * No dependency install, bundle subprocess or test runs during deploy. */
export async function stageAnalytics(root, { roles = roleNames } = {}) {
 root = resolve(root); selectRoles(roles);
 const source = join(root, sourceDirectory), manifest = await analyticalManifest(root);
 const modules = (await readdir(source, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.mjs')).map(entry => entry.name);
 const migrations = (await readdir(join(source, 'migrations/core'))).filter(name => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name));
 await privateDirectory(join(source, '.staged'));
 const products = [];
 for (const role of roles) {
  const relative = productDirectory(role), product = join(root, relative);
  for (const directory of [product, join(product, 'dist'), join(product, 'dist/server'), join(product, 'dist/client'), join(product, 'migrations'), join(product, 'migrations/core')]) await privateDirectory(directory);
  for (const directory of ['dist/server', 'dist/client', 'migrations/core']) await clearGeneratedFiles(join(product, directory));
  for (const name of modules) await copyFile(join(source, name), join(product, 'dist/server', name));
  for (const name of migrations) await copyFile(join(source, 'migrations/core', name), join(product, 'migrations/core', name));
  // This is the supported deploy-kit no_bundle artifact contract. There are
  // no static assets; all requests are handled by the kernel.
  await writeFile(join(product, 'dist/server/wrangler.json'), JSON.stringify({ main: manifest.entry, no_bundle: true, rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }] }, null, 2) + '\n');
  const declaration = {
   version: 1, project: manifest.roles[role].project, productDirectory: relative,
   compatibilityDate: '2026-09-08', d1: [{ binding: 'DB' }], workersDev: false,
   vars: { ANALYTICS_ROLE: role }, secrets: [{ binding: manifest.secretBinding, environment: manifest.secretBinding }],
  };
  await writeFile(join(product, 'deploy.json'), JSON.stringify(declaration, null, 2) + '\n');
  // Local supervision uses separate Wrangler processes and persistence roots.
  // The token is supplied by a private vars file or an explicit test binding.
  await writeFile(join(product, 'wrangler.json'), JSON.stringify({
   name: `porthole-analytics-${role}`, main: `dist/server/${manifest.entry}`, compatibility_date: '2026-09-08',
   vars: { ANALYTICS_ROLE: role }, workers_dev: false,
   d1_databases: [{ binding: 'DB', database_name: `porthole-analytics-${role}`, database_id: `local-analytics-${role}-only`, migrations_dir: 'migrations/core' }],
  }, null, 2) + '\n');
  products.push({ role, project: declaration.project, binding: manifest.roles[role].binding, productDirectory: relative, declaration: `${relative}/deploy.json`, config: `${relative}/wrangler.json` });
 }
 return products;
}
