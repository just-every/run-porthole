import {expireRetention} from './expiry'
import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { authority,fail,proofFence } from '../security/authority'
import { input } from '../security/input'
import { digest } from '../audit/store'
import { privateHeaders } from '../document'

const root='/api/porthole/v1/retention'
export async function retentionResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(![root,root+'/preview',root+'/approve',root+'/tick'].includes(url.pathname))return null
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
 try {
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(actor.session.kind!=='native'||actor.member.role!=='owner'||Object.values(actor.member.scope).some(values=>!values.includes('*')))fail('unrestricted_native_owner_required')
  if(url.search)fail('invalid_retention',400)
  if(url.pathname===root+'/tick'){if(request.method!=='POST')fail('method_not_allowed',405);const data=await input(request);if(Object.keys(data).length)fail('invalid_retention',400);return json(await expireRetention(env))}
  if(url.pathname===root&&request.method==='GET')return json({policies:(await env.DB.prepare(`SELECT * FROM porthole_retention_policies WHERE ${actor.fence} ORDER BY id`).bind(...actor.args).all()).results,schedules:(await env.DB.prepare('SELECT policy_id,policy_revision,approved_at,next_run_at FROM porthole_retention_schedules ORDER BY policy_id').all()).results,runs:(await env.DB.prepare('SELECT * FROM porthole_retention_runs ORDER BY started_at,id LIMIT 100').all()).results,expiryExecution:'Only explicitly approved hourly schedules execute.'})
  if(request.method!=='POST'||url.pathname===root)fail('method_not_allowed',405)
  const data=await input(request),approve=url.pathname.endsWith('/approve'),selection=data.selection as Record<string,unknown>
  if(data.schedule!==undefined&&typeof data.schedule!=='boolean')fail('invalid_retention',400)
  if(Object.keys(data).some(key=>!(approve?['selection','days','cutoffNs','confirm','schedule']:['selection','days','schedule']).includes(key))||!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).sort().join(',')!=='service,signal,team'||!['logs','metrics','traces','profiles'].includes(String(selection.signal))||[selection.service,selection.team].some(value=>typeof value!=='string'||!/^([a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}|\*)$/.test(value))||!Number.isSafeInteger(data.days)||Number(data.days)<1||Number(data.days)>730)fail('invalid_retention',400)
  const chosen={signal:selection.signal as string,service:selection.service as string,team:selection.team as string},days=Number(data.days),now=Date.now(),earliest=BigInt(now-days*86400000)*1000000n
  const cutoff=approve?data.cutoffNs:String(earliest)
  if(typeof cutoff!=='string'||!/^\d{1,20}$/.test(cutoff)||BigInt(cutoff)>earliest||BigInt(cutoff)<earliest-300000000000n)fail('retention_preview_expired',409)
  const id=(await digest(JSON.stringify(chosen))).slice(0,32),existing=await env.DB.prepare('SELECT revision FROM porthole_retention_policies WHERE id=?').bind(id).first<{revision:number}>(),revision=existing?.revision??0
  const query=`WITH retained AS (SELECT id,signal,service,team,event_time_ns,payload FROM porthole_telemetry_records UNION ALL SELECT id,signal,service,team,event_time_ns,payload FROM porthole_telemetry_archive a WHERE NOT EXISTS(SELECT 1 FROM porthole_telemetry_records h WHERE h.id=a.id)) SELECT COUNT(*) AS records,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS payloadBytes FROM retained WHERE signal=? AND (?='*' OR service=?) AND (?='*' OR team=?) AND event_time_ns<?`
  const volumes=await env.DB.prepare(query).bind(chosen.signal,chosen.service,chosen.service,chosen.team,chosen.team,cutoff.padStart(20,'0')).first<{records:number;payloadBytes:number}>()
  const packet={selection:chosen,days,cutoffNs:cutoff,revision,volumes,schedule:data.schedule===true},fingerprint=await digest(JSON.stringify(packet))
  const qualification=chosen.signal==='traces'&&days<15?'Below the switching-buyer trace minimum; unqualified.':'Retention selection only; full-horizon expiry and query qualification remain unproved.'
  if(!approve)return json({...packet,digest:fingerprint,qualification,loss:'Removing this history loses its contribution to historical analysis. Preview deletes nothing.',expiryExecution:data.schedule===true?'Approval authorizes an hourly moving cutoff, beginning one hour after approval.':'No schedule approved; no automatic deletion.'})
  if(data.confirm!==fingerprint)fail('retention_preview_changed',409)
  const proof=proofFence(actor)
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} AND COALESCE((SELECT revision FROM porthole_retention_policies WHERE id=?),0)=? THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args,id,revision),
   env.DB.prepare('INSERT INTO porthole_retention_policies(id,selection,days,revision,changed_at,active) VALUES(?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET days=excluded.days,revision=excluded.revision,changed_at=excluded.changed_at,active=1').bind(id,JSON.stringify(chosen),days,revision+1,now),
   env.DB.prepare('DELETE FROM porthole_retention_schedules WHERE policy_id=?').bind(id),
   ...(data.schedule===true?[env.DB.prepare('INSERT INTO porthole_retention_schedules(policy_id,policy_revision,owner_ref,owner_revision,owner_version,approved_at,next_run_at) VALUES(?,?,?,?,?,?,?)').bind(id,revision+1,actor.member.operatorId,actor.member.revision,actor.session.operator.version,now,now+3600000)]:[]),
  ])
  return json({id,days,revision:revision+1,qualification,scheduled:data.schedule===true,expiryExecution:'Policy approval deletes nothing immediately; only an explicitly approved schedule can expire history.'})
 }catch(error){return json({error:error instanceof AuthError?error.code:'retention_unavailable'},error instanceof AuthError?error.status:503)}
}
