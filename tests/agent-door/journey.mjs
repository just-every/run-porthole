import assert from 'node:assert/strict'
export default async function({tool,request,origin,cookie}) {
 // A caller cannot convert a private read into an approval or widen its grant.
 const unknown=await tool('porthole.access.grant',{role:'owner'})
 assert.equal(unknown.message?.error?.data?.code??unknown.result?._meta?.['com.runeditrun/error']?.code,'tool_not_found')
 // Door activity must remain portable through the owner's ordinary archive door.
 const api='/api/porthole/v1/archive/exports'
 const read=async(path,init={})=>{
  const response=await request(origin+path,{...init,headers:{origin,cookie,'content-type':'application/json'}})
  assert.ok(response.ok,'Native archive must accept agent activity: '+response.status)
  return response.json()
 }
 const job=await read(api,{method:'POST',body:'{}'}),rows=[]
 for(let index=0;index<job.totalChunks;index++)rows.push(...(await read(`${api}/${job.id}/chunks/${index}`)).rows)
 const manifest=await read(`${api}/${job.id}/manifest`)
 assert.equal(rows.length,manifest.rowCount)
 const activity=rows.filter(row=>row.table==='porthole_archive_audit').map(row=>JSON.parse(row.row.entry))
 assert.ok(activity.some(entry=>entry.action==='porthole.telemetry.query'),'The archive retains the native agent read activity')
}
export async function afterStep({step,result,database}) {
 if(step.id!=='telemetry'||!result?.queryRef)return
 const ref=result.queryRef
 const db=await database('DB')
 const rows=await db.prepare("SELECT q.actor_ref FROM porthole_query_snapshots q JOIN agent_door_audit a ON json_extract(a.row,'$.sponsor.id')=q.actor_ref WHERE q.id=?").bind(ref).all()
 assert.ok(rows.results.length>0,'native snapshot retains the same sponsoring person as door audit')
}
