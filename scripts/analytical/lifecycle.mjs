import { commandAdapter as createCommandAdapter } from '@runeditrun/rer/adapter';
import { localInstaller } from '@runeditrun/rer/local-installer';
import { main as ownerCommand } from '@runeditrun/rer/modules/deploy-kit/owner-cli';
import { analyticalManifest, productDirectory, roleNames, selectRoles, stageAnalytics } from './stage.mjs';

export { stageAnalytics } from './stage.mjs';
export function analyticalState(role, environment) {
 selectRoles([role]);
 if (typeof environment !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(environment)) throw new Error('invalid-analytics-environment');
 return `workers/analytics/.state/${environment}-${role}.json`;
}
/** Delegates provider custody, exact-commit checks, D1 migration, uploads,
 * drift guards and cleanup to the pinned public rer owner CLI. */
export async function analyticsLifecycle(root, { command, environment = 'production', roles = roleNames, env = process.env, notice } = {}) {
 if (!['deploy', 'dry-run', 'health', 'inspect', 'remove'].includes(command)) throw new Error('invalid-analytics-command');
 selectRoles(roles);
 const products = ['deploy', 'dry-run', 'health'].includes(command)
  ? await stageAnalytics(root, { roles })
  : roles.map(role => ({ role, productDirectory: productDirectory(role), declaration: `${productDirectory(role)}/deploy.json` }));
 const results = [];
 // Provider mutations stay sequential, with a different supported state file
 // per product. Repeating a partially completed deployment reuses custody.
 for (const product of products) {
  const argv = [command, '--declaration', product.declaration, '--environment', environment, '--state', analyticalState(product.role, environment)];
  if (['deploy', 'dry-run', 'health'].includes(command)) argv.push('--product', product.productDirectory);
  const result = await ownerCommand(argv, env, { cwd: root, ...(notice ? { notice } : {}) });
  results.push({ role: product.role, result });
 }
 return results;
}
export async function analyticalServices(root) {
 const manifest = await analyticalManifest(root);
 return roleNames.map(role => ({ binding: manifest.roles[role].binding, project: manifest.roles[role].project }));
}
const lifecycle = localInstaller({
 dependencies: false,
 build: async ({ root, store }) => {
  await stageAnalytics(root);
  await store.step('Staged analytical primary and standby');
 },
});
export const adapter = lifecycle;
export const { install } = lifecycle;
export const commandAdapter = createCommandAdapter(lifecycle, {
 product: 'Porthole analytical workers', scheduled: false,
 deploy: async ({ root, options = {}, env = process.env, store }) => {
  if (options.setSecret || options.unsetSecret || options.rotateSecret) throw new Error('analytics-use-owner-cli-secret');
  const command = options.remove ? 'remove' : options.dryRun ? 'dry-run' : 'deploy';
  return analyticsLifecycle(root, { command, environment: options.environment ?? 'production', env, notice: line => store?.report(line) });
 },
});
