import type { HealthBindings } from './model'
import { verifyCredential } from '../credentials/verify'
import { secretHash } from '../credentials/policy'
import { fail } from '../security/authority'
import { input } from '../security/input'

/** Collector registration and heartbeat are the same authenticated atomic door.
 * Credential revocation, scope/custody changes and quotas gate every write. */
export async function collectorHeartbeat(request: Request, env: HealthBindings) {
 if (request.method!=='POST') fail('method_not_allowed',405)
 const data=await input(request)
 if (Object.keys(data).some(key=>!['collectorId','hostId','team','service','environment','signal'].includes(key))) fail('invalid_input',400)
 const name=(key:string) => typeof data[key]==='string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(data[key] as string)?data[key] as string:fail('invalid_heartbeat',400)
 const id=name('collectorId'),team=name('team'),service=name('service'),environment=name('environment'),signal=name('signal')
 const hostId=data.hostId===undefined?null:name('hostId')
 if(hostId!==null&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(hostId))fail('invalid_heartbeat',400)
 if (!['logs','metrics','traces','profiles'].includes(signal)) fail('invalid_signal',400)
 const scope={teams:[team],services:[service],environments:[environment]}
 const authorization=request.headers.get('authorization')??''
 // This digest is never returned or stored in health evidence.
 const hash=await secretHash(authorization.slice(7)), now=Date.now()
 const binding=hostId===null?'1=1':`NOT EXISTS(SELECT 1 FROM porthole_host_sources WHERE credential_id=(SELECT id FROM porthole_credentials WHERE secret_hash=?) AND collector_id=? AND team=? AND service=? AND environment=? AND signal=? AND host_id!=?)`
 const bindingArgs=hostId===null?[]:[hash,id,team,service,environment,signal,hostId]
 const result=await verifyCredential(request,env,{action:'telemetry.write',scope,dataScope:scope,writes:(fence,effective)=>{
  if (!effective.signals.includes(signal)) fail('credential_scope_forbidden')
  return [env.DB.prepare(`INSERT INTO porthole_health_collectors(credential_id,collector_id,team,service,environment,signal,observed_at)
   SELECT id,?,?,?,?,?,? FROM porthole_credentials WHERE secret_hash=? AND class='ingest' AND ${fence.sql} AND ${binding}
   ON CONFLICT(credential_id,collector_id,team,service,environment,signal) DO UPDATE SET observed_at=excluded.observed_at`)
   .bind(id,team,service,environment,signal,now,hash,...fence.args,...bindingArgs),...(hostId===null?[]:[
   env.DB.prepare(`INSERT INTO porthole_host_sources SELECT id,?,?,?,?,?,?,?,? FROM porthole_credentials WHERE secret_hash=? AND class='ingest' AND ${fence.sql} AND ${binding}
    ON CONFLICT(credential_id,collector_id,team,service,environment,signal) DO UPDATE SET last_at=MAX(last_at,excluded.last_at) WHERE host_id=excluded.host_id`).bind(id,team,service,environment,signal,hostId,now,now,hash,...fence.args,...bindingArgs),
   env.DB.prepare(`INSERT INTO porthole_host_heartbeats SELECT ?,id,?,?,?,?,?,?,? FROM porthole_credentials WHERE secret_hash=? AND class='ingest' AND ${fence.sql} AND ${binding}`).bind(crypto.randomUUID(),id,team,service,environment,signal,hostId,now,hash,...fence.args,...bindingArgs),
  ])]
 }})
 if(!result.results[0].meta.changes)fail('host_identity_changed',409)
 return {collectorId:id,hostId,observedAt:new Date(now).toISOString(),status:'heartbeat_accepted',telemetryCoverage:'A heartbeat does not establish accepted or queryable telemetry.'}
}
