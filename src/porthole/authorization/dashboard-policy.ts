import type {Bindings} from '../../auth.server'
import {fail,type Authority} from '../security/authority'

/** Restrictions never create membership, telemetry scope or transport rights.
 * A member revision change invalidates the reviewed entry until reviewed again. */
export function dashboardPolicy(alias:string,person:string,edit=false) {
 return {sql:`(NOT EXISTS(SELECT 1 FROM porthole_dashboard_policies p WHERE p.dashboard_id=${alias}.id) OR EXISTS(
 SELECT 1 FROM porthole_members pm JOIN oa_operators po ON po.id=pm.operator_id
 WHERE pm.operator_id=? AND po.status='active' AND (
 (pm.role IN ('owner','admin') AND po.role=pm.role) OR
 (pm.role='maintainer' AND po.role='member' AND EXISTS(
 SELECT 1 FROM porthole_dashboard_policies p,json_each(p.entries) e WHERE p.dashboard_id=${alias}.id AND p.state='active'
 AND json_extract(e.value,'$.operatorId')=pm.operator_id AND json_extract(e.value,'$.memberRevision')=pm.revision
 AND json_extract(e.value,'$.access') IN (${edit?"'editor'":"'viewer','editor'"})
 )))))`,args:[person]}
}
export async function releaseDashboards(env:Bindings,live:{sql:string;args:unknown[]},person:string,rows:{id:string;revision:number}[],edit=false) {
 const gate=dashboardPolicy('d',person,edit)
 const results=await env.DB.batch([
  env.DB.prepare(`SELECT 1 AS live WHERE ${live.sql}`).bind(...live.args),
  env.DB.prepare(`SELECT COUNT(*) AS n FROM json_each(?) expected JOIN porthole_dashboards d ON d.id=json_extract(expected.value,'$.id') AND d.revision=json_extract(expected.value,'$.revision') WHERE ${live.sql} AND ${gate.sql}`).bind(JSON.stringify(rows.map(({id,revision})=>({id,revision}))),...live.args,...gate.args),
 ])
 if(!results[0].results.length||(results[1].results[0] as {n:number}).n!==rows.length)fail('revision_or_authority_changed',409)
}
export const nativeRelease=(env:Bindings,actor:Authority,rows:{id:string;revision:number}[],edit=false)=>releaseDashboards(env,{sql:actor.fence,args:actor.args},actor.member.operatorId,rows,edit)

// Keep the original read authority with its response through outer audit work.
// Weak keys prevent a finished request from retaining definitions or sessions.
const responseReleases=new WeakMap<Response,()=>Promise<void>>()
export function dashboardReleaseResponse(response:Response,release:()=>Promise<void>) {
 responseReleases.set(response,release)
 return response
}
export async function releaseDashboardResponse(response:Response) {
 const release=responseReleases.get(response)
 responseReleases.delete(response)
 if(release)await release()
}
