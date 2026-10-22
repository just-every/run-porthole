import type { HealthBindings, HealthState } from './model'
import { administrative, fail, scopeWithin, type Authority, type Scope } from '../security/authority'
export function mayReadHealth(actor:Authority) {
 const scope=actor.member.scope
 if(!scope.services.length || !scope.teams.length || !scope.environments.some(value=>value==='*'||value==='production'))fail('production_scope_required')
}
export async function scopedHealth(env:HealthBindings,state:HealthState,actor:Authority):Promise<HealthState> {
 if(administrative(actor.member.role))return state
 const telemetry=actor.member.role!=='finance reader'
 const within=(row:Record<string,unknown>)=>scopeWithin({services:[String(row.service)],teams:[String(row.team)],environments:[String(row.environment)]},actor.member.scope)
 const definitions=(await env.DB.prepare("SELECT id,scope FROM porthole_objects WHERE kind='monitor'").all<{id:string;scope:string}>()).results
 const allowed=new Set(definitions.filter(row=>scopeWithin(JSON.parse(row.scope) as Scope,actor.member.scope)).map(row=>row.id))
 const components=state.components.map(row=>{
  let evidence:Record<string,unknown>={}
  if(row.component==='collector')evidence={collectors:(row.evidence.collectors as Record<string,unknown>[]??[]).filter(within)}
  if(row.component==='query')evidence={lastKnown:telemetry?(row.evidence.lastKnown as Record<string,unknown>[]??[]).filter(within):[]}
  if(row.component==='monitor-evaluation')evidence={monitors:telemetry?(row.evidence.monitors as Record<string,unknown>[]??[]).filter(item=>allowed.has(String(item.monitorId))):[]}
  return {...row,evidence}
 })
 // Recheck the live member/session revision before releasing the projection.
 if(!await env.DB.prepare(`SELECT 1 AS live WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
 return {...state,components,configuration:{...state.configuration,recipient:null}}
}
