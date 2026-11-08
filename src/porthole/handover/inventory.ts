import type {Bindings} from '../../auth.server'
import {allScope,fail,scopeWithin,type Authority,type Scope} from '../security/authority'
export interface Item {key:string;kind:string;id:string;revision:number;scope:Scope;mode:'move'|'end'|'void'|'hold'|'suspend'|'custody';name:string;entityRef?:string}
type Row={id:string;revision:number;scope:string;name:string;entityRef?:string}
export async function inventory(env:Bindings,target:string,actor:Authority):Promise<Item[]> {
 const items:Item[]=[]
 const add=(kind:string,mode:Item['mode'],rows:Row[])=>{for(const row of rows)items.push({key:kind+':'+row.id,kind,mode,id:row.id,revision:row.revision,scope:JSON.parse(row.scope),name:row.name,...(row.entityRef?{entityRef:row.entityRef}:{})})}
 const read=async(sql:string)=> (await env.DB.prepare(sql).bind(target).all<Row>()).results
 add('service','move',await read(`SELECT s.id,s.revision,json_object('services',json_array(s.service),'environments',json_array(s.environment),'teams',json_array(s.team)) scope,s.service name FROM porthole_service_versions s WHERE s.owner_ref=? AND s.revision=(SELECT MAX(v.revision) FROM porthole_service_versions v WHERE v.id=s.id)`))
 add('notebook','move',await read(`SELECT id,revision,scope,name FROM porthole_notebooks WHERE owner_ref=?`))
 // Absent filter dimensions retain the departing member's original scope.
 const filters=(await env.DB.prepare(`SELECT f.id,f.revision,f.name,f.definition,m.scope FROM porthole_event_filters f JOIN porthole_members m ON m.operator_id=f.owner_ref WHERE f.owner_ref=?`).bind(target).all<Row&{definition:string}>()).results
 add('event-filter','move',filters.map(row=>{const d=JSON.parse(row.definition),s=JSON.parse(row.scope);return {...row,scope:JSON.stringify({services:d.service?[d.service]:s.services,environments:d.environment?[d.environment]:s.environments,teams:d.team?[d.team]:s.teams})}}))
 add('personal-credential','suspend',await read(`SELECT c.id,c.operator_version revision,m.scope,'Personal API credential' name FROM oa_credentials c JOIN porthole_members m ON m.operator_id=c.operator_id WHERE c.operator_id=? AND c.revoked_at IS NULL`))
 add('follow-up','move',await read(`SELECT id,revision,scope,source name FROM porthole_follow_up WHERE owner_id=?`))
 const creds=(await env.DB.prepare(`SELECT id,revision,scope,name,class FROM porthole_credentials WHERE custodian_id=? AND status='active'`).bind(target).all<Row&{class:string}>()).results
 for(const row of creds)add('credential',row.class==='ingest'?'custody':'suspend',[{...row,name:row.name+' ('+row.class+')'}])
 add('notebook-share','end',await read(`SELECT g.notebook_id||':'||g.kind||':'||g.target id,g.owner_revision revision,n.scope,g.kind name FROM porthole_notebook_shares g JOIN porthole_notebooks n ON n.id=g.notebook_id WHERE g.owner_ref=?`))
 add('notebook-publication','end',await read(`SELECT p.id,p.revision,n.scope,n.name FROM porthole_notebook_publications p JOIN porthole_notebooks n ON n.id=p.notebook_id WHERE p.owner_ref=? AND p.state IN ('draft','published')`))
 add('dashboard-publication','end',await read(`SELECT p.id,p.revision,d.scope,d.name FROM porthole_dashboard_publications p JOIN porthole_dashboards d ON d.id=p.dashboard_id WHERE p.owner_id=? AND p.state IN ('draft','published')`))
 add('approval','void',await read(`SELECT a.id,a.revision,o.scope,o.name,o.id entityRef FROM porthole_object_approvals a JOIN porthole_objects o ON o.id=a.object_id WHERE a.actor_ref=?`))
 add('database-source','hold',await read(`SELECT id,revision,json_object('services',json_array(service),'environments',json_array(environment),'teams',json_array(team)) scope,engine name FROM porthole_database_sources WHERE owner_id=?`))
 add('slo','hold',await read(`SELECT s.id,s.revision,'{}' scope,s.name FROM porthole_slo_versions s WHERE s.owner_id=? AND s.revision=(SELECT MAX(v.revision) FROM porthole_slo_versions v WHERE v.id=s.id)`).then(rows=>rows.map(row=>({...row,scope:JSON.stringify(allScope)}))))
 add('metric-rule','hold',await read(`SELECT r.id,r.revision,json_object('services',json_array(json_extract(definition,'$.service')),'environments',json_array(json_extract(definition,'$.environment')),'teams',json_array(json_extract(definition,'$.team'))) scope,json_extract(definition,'$.name') name FROM porthole_metric_rules r WHERE owner_id=? AND revision=(SELECT MAX(v.revision) FROM porthole_metric_rules v WHERE v.id=r.id)`))
 add('pipeline','hold',await read(`SELECT 'pipeline' id,revision,'{}' scope,'Pipeline approval provenance' name FROM porthole_pipeline_versions WHERE owner_id=? AND revision=(SELECT MAX(revision) FROM porthole_pipeline_versions)`).then(rows=>rows.map(row=>({...row,scope:JSON.stringify(allScope)}))))
 if(items.some(item=>!scopeWithin(item.scope,actor.member.scope)))fail('handover_scope_forbidden')
 return items.sort((a,b)=>a.key.localeCompare(b.key))
}
