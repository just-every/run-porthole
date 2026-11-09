import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export async function verificationPlan() {
 const plan = JSON.parse(await readFile(new URL('../verification.json', import.meta.url), 'utf8'));
 const names = new Set();
 for (const tier of ['push', 'nightly']) {
  if (!Array.isArray(plan[tier])) throw Error(`Missing verification tier: ${tier}`);
  for (const shard of plan[tier]) {
   if (!/^[a-z][a-z0-9-]*$/.test(shard.name) || names.has(shard.name)) throw Error(`Invalid or duplicate shard: ${shard.name}`);
   if (typeof shard.browser !== 'boolean' || typeof shard.hosted !== 'boolean' || !Array.isArray(shard.commands) || !shard.commands.length || shard.commands.some(command => typeof command !== 'string' || !command.trim())) throw Error(`Incomplete shard: ${shard.name}`);
   names.add(shard.name);
  }
 }
 if (!plan.push.length || plan.push.filter(shard => shard.hosted).length !== 1) throw Error('Push verification must include the hosted production build');
 return plan;
}

export function run(command, env = process.env) {
 console.log(`> ${command}`);
 const started = performance.now();
 // Only the build is shared. Every declared check and journey still executes.
 if (command === 'pnpm run build' && env.SEED_VERIFY_PREBUILT === '1') {
  const checked = spawnSync(process.execPath, ['scripts/ci-build.mjs', 'check'], { stdio: 'inherit', env });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status ?? 1);
  console.log('Using the verified production build from this CI run.');
  return;
 }
 const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', command], { stdio: 'inherit', env });
 console.log(`VERIFY_TIMING ${JSON.stringify({ shard: env.SEED_VERIFY_SHARD ?? null, command, seconds: Number(((performance.now() - started) / 1000).toFixed(3)), exit: result.status })}`);
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] === import.meta.filename) {
 const plan = await verificationPlan();
 const all = [...plan.push, ...plan.nightly];
 const selected = process.env.SEED_VERIFY_SHARD;
 const shards = selected ? all.filter(shard => shard.name === selected) : all;
 if (!shards.length) throw Error(`Unknown verification shard: ${selected}`);
 for (const shard of shards) for (const command of shard.commands) run(command);
}
