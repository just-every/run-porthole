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

/** Existing agent transports remain read-only; native cookies never substitute for delegation. */
export async function policyAgentRefusals({origin,cookie,session,dashboardId}) {
 const rpc=(name,args,headers)=>fetch(origin+'/api/porthole/v1/mcp',{method:'POST',headers:{origin,'content-type':'application/json','mcp-protocol-version':'2025-11-25',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})
 const native=await rpc('porthole.definitions.read',{collection:'dashboards',id:dashboardId},{cookie:session})
 assert.equal(native.status,401,'a native policy entry creates no agent credential')
 // An existing owner-owned read key retains its current data restrictions.
 const minted=await fetch(origin+'/app/settings/credentials/mint',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({name:'synthetic-porthole-2530',class:'read',scope:{services:['checkout'],environments:['production'],teams:['commerce'],signals:['logs'],actions:['definitions.read']}})})
 assert.equal(minted.status,201,await minted.clone().text());const key=await minted.json()
 const read=await rpc('porthole.definitions.read',{collection:'dashboards',id:dashboardId},{authorization:'Bearer '+key.secret,cookie:session})
 assert.equal(read.status,200);assert.equal((await read.json()).result.structuredContent.id,dashboardId)
 for(const name of ['porthole.dashboards.update','porthole.access.grant']) {
  const response=await rpc(name,{id:dashboardId,role:'owner'},{authorization:'Bearer '+key.secret,cookie})
  assert.equal(response.status,400)
  const body=await response.json();assert.equal(body.result?._meta?.['com.runeditrun/error']?.code??body.error?.data?.code,'tool_not_found')
 }
}

/** Hold a real native read after its page check, then change policy before tool release. */
export async function policyAgentReleaseJourney({origin,secret,dashboardId,withPinnedClock,change}) {
 for(const [name,args]of [['porthole.definitions.read',{collection:'dashboards',id:dashboardId}],['porthole.workspace.snapshot',{}]]) {
  await withPinnedClock(Date.now(),async(_clock,evaluate)=>{
   await evaluate(`globalThis.__policyOriginalJson=Response.prototype.json;globalThis.__policyJsonHeld=false;globalThis.__policyJsonResume=false;Response.prototype.json=async function(){const data=await globalThis.__policyOriginalJson.call(this);if(!globalThis.__policyJsonHeld&&((data.id===${JSON.stringify(dashboardId)}&&data.body?.panels)||data.objects?.some(row=>row.id===${JSON.stringify(dashboardId)}))){globalThis.__policyJsonHeld=true;while(!globalThis.__policyJsonResume)await new Promise(resolve=>setTimeout(resolve,10))}return data}`)
   let pending
   try {
    pending=fetch(origin+'/api/porthole/v1/mcp',{method:'POST',headers:{origin,'content-type':'application/json','mcp-protocol-version':'2025-11-25',authorization:'Bearer '+secret},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})
    let held=false
    for(let attempt=0;attempt<100;attempt++){if((await evaluate('globalThis.__policyJsonHeld')).result.value){held=true;break}await new Promise(resolve=>setTimeout(resolve,25))}
    assert.ok(held,'the actual agent read reached its result-release barrier: '+name)
    await change()
    await evaluate('globalThis.__policyJsonResume=true')
    const response=await pending;assert.equal(response.status,200,await response.clone().text())
    const body=await response.json()
    assert.equal(body.result?._meta?.['com.runeditrun/error']?.code??body.error?.data?.code,'revision_or_authority_changed')
    assert.ok(!body.result?.structuredContent,'a changed policy releases neither the earlier definition nor its workspace digest')
   }finally{
    await evaluate('Response.prototype.json=globalThis.__policyOriginalJson;globalThis.__policyJsonResume=true')
    if(pending)await pending
    await evaluate('delete globalThis.__policyOriginalJson;delete globalThis.__policyJsonHeld;delete globalThis.__policyJsonResume')
   }
  })
 }
}
