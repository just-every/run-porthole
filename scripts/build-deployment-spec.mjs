import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {deploymentSpec} from './delivery/base/spec.mjs';
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'packaging.json'), 'utf8'));
const bytes = JSON.stringify(await deploymentSpec(root, config.artifact.specInputs), null, 2) + '\n';
const path = resolve(root, 'management/integration/deployment-spec.json');
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw Error('Deployment specification is stale; run pnpm delivery:spec after the real build.');
  console.log('Deployment specification matches the real build and source policy.');
} else {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, bytes);
  console.log('Wrote management/integration/deployment-spec.json');
}
