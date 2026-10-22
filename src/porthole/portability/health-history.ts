import { fail } from '../security/authority'
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
interface Projection {table:string;columns:string[];keys:string[]}
export const healthHistory:Projection[]=[
 {table:'porthole_health_receipts',columns:['component','source','status','reason','observed_at','expires_at','last_accepted_at','last_queryable_at','evidence'],keys:['component','source']},
 {table:'porthole_health_collectors',columns:['credential_id','collector_id','team','service','environment','signal','observed_at'],keys:['credential_id','collector_id','team','service','environment','signal']},
 {table:'porthole_health_configuration',columns:['singleton','revision','freshness_ms','notices_enabled','recipient','configured_by','changed_at'],keys:['singleton']},
 {table:'porthole_health_incidents',columns:['component','episode','opened_at','resolved_at'],keys:['component']},
 {table:'porthole_health_notices',columns:['id','episode','component','phase','configuration_revision','created_at','first_attempt_at','next_attempt_at','attempts','state','message','provider_id'],keys:['id']},
 {table:'porthole_monitor_state',columns:['object_id','revision','status','evaluated_at','last_known_count','last_known_at','firing_episode','reason'],keys:['object_id']},
]
export function healthHistoryQuery(stream:string):string {
 const terms=healthHistory.map(item=>`SELECT '${stream}' AS stream,'${item.table}' AS table_name,json_array(${item.keys.join(',')}) AS row_key,json_object(${item.columns.map(column=>`'${column}',${column}`).join(',')}) AS row,'quarantined' AS state FROM ${item.table}`).concat('SELECT stream,table_name,row_key,row,state FROM porthole_archive_health_history')
 // D1 limits compound SELECT terms more tightly than desktop SQLite. Keep
 // each compound small while preserving one transactional frozen snapshot.
 const groups=[]
 for(let index=0;index<terms.length;index+=4)groups.push(`SELECT * FROM (${terms.slice(index,index+4).join(' UNION ALL ')})`)
 return groups.join(' UNION ALL ')
}
export function validateHealthHistory(row:Record<string,unknown>):void {
 const bad=():never=>fail('archive_semantics_invalid',422),item=healthHistory.find(item=>item.table===row.table_name)
 if(row.state!=='quarantined'||!uuid(row.stream)||!item||typeof row.row_key!=='string'||typeof row.row!=='string')return bad()
 let nested:Record<string,unknown>
 try{nested=JSON.parse(row.row) as Record<string,unknown>}catch{return bad()}
 if(!nested||typeof nested!=='object'||Array.isArray(nested)||Object.keys(nested).sort().join(',')!==[...item.columns].sort().join(',')||JSON.stringify(item.keys.map(key=>nested[key]))!==row.row_key)return bad()
 for(const [key,value]of Object.entries(nested)) {
  if(value!==null&&typeof value!=='string'&&(!Number.isSafeInteger(value)||Number(value)<0))return bad()
  if(['evidence','message'].includes(key)) {try{const parsed=JSON.parse(String(value));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return bad()}catch{return bad()}}
 }
 if(nested.status!==undefined&&!['Healthy','Firing','Unknown'].includes(String(nested.status)))return bad()
 if(nested.phase!==undefined&&!['failure','recovery'].includes(String(nested.phase)))return bad()
 if(nested.state!==undefined&&!['pending','sending','accepted','uncertain','rejected','cancelled'].includes(String(nested.state)))return bad()
}
