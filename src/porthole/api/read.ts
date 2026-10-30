import {agentReadAuthority,agentCredential,type ReadPrincipal} from '../security/agent-read'
import type { Bindings } from '../../auth.server'
import type { ObjectRow } from '../objects/http'
import { verifyCredential } from '../credentials/verify'
import { allScope, authority, emptyScope, fail, scopeWithin, type Scope } from '../security/authority'
import { collections, type Collection } from './model'

interface Selection { kind: Collection; id?: string; cursor: string; limit: number }
/** Whole definitions are visible only when every scope dimension is held.
 * Reading a monitor additionally requires its telemetry signal grant. */
export async function readDefinitions(request: Request,env: Bindings,selection: Selection,principal?:ReadPrincipal) {
 const credential=(use:Parameters<typeof verifyCredential>[2])=>principal?.clientId?agentCredential(request,env,principal,use!):verifyCredential(request,env,use)
 let scope: Scope, actorRef: string, actorRevision: number
 let signals: string[] | null=null
 let fence: {sql:string;args:unknown[]}
 if(principal?.clientId||request.headers.has('authorization')) {
  const auth=await credential({action:'definitions.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
  scope=auth.credential.scope;signals=auth.credential.scope.signals
  actorRef=auth.credential.id;actorRevision=auth.credential.revision;fence=auth.fence
 } else {
  const actor=principal?await agentReadAuthority(env,principal):await authority(request,env)
  if(actor.member.role==='finance reader')fail('operations_forbidden')
  scope=actor.member.scope;actorRef=actor.member.operatorId;actorRevision=actor.member.revision
  fence={sql:actor.fence,args:actor.args}
 }
 const initialScope=JSON.stringify({services:scope.services,environments:scope.environments,teams:scope.teams}),initialSignals=JSON.stringify(signals)
 const parts=['o.kind=?',selection.id?'o.id=?':'o.id>?'],args:unknown[]=[collections[selection.kind],selection.id??selection.cursor]
 for(const key of ['services','environments','teams'] as const) {
  parts.push(`NOT EXISTS(SELECT 1 FROM json_each(o.scope,'$.${key}') requested WHERE NOT EXISTS(SELECT 1 FROM json_each(?) granted WHERE granted.value='*' OR granted.value=requested.value))`)
  args.push(JSON.stringify(scope[key]))
 }
 if(signals) {parts.push("(o.kind!='monitor' OR json_extract(o.body,'$.signal') IN (SELECT value FROM json_each(?)))");args.push(JSON.stringify(signals))}
 const statement=(live:{sql:string;args:unknown[]})=>env.DB.prepare(`SELECT o.* FROM porthole_objects o WHERE ${parts.join(' AND ')} AND ${live.sql} ORDER BY o.id LIMIT ?`).bind(...args,...live.args,selection.id?1:selection.limit+1)
 let rows:ObjectRow[]
 if(principal?.clientId||request.headers.has('authorization')) {
  const auth=await credential({action:'definitions.read',scope:emptyScope,dataScope:allScope,writes(live,latest) {
   if(JSON.stringify({services:latest.services,environments:latest.environments,teams:latest.teams})!==initialScope || JSON.stringify(latest.signals)!==initialSignals)fail('authority_changed',409)
   return [statement(live)]
  }})
  rows=auth.results[0].results as unknown as ObjectRow[]
 } else rows=(await statement(fence).all<ObjectRow>()).results
 if(selection.id && !rows.length)fail('configuration_not_found',404)
 // Validate every released row as a second boundary against malformed storage.
 if(rows.some(row=>!scopeWithin(JSON.parse(row.scope),scope)))fail('authority_changed',409)
 return {rows,actorRef,actorRevision}
}
