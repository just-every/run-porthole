import assert from 'node:assert/strict'
export default async function({tool}) {
 // A caller cannot convert a private read into an approval or widen its grant.
 const unknown=await tool('porthole.access.grant',{role:'owner'})
 assert.equal(unknown.message?.error?.data?.code??unknown.result?._meta?.['com.runeditrun/error']?.code,'tool_not_found')
}
export async function afterStep({step,result,database}) {
 if(step.id!=='telemetry'||!result?.queryRef)return
 const ref=result.queryRef
 const db=await database('DB')
 const rows=await db.prepare("SELECT q.actor_ref FROM porthole_query_snapshots q JOIN agent_door_audit a ON json_extract(a.row,'$.sponsor.id')=q.actor_ref WHERE q.id=?").bind(ref).all()
 assert.ok(rows.results.length>0,'native snapshot retains the same sponsoring person as door audit')
}
