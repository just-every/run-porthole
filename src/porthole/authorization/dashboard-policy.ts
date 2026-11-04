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
  ...rows.map(row=>env.DB.prepare(`SELECT d.id FROM porthole_dashboards d WHERE d.id=? AND d.revision=? AND ${live.sql} AND ${gate.sql}`).bind(row.id,row.revision,...live.args,...gate.args)),
 ])
 if(results.some(result=>!result.results.length))fail('revision_or_authority_changed',409)
}
export const nativeRelease=(env:Bindings,actor:Authority,rows:{id:string;revision:number}[],edit=false)=>releaseDashboards(env,{sql:actor.fence,args:actor.args},actor.member.operatorId,rows,edit)
