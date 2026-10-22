#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { report } from '@runeditrun/rer/modules/deploy-kit/owner-cli';
import { analyticsLifecycle, stageAnalytics } from './lifecycle.mjs';

export async function main(argv = process.argv.slice(2), env = process.env) {
 const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { environment: { type: 'string', default: 'production' }, role: { type: 'string' } } });
 if (positionals.length !== 1) throw new Error('analytics-usage');
 const root = fileURLToPath(new URL('../..', import.meta.url)), options = values.role ? { roles: [values.role] } : {};
 if (positionals[0] === 'stage') return { ok: true, products: await stageAnalytics(root, options) };
 return { ok: true, products: await analyticsLifecycle(root, { command: positionals[0], environment: values.environment, env, ...options }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try { console.log(JSON.stringify(await main())); }
 catch (error) { console.error(JSON.stringify(report(error))); process.exitCode = 1; }
}
