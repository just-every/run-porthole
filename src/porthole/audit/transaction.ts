import type { AuditInput } from './store'

/** A request-local adapter. Context, native writes and immutable facts share
 * one transaction; no other request can inherit a context, including crashes. */
export function transactionalAudit(db: D1Database, input: AuditInput): D1Database {
 const originals = new WeakMap<object, D1PreparedStatement>()
 const unwrap = (value: D1PreparedStatement) => originals.get(value) ?? value
 async function batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
  const result = await db.batch<T>([
   db.prepare('INSERT INTO porthole_audit_context(singleton,operation_ref,actor_ref,actor_revision,action,occurred_at) VALUES(1,?,?,?,?,?)')
    .bind(input.operationRef,input.actorRef,input.actorRevision,input.action,input.occurredAt),
   ...statements.map(unwrap),
   db.prepare('DELETE FROM porthole_audit_context WHERE singleton=1'),
  ])
  return result.slice(1,-1)
 }
 function prepare(sql: string, statement = db.prepare(sql)): D1PreparedStatement {
  const mutates = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)
  const wrapped = new Proxy(statement, { get(target,key) {
   if(key==='bind') return (...args: unknown[]) => prepare(sql,target.bind(...args))
   if(mutates && ['run','all','first','raw'].includes(String(key))) return async (argument?: string | {columnNames?: boolean}) => {
    const result = (await batch([target]))[0]
    if(key==='first') return typeof argument==='string' ? (result.results[0] as Record<string,unknown> | undefined)?.[argument] ?? null : result.results[0] ?? null
    if(key==='raw') { const names=Object.keys(result.results[0] ?? {}),rows=result.results.map(row=>names.map(name=>(row as Record<string,unknown>)[name]));return typeof argument==='object' && argument.columnNames ? [names,...rows]:rows }
    return result
   }
   const value=Reflect.get(target,key,target)
   return typeof value==='function' ? value.bind(target) : value
  }})
  originals.set(wrapped,statement)
  return wrapped
 }
 return new Proxy(db,{get(target,key) {
  if(key==='prepare') return prepare
  if(key==='batch') return batch
  const value=Reflect.get(target,key,target)
  return typeof value==='function' ? value.bind(target):value
 }})
}
