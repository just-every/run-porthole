import { scopeWhere } from '../../ingest/read'
import type { Bindings } from '../../../auth.server'
import { fail, scopeWithin, type Scope, type Authority } from '../../security/authority'

export interface HostDefinition {
 type:'host-heartbeat'; signal:'logs'|'metrics'|'traces'|'profiles'; hosts:string[]
 missedAfterSeconds:number; pendingSeconds:number; recoverySeconds:number
}
export const hostStatuses=['Healthy','Pending','Firing','Recovering','Unknown'] as const
export function hostDefinition(body:Record<string,unknown>):HostDefinition {
 const keys=['type','signal','hosts','missedAfterSeconds','pendingSeconds','recoverySeconds']
 if(Object.keys(body).some(key=>!keys.includes(key)) || body.type!=='host-heartbeat' || !['logs','metrics','traces','profiles'].includes(String(body.signal)) || !Array.isArray(body.hosts) || !body.hosts.length || body.hosts.length>100 || new Set(body.hosts).size!==body.hosts.length || body.hosts.some(host=>typeof host!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(host)))fail('invalid_host_definition',400)
 for(const key of ['missedAfterSeconds','pendingSeconds','recoverySeconds'])if(!Number.isSafeInteger(body[key])||Number(body[key])<(key==='missedAfterSeconds'?1:0)||Number(body[key])>86400)fail('invalid_host_definition',400)
 return {type:'host-heartbeat',signal:body.signal as HostDefinition['signal'],hosts:[...body.hosts as string[]],missedAfterSeconds:Number(body.missedAfterSeconds),pendingSeconds:Number(body.pendingSeconds),recoverySeconds:Number(body.recoverySeconds)}
}
interface Monitor {id:string;revision:number;scope:string;body:string}
interface Source {credential_id:string;collector_id:string;team:string;service:string;environment:string;signal:string;host_id:string;first_at:number;last_at:number;status:string;expires_at:number;credential_revision:number;member_revision:number;operator_version:number;custodian_scope:string;credential_scope:string;role:string;operator_role:string;operator_status:string}
export interface HostSourceEvidence {
 credentialId:string; collectorId:string; team:string; service:string; environment:string
 credentialRevision:number; memberRevision:number; operatorVersion:number; expiresAt:number
 firstAt:number; lastAt:number; authorized:boolean
}
interface Beat {id:string;credential_id:string;collector_id:string;team:string;service:string;environment:string;observed_at:number}
export interface HostEvidence {
 type:'host-heartbeat'; hostId:string; status:typeof hostStatuses[number]; evaluatedAt:number; lastHeartbeatAt:number|null
 conditionSince:number|null; recoverySince:number|null; transitionAt:number; episode:string|null
 reason:string; definition:HostDefinition; observations:Beat[]; sourceState:string
 sources?:HostSourceEvidence[]
 telemetryCoverage:'unestablished'; delivery:'not_requested'
}
const sourceKey=(row:{credential_id:string;collector_id:string;team:string;service:string;environment:string})=>JSON.stringify([row.credential_id,row.collector_id,row.team,row.service,row.environment])
const inScope=(row:Source,scope:Scope)=>scopeWithin({services:[row.service],environments:[row.environment],teams:[row.team]},scope)
function live(row:Source,now:number) {
 const credentials=JSON.parse(row.credential_scope)
 return row.status==='active'&&row.expires_at>now&&row.operator_status==='active'&&['owner','admin'].includes(row.role)&&row.operator_role===row.role&&credentials.signals.includes(row.signal)&&credentials.actions.includes('telemetry.write')&&inScope(row,credentials)&&inScope(row,JSON.parse(row.custodian_scope))
}
/** Only accepted authenticated receipt times participate. These observations
 * measure heartbeat presence, never traffic completeness or overall health. */
export async function evaluateHostMonitor(env:Bindings,monitor:Monitor,actor?:Authority) {
 const definition=hostDefinition(JSON.parse(monitor.body)),scope=JSON.parse(monitor.scope) as Scope,now=Date.now(),groups:HostEvidence[]=[]
 for(const hostId of definition.hosts) {
  const priorRow=await env.DB.prepare('SELECT evidence,revision FROM porthole_host_monitor_state WHERE object_id=? AND host_id=?').bind(monitor.id,hostId).first<{evidence:string;revision:number}>()
  const previous=priorRow?.revision===monitor.revision?JSON.parse(priorRow.evidence) as HostEvidence:null
  const evidence:HostEvidence={type:'host-heartbeat',hostId,status:'Unknown',evaluatedAt:now,lastHeartbeatAt:null,conditionSince:null,recoverySince:null,transitionAt:now,episode:previous?.episode??null,reason:'Heartbeat storage unavailable; earlier evidence is last-known only.',definition,observations:[],sources:[],sourceState:'storage_unavailable',telemetryCoverage:'unestablished',delivery:'not_requested'}
  let sources:Source[]=[]
  try {
   const where=scopeWhere(scope,'h')
   const candidates=(await env.DB.prepare(`SELECT h.*,c.status,c.expires_at,c.revision AS credential_revision,c.scope AS credential_scope,m.scope AS custodian_scope,m.role,m.revision AS member_revision,o.version AS operator_version,o.role AS operator_role,o.status AS operator_status
    FROM porthole_host_sources h JOIN porthole_credentials c ON c.id=h.credential_id JOIN porthole_members m ON m.operator_id=c.custodian_id JOIN oa_operators o ON o.id=m.operator_id
    WHERE h.host_id=? AND h.signal=? AND ${where.sql} ORDER BY h.credential_id,h.collector_id LIMIT 1001`).bind(hostId,definition.signal,...where.args).all<Source>()).results.filter(row=>inScope(row,scope))
   sources=candidates.filter(row=>live(row,now))
   // Freeze only source identities inside this monitor's scope and the exact
   // authority generations used for this decision. Never copy source grants
   // or credential secrets into historical evaluation evidence.
   evidence.sources=candidates.slice(0,1000).map(row=>({credentialId:row.credential_id,collectorId:row.collector_id,team:row.team,service:row.service,environment:row.environment,credentialRevision:row.credential_revision,memberRevision:row.member_revision,operatorVersion:row.operator_version,expiresAt:row.expires_at,firstAt:row.first_at,lastAt:row.last_at,authorized:live(row,now)}))
   const keys=new Set(sources.map(sourceKey))
   if(candidates.length>1000) {evidence.reason='Source coverage exceeds the bounded evaluation.';evidence.sourceState='incomplete'}
   else if(!sources.length) {evidence.reason=candidates.length?'Registered host sources are revoked, expired or outside current authority.':'Host has never registered in this monitor scope.';evidence.sourceState=candidates.length?'source_unavailable':'never_registered'}
   else {
    const last=Math.max(...sources.map(row=>row.last_at)),miss=definition.missedAfterSeconds*1000
    evidence.lastHeartbeatAt=last;evidence.sourceState='authorized'
    if(last>now) {evidence.reason='Heartbeat receipt is ahead of the evaluation clock.';evidence.sourceState='clock_unavailable'}
    else if(now-last>=miss) {
     evidence.conditionSince=last+miss
     evidence.status=previous?.episode||now>=last+miss+definition.pendingSeconds*1000?'Firing':'Pending'
     evidence.episode=evidence.status==='Firing'?(previous?.episode??crypto.randomUUID()):previous?.episode??null
     evidence.reason=evidence.status==='Firing'?'Authenticated host heartbeat is overdue.':'Missed heartbeat is inside the configured pending duration.'
    } else {
     const from=now-(definition.recoverySeconds+definition.missedAfterSeconds)*1000
     const rows=(await env.DB.prepare('SELECT id,credential_id,collector_id,team,service,environment,observed_at FROM porthole_host_heartbeats WHERE host_id=? AND signal=? AND observed_at>=? AND observed_at<=? ORDER BY observed_at,id LIMIT 10001').bind(hostId,definition.signal,from,now).all<Beat>()).results
     evidence.observations=rows.filter(row=>keys.has(sourceKey(row)))
     if(rows.length>10000) {evidence.reason='Heartbeat observation coverage exceeds the bounded evaluation.';evidence.sourceState='incomplete'}
     else {
      let since:number|null=null,lastBeat:number|null=null
      for(const beat of evidence.observations) {
       if(lastBeat===null||beat.observed_at-lastBeat>=miss)since=beat.observed_at
       lastBeat=beat.observed_at
      }
      // A historical firing episode resolves only after continuous accepted
      // presence spans the configured recovery window. A gap restarts it.
      const recovering=!!previous?.episode && (since===null||now-since<definition.recoverySeconds*1000)
      evidence.status=recovering?'Recovering':'Healthy';evidence.recoverySince=previous?.episode?since:null
      evidence.episode=recovering?previous!.episode:null
      evidence.reason=recovering?'Heartbeat returned; the configured recovery window is still pending.':'Accepted heartbeat is fresh. Telemetry coverage and overall host health remain unestablished.'
     }
    }
    if(!evidence.observations.length && evidence.lastHeartbeatAt!==null) {
     const rows=(await env.DB.prepare('SELECT id,credential_id,collector_id,team,service,environment,observed_at FROM porthole_host_heartbeats WHERE host_id=? AND signal=? AND observed_at=? ORDER BY id LIMIT 1001').bind(hostId,definition.signal,last).all<Beat>()).results
     evidence.observations=rows.filter(row=>keys.has(sourceKey(row)))
    }
   }
  }catch {evidence.status='Unknown';evidence.sourceState='storage_unavailable';evidence.reason='Heartbeat storage unavailable; earlier evidence is last-known only.'}
  if(previous?.status===evidence.status)evidence.transitionAt=previous.transitionAt
  // One JSON binding avoids a SQL parameter for each source while repeating
  // every credential, membership and native account generation at commit.
  const sourceVersions=[...new Map(sources.map(source=>[source.credential_id,{id:source.credential_id,credential:source.credential_revision,member:source.member_revision,operator:source.operator_version}])).values()]
  const id=crypto.randomUUID(),sourceFence=`NOT EXISTS(SELECT 1 FROM json_each(?) j
   LEFT JOIN porthole_credentials c ON c.id=json_extract(j.value,'$.id')
   LEFT JOIN porthole_members m ON m.operator_id=c.custodian_id LEFT JOIN oa_operators o ON o.id=m.operator_id
   WHERE c.id IS NULL OR m.operator_id IS NULL OR o.id IS NULL OR c.revision!=json_extract(j.value,'$.credential') OR m.revision!=json_extract(j.value,'$.member') OR o.version!=json_extract(j.value,'$.operator') OR c.status!='active' OR c.expires_at<=? OR o.status!='active')`
  const args=[JSON.stringify(sourceVersions),now]
  const fence=` AND ${sourceFence}${actor?' AND '+actor.fence:''}`
  const saved=await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_host_monitor_evaluations SELECT ?,id,revision,?,?,? FROM porthole_objects WHERE id=? AND revision=? AND state='active'${fence}`).bind(id,hostId,now,JSON.stringify(evidence),monitor.id,monitor.revision,...args,...(actor?.args??[])),
   env.DB.prepare(`INSERT INTO porthole_host_monitor_state SELECT object_id,revision,host_id,evaluated_at,evidence FROM porthole_host_monitor_evaluations WHERE id=?
    ON CONFLICT(object_id,host_id) DO UPDATE SET revision=excluded.revision,evaluated_at=excluded.evaluated_at,evidence=excluded.evidence WHERE excluded.evaluated_at>=evaluated_at`).bind(id),
  ])
  if(!saved[0].meta.changes)fail('revision_or_authority_changed',409)
  groups.push(evidence)
 }
 return {monitorId:monitor.id,revision:monitor.revision,type:definition.type,status:groups.some(row=>row.status==='Unknown')?'Unknown':groups.some(row=>row.status==='Firing')?'Firing':groups.some(row=>row.status==='Pending'||row.status==='Recovering')?'Pending':'Healthy',groups}
}

/** Closed portable evidence: restoring history never supplies live authority. */
export function validateHostEvidence(value:unknown):HostEvidence {
 const bad=():never=>fail('archive_semantics_invalid',422)
 if(!value||typeof value!=='object'||Array.isArray(value))return bad()
 const row=value as Record<string,unknown>,keys=['type','hostId','status','evaluatedAt','lastHeartbeatAt','conditionSince','recoverySince','transitionAt','episode','reason','definition','observations','sourceState','telemetryCoverage','delivery']
 // Archives written before source snapshots remain losslessly readable.
 if(Object.hasOwn(row,'sources'))keys.push('sources')
 if(Object.keys(row).sort().join(',')!==keys.sort().join(',')||row.type!=='host-heartbeat'||!hostStatuses.includes(row.status as never)||typeof row.hostId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(row.hostId)||row.telemetryCoverage!=='unestablished'||row.delivery!=='not_requested')return bad()
 for(const key of ['evaluatedAt','transitionAt'])if(!Number.isSafeInteger(row[key])||Number(row[key])<0)return bad()
 for(const key of ['lastHeartbeatAt','conditionSince','recoverySince'])if(row[key]!==null&&(!Number.isSafeInteger(row[key])||Number(row[key])<0))return bad()
 if(row.episode!==null&&(typeof row.episode!=='string'||!/^[a-f0-9-]{36}$/.test(row.episode))||typeof row.reason!=='string'||typeof row.sourceState!=='string'||!Array.isArray(row.observations)||row.observations.length>10000)return bad()
 try{const definition=hostDefinition(row.definition as Record<string,unknown>);if(!definition.hosts.includes(row.hostId))return bad()}catch{return bad()}
 if(row.sources!==undefined) {
  if(!Array.isArray(row.sources)||row.sources.length>1000)return bad()
  for(const source of row.sources) {
   if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).sort().join(',')!=='authorized,collectorId,credentialId,credentialRevision,environment,expiresAt,firstAt,lastAt,memberRevision,operatorVersion,service,team'||typeof source.authorized!=='boolean')return bad()
   for(const key of ['credentialId','collectorId','team','service','environment'])if(typeof source[key]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(source[key]))return bad()
   for(const key of ['credentialRevision','memberRevision','operatorVersion','expiresAt','firstAt','lastAt'])if(!Number.isSafeInteger(source[key])||source[key]<0)return bad()
   if(source.firstAt>source.lastAt)return bad()
  }
 }
 for(const beat of row.observations) {
  if(!beat||typeof beat!=='object'||Object.keys(beat).sort().join(',')!=='collector_id,credential_id,environment,id,observed_at,service,team'||!Number.isSafeInteger(beat.observed_at)||beat.observed_at<0)return bad()
  for(const key of ['id','credential_id','collector_id','team','service','environment'])if(typeof beat[key]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(beat[key]))return bad()
 }
 return value as HostEvidence
}
