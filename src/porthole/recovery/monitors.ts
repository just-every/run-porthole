import type {ObjectRow} from '../objects/http'
import type {HealthBindings} from '../health/model'
import {observeHealth} from '../health/observe'
import {recordComponentReceipt} from '../health/receipts'
import {evaluateMonitor} from '../monitors/evaluate'
export async function evaluateMonitors(env:HealthBindings) {
 const health=await observeHealth(env)
 const monitors=(await env.DB.prepare("SELECT * FROM porthole_objects WHERE kind='monitor' AND state='active' ORDER BY id LIMIT 101").all<ObjectRow>()).results
 const outcomes:Record<string,unknown>[]=[]
 for(const monitor of monitors.slice(0,100)) {
  try {outcomes.push({...await evaluateMonitor(env,monitor,health)})}
  catch {outcomes.push({monitorId:monitor.id,revision:monitor.revision,status:'Unknown',reason:'Monitor revision or storage changed before evaluation committed.'})}
 }
 const complete=monitors.length>0&&monitors.length<=100&&outcomes.every(row=>row.status!=='Unknown'&&row.status!=='Pending')
 await recordComponentReceipt(env.DB,{component:'monitor-evaluation',source:'monitor-worker',status:complete?'Healthy':'Unknown',reason:!monitors.length?'Not configured: no active count monitors.':monitors.length>100?'Monitor evaluation coverage exceeds the bounded 100-monitor pass.':complete?'Active count monitors evaluated against real retained records.':'One or more monitors have incomplete telemetry coverage; firing episodes remain unresolved.',evidence:{evaluatedAt:new Date().toISOString(),monitors:outcomes,limit:100}})
 return {evaluated:outcomes.length,complete,monitors:outcomes}
}
