import { test } from 'node:test'
import { resolve } from 'node:path'
import { checkIncremental } from './typecheck-checks.mjs'

test('exported foundation incremental typecheck', async t => {
 // The application and analytical Worker share this native query module.
 await checkIncremental(t, resolve(import.meta.dirname, '..'), {
  extraSources: ['workers/analytics/log-search.mjs', 'workers/analytics/log-search.d.mts'],
 })
})
