import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { authority, fail, proofFence } from '../../security/authority'
import { input } from '../../security/input'
import { privateHeaders } from '../../document'

export const exclusionRoot = '/api/porthole/v1/export-exclusions'
const recordId = /^[a-f0-9-]{36}:[0-9]+$/
const format = 'porthole.export-exclusions.v1'
const json = (value: unknown, status = 200) => Response.json(value, {status, headers: privateHeaders})
/** Append-only suppression of stable record identities, never deletion or a
 * delegated erasure grant. Portable journals require an unrestricted owner. */
export async function exclusionResponse(request: Request, env: Bindings): Promise<Response> {
 try {
  const url = new URL(request.url), post = request.method === 'POST'
  const actor = await authority(request, env, {post, stepUp: post})
  if (actor.member.role !== 'owner' || actor.session.kind !== 'native' || Object.values(actor.member.scope).some(values => !values.includes('*'))) fail('unrestricted_native_owner_required')
  if (request.method === 'GET') {
   if ([...url.searchParams.keys()].some(key => key !== 'after') || url.searchParams.getAll('after').length > 1) fail('invalid_exclusion_cursor', 400)
   const after = url.searchParams.get('after') ?? ''
   if (after && !recordId.test(after)) fail('invalid_exclusion_cursor', 400)
   const records = (await env.DB.prepare(`SELECT record_id AS recordId,excluded_at AS excludedAt FROM porthole_export_exclusions WHERE record_id>? AND ${actor.fence} ORDER BY record_id LIMIT 51`).bind(after,...actor.args).all<{recordId:string;excludedAt:number}>()).results
   return json({format, records: records.slice(0,50), next: records.length > 50 ? records[49].recordId : null})
  }
  if (!post) fail('method_not_allowed',405)
  if (url.search) fail('invalid_exclusion_journal',400)
  const data = await input(request), journal = data.journal as {format?:unknown;records?:unknown}
  if (Object.keys(data).sort().join(',') !== 'confirm,journal' || data.confirm !== 'apply-exclusions' || !journal || typeof journal !== 'object' || Object.keys(journal).sort().join(',') !== 'format,records' || journal.format !== format || !Array.isArray(journal.records) || !journal.records.length || journal.records.length > 50) fail('invalid_exclusion_journal',400)
  const entries = journal.records as {recordId:string;excludedAt:number}[]
  if (entries.some(row => !row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'excludedAt,recordId' || typeof row.recordId !== 'string' || !recordId.test(row.recordId) || !Number.isSafeInteger(row.excludedAt) || row.excludedAt < 0 || row.excludedAt > Date.now()) || new Set(entries.map(row => row.recordId)).size !== entries.length) fail('invalid_exclusion_journal',400)
  const proof = proofFence(actor)
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args),
   ...entries.map(row => env.DB.prepare('INSERT INTO porthole_export_exclusions(record_id,excluded_at) VALUES(?,?) ON CONFLICT(record_id) DO UPDATE SET excluded_at=MAX(excluded_at,excluded.excluded_at)').bind(row.recordId,row.excludedAt)),
  ])
  return json({format,applied:entries.length})
 } catch(error) {
  return json({error:error instanceof AuthError ? error.code : 'exclusion_journal_unavailable'},error instanceof AuthError ? error.status : 503)
 }
}
