import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { privateHeaders } from '../../document'
import { authority, fail, proofFence, scopeWithin } from '../../security/authority'
import { input } from '../../security/input'
import { canonical, IntakeError, sha256 } from '../model'
import { defaults, policy, policyScope } from './model'
import { samplingQuery } from './query'
const root='/api/porthole/v1/sampling'
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders})
export async function samplingResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path!==root&&!path.startsWith(root+'/'))return null
 try {
  if(url.search)fail('invalid_query',400)
  const write=path===root+'/preview'||path===root+'/approve'
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:path===root+'/approve'})
  if(actor.session.kind!=='native')fail('native_session_required')
  if(write&&actor.member.role!=='owner')fail('owner_required')
  if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role))fail('telemetry_forbidden')
  if(path===root&&request.method==='GET') {
   const rows=(await env.DB.prepare(`SELECT revision,definition,from_sequence,created_at,state FROM porthole_sampling_policies WHERE ${actor.fence} ORDER BY created_at,revision`).bind(...actor.args).all<{revision:number;definition:string;from_sequence:number;created_at:number;state:string}>()).results
   return json({defaults,protectedErrors:true,identity:'team/environment/traceId',policies:rows.filter(row=>scopeWithin(policyScope(JSON.parse(row.definition)),actor.member.scope)).map(row=>({...row,definition:JSON.parse(row.definition)})),upstream:'unknown',independentlyVerified:false})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request)
  if(path===root+'/query')return json(await samplingQuery(env,actor,data))
  if(path===root+'/preview') {
   const d=policy(data.definition)
   if(!scopeWithin(policyScope(d),actor.member.scope))fail('scope_forbidden')
   const current=await env.DB.prepare('SELECT MAX(revision) AS revision FROM porthole_sampling_policies WHERE team=? AND service=? AND environment=?').bind(d.team,d.service,d.environment).first<{revision:number|null}>()
   const revision=data.revision===undefined?current?.revision??0:Number(data.revision)
   if(!Number.isSafeInteger(revision)||revision<0||revision!==(current?.revision??0))fail('revision_changed',409)
   const digest=await sha256(new TextEncoder().encode(canonical({definition:d,revision}))),id=crypto.randomUUID(),expiresAt=Date.now()+300000
   const result=await env.DB.prepare(`INSERT INTO porthole_sampling_previews(id,operator_id,session_id,definition,digest,expected_revision,expires_at) SELECT ?,?,?,?,?,?,? WHERE ${actor.fence}`).bind(id,actor.member.operatorId,actor.session.id,canonical(d),digest,revision,expiresAt,...actor.args).run()
   if(!result.meta.changes)fail('authority_changed',409)
   return json({id,digest,definition:d,revision,expiresAt,protectedErrors:true,scope:policyScope(d),cost:'No external purchase authorized. Existing installation quotas apply; USD estimate unavailable.',effect:'Future accepted batches only; whole-trace protection may retain earlier siblings. Upstream completeness is unknown.'})
  }
  if(path!==root+'/approve')fail('not_found',404)
  if(data.confirm!=='approve-sampling-policy')fail('confirmation_required',400)
  const preview=await env.DB.prepare('SELECT * FROM porthole_sampling_previews WHERE id=? AND operator_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>?').bind(data.previewId,actor.member.operatorId,actor.session.id,Date.now()).first<{id:string;definition:string;digest:string;expected_revision:number}>()
  if(!preview||preview.digest!==data.digest)fail('preview_changed_or_expired',409)
  const d=policy(JSON.parse(preview.definition))
  const current=await authority(request,env,{stepUp:true})
  if(current.member.role!=='owner'||!scopeWithin(policyScope(d),current.member.scope))fail('authority_changed',409)
  const proof=proofFence(current),now=Date.now(),revision=preview.expected_revision+1
  const results=await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_sampling_policies(team,service,environment,revision,definition,from_sequence,owner_id,created_at)
    SELECT ?,?,?,?, ?, (SELECT COALESCE(MAX(sequence),0)+1 FROM porthole_ingest_batches),?,? WHERE ${current.fence} AND ${proof.sql}
    AND EXISTS(SELECT 1 FROM porthole_sampling_previews WHERE id=? AND operator_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))
    AND COALESCE((SELECT MAX(revision) FROM porthole_sampling_policies WHERE team=? AND service=? AND environment=?),0)=?
    AND (SELECT COUNT(*) FROM porthole_sampling_policies)<1000`).bind(d.team,d.service,d.environment,revision,canonical(d),current.member.operatorId,now,...current.args,...proof.args,preview.id,current.member.operatorId,current.session.id,d.team,d.service,d.environment,preview.expected_revision),
   env.DB.prepare('UPDATE porthole_sampling_previews SET consumed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM porthole_sampling_policies WHERE team=? AND service=? AND environment=? AND revision=? AND created_at=?)').bind(now,preview.id,d.team,d.service,d.environment,revision,now)
  ])
  if(!results[0].meta.changes)fail('revision_or_authority_changed',409)
  return json({revision,definition:d,protectedErrors:true},201)
 }catch(error){const known=error instanceof AuthError||error instanceof IntakeError;return json({error:known?error.code:'sampling_unavailable'},known?error.status:503)}
}
