import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { privateHeaders } from '../document'
import { authority, fail, proofFence, scopeWithin } from '../security/authority'
import { input, text } from '../security/input'
import { definitionInput, windowInput, type SloRow } from './model'
import { evaluate } from './evaluate'
const base='/api/porthole/v1/slos'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:privateHeaders})
export async function sloResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname!==base&&!url.pathname.startsWith(base+'/')&&url.pathname!=='/api/porthole/v1/reports/slo')return null
 try {
  const write=request.method==='POST'&&url.pathname===base
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:write})
  if(url.search)fail('invalid_query',400)
  if(write) {
   if(actor.member.role!=='owner')fail('owner_required')
   const data=await input(request),definition=definitionInput(data.definition),name=text(data.name)
   if(data.confirm!=='save-slo')fail('confirmation_required',400)
   if(!scopeWithin(definition.scope,actor.member.scope))fail('scope_forbidden')
   const id=data.id===undefined?crypto.randomUUID():text(data.id,36)
   const previous=await env.DB.prepare('SELECT * FROM porthole_slo_versions WHERE id=? ORDER BY revision DESC LIMIT 1').bind(id).first<SloRow>()
   if(data.id!==undefined&&(!previous||previous.state!=='active'))fail('slo_unavailable',404)
   if(previous&&!scopeWithin(definitionInput(JSON.parse(previous.definition)).scope,actor.member.scope))fail('scope_forbidden')
   const revision=previous?previous.revision+1:1
   if(previous&&data.revision!==previous.revision)fail('revision_changed',409)
   const proof=proofFence(actor)
   const result=await env.DB.prepare(`INSERT INTO porthole_slo_versions SELECT ?,?,?,?,?,?,'active' WHERE ${actor.fence} AND ${proof.sql} AND COALESCE((SELECT MAX(revision) FROM porthole_slo_versions WHERE id=?),0)=?`).bind(id,revision,name,JSON.stringify(definition),actor.member.operatorId,Date.now(),...actor.args,...proof.args,id,revision-1).run()
   if(!result.meta.changes)fail('revision_or_authority_changed',409)
   return json({id,revision},201)
  }
  if(request.method==='GET'&&url.pathname===base) {
   const rows=(await env.DB.prepare(`SELECT * FROM porthole_slo_versions WHERE state='active' AND ${actor.fence} ORDER BY id,revision`).bind(...actor.args).all<SloRow>()).results
   return json({versions:rows.filter(row=>scopeWithin(definitionInput(JSON.parse(row.definition)).scope,actor.member.scope)).map(row=>({...row,definition:JSON.parse(row.definition)}))})
  }
  if(request.method!=='POST'||![base+'/evaluate','/api/porthole/v1/reports/slo'].includes(url.pathname))fail('method_not_allowed',405)
  const data=await input(request),{from,through}=windowInput(data)
  if(!Array.isArray(data.slos)||!data.slos.length||data.slos.length>20)fail('invalid_slo_selection',400)
  const selected=new Set<string>(),reports=[]
  for(const selection of data.slos) {
   if(!selection||typeof selection!=='object'||typeof selection.id!=='string'||!Number.isSafeInteger(selection.revision)||selected.has(selection.id))fail('invalid_slo_selection',400)
   selected.add(selection.id)
   const row=await env.DB.prepare(`SELECT * FROM porthole_slo_versions WHERE id=? AND revision=? AND state='active' AND ${actor.fence}`).bind(selection.id,selection.revision,...actor.args).first<SloRow>()
   if(!row)fail('slo_unavailable',404)
   const d=definitionInput(JSON.parse(row.definition))
   if(!scopeWithin(d.scope,actor.member.scope))fail('scope_forbidden')
   const measured=await evaluate(env,d,from,through)
   reports.push({id:row.id,revision:row.revision,name:row.name,...measured})
  }
  const report={format:'porthole.slo-report.v1',generatedAt:Date.now(),from,through,timeZone:'UTC',offset:'+00:00',scheduled:false,reports}
  if(data.format===undefined||data.format==='json')return json(report)
  if(data.format!=='csv')fail('unsupported_export_format',400)
  const columns=['id','revision','name','from','through','sourceId','type','good','total','bad','allowedNumerator','remainingNumerator','budgetDenominator','coverage','health','budget75']
  // Every field is quoted; spreadsheet formulas in owner labels are inert.
  const quote=(value:unknown)=>'"'+String(value).replaceAll('"','""')+'"'
  const lines=reports.map(r=>[r.id,r.revision,r.name.replace(/^[=+@-]/,"'$&"),r.from,r.through,r.sourceId,r.definition.type,r.good,r.total,r.bad,r.budget.allowed.numerator,r.budget.remaining.numerator,'1000000',r.coverage.status,r.health,r.budget75].map(quote).join(','))
  return new Response([columns.map(quote).join(','),...lines].join('\r\n')+'\r\n',{headers:{...privateHeaders,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="slo-report.csv"'}})
 } catch(error) {
  return json({error:error instanceof AuthError?error.code:'slos_unavailable'},error instanceof AuthError?error.status:503)
 }
}
