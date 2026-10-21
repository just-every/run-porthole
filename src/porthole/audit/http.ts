import { operatorAuth, type Bindings } from '../../auth.server'
import { document, escape, privateHeaders } from '../document'
import { append, checkpoint, read, verify, genesis, type AuditInput, type Checkpoint } from './store'
import { auditUnavailable, outcome } from './capture'

const paths = new Set(['/api/v1/audit', '/api/v1/audit/export', '/app/audit'])
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders })
function integer(url: URL, key: string, fallback: number, min: number, max: number): number {
 const values = url.searchParams.getAll(key)
 if (!values.length) return fallback
 if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0])) throw new Error('invalid_range')
 const value = Number(values[0])
 if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid_range')
 return value
}
export async function auditResponse(request: Request, env: Bindings): Promise<Response | null> {
 const url = new URL(request.url)
 if (!paths.has(url.pathname)) return null
 const page = url.pathname === '/app/audit', exporting = url.pathname.endsWith('/export')
 const problem = (message: string, status: number) => page ? document('Audit unavailable', `<p role="alert">${escape(message)}</p><p><a href="/app/audit">Try again</a></p>`, status) : json({ error: message }, status)
 if (request.method !== 'GET') return problem('method_not_allowed', 405)
 let input: AuditInput | undefined
 try {
  const session = await operatorAuth(env).getSession(request)
  const head = await checkpoint(env.DB)
  input = { operationRef: crypto.randomUUID(), occurredAt: Date.now(), actorRef: session?.operator.id ?? null, actorRevision: session?.operator.version ?? null,
   action: exporting ? 'audit.export' : 'audit.query', entityRef: null, revision: null, phase: 'attempted', status: null }
  await append(env.DB, input)
  let response: Response
  if (!session) response = await problem('authentication_required', 401)
  else if (session.operator.role !== 'owner') response = await problem('owner_required', 403)
  else {
   let after: number, through: number, limit: number
   try {
    if ([...url.searchParams.keys()].some(key => !['after', 'through', 'limit'].includes(key)) || (exporting && url.searchParams.size)) throw new Error('invalid_range')
    after = integer(url, 'after', 0, 0, head.sequence)
    through = integer(url, 'through', head.sequence, after, head.sequence)
    limit = integer(url, 'limit', 25, 1, 100)
   } catch {
    response = await problem('invalid_range', 400)
    await append(env.DB, { ...input, phase: 'denied', status: response.status })
    return response
   }
   input.rangeStart = after + 1; input.rangeEnd = through
   // A full export is deliberately bounded until streaming archival custody is
   // implemented. Refuse a larger export, never silently truncate it.
   if (exporting && head.sequence > 10000) response = await problem('export_limit_use_installation_backup', 409)
   else {
    const records = await read(env.DB, after, through, exporting ? 10000 : limit)
    if (exporting && !await verify(records, head)) response = await problem('audit_integrity_failed', 409)
    else if (page) {
     const next = records.at(-1)?.entry.sequence ?? after
     const rows = records.map(({ entry }) => `<li><h2>${escape(entry.action)} — ${escape(entry.phase)}</h2><dl><dt>Sequence</dt><dd>${entry.sequence}</dd><dt>Occurred (UTC)</dt><dd>${escape(new Date(entry.occurredAt).toISOString())}</dd><dt>Recorded (UTC)</dt><dd>${escape(new Date(entry.recordedAt).toISOString())}</dd><dt>Actor reference</dt><dd>${escape(entry.actorRef ?? 'Unauthenticated')}</dd><dt>Operation reference</dt><dd>${escape(entry.operationRef)}</dd><dt>HTTP result</dt><dd>${entry.status ?? 'Pending; outcome unknown'}</dd><dt>Target reference</dt><dd>${escape(entry.entityRef ?? 'Not returned')}</dd><dt>Target revision</dt><dd>${entry.revision ?? 'Not returned'}</dd><dt>Authority revision</dt><dd>${entry.actorRevision ?? 'Unauthenticated'}</dd></dl></li>`).join('')
     response = await document('Audit', `<p>Private operational history. References are opaque; request contents and identity labels are excluded. An attempt without an outcome is uncertain.</p><p>Snapshot through sequence ${through}. <a href="/api/v1/audit/export">Export audit for Evidence</a></p>${records.length ? `<ol start="${after + 1}">${rows}</ol>` : '<p>No audit entries in this range.</p>'}${next < through ? `<p><a href="/app/audit?after=${next}&amp;through=${through}&amp;limit=${limit}">Next audit entries</a></p>` : ''}<p>Product queries, monitors, repairs, actor erasure and archive continuity are still being built.</p>`)
    } else {
     const end = records.at(-1)?.entry.sequence ?? after
     const pinned = through === 0 ? { sequence: 0, hash: genesis } : await env.DB.prepare('SELECT sequence,hash FROM porthole_audit_entries WHERE sequence=?').bind(through).first<Checkpoint>()
     if (!pinned) throw new Error('audit_checkpoint_missing')
     response = json({ format: 'porthole.audit.v1', checkpoint: pinned, range: { after, through }, records,
      next: end < through ? end : null, ...(exporting ? { verification: 'Retain checkpoint.hash independently; run node scripts/porthole/verify-audit.mjs EXPORT CHECKPOINT_HASH.' } : {}) })
     if (exporting) response.headers.set('content-disposition', 'attachment; filename="porthole-audit.json"')
    }
   }
  }
  await append(env.DB, { ...input, phase: outcome(response.status), status: response.status })
  return response
 } catch {
  // No SQL or provider exception is put on the wire.
  return page ? problem('audit_unavailable', 503) : auditUnavailable(input?.operationRef)
 }
}
