import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {createImportOperatorHandler,readImportDoorHistory} from '../../modules/import-kit/src/door/operator.ts'
import type {D1Database as KitDatabase,D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {input} from '../security/input'
import {authority,fail,proofFence} from '../security/authority'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {migrationReplay,replayForm} from './replay'
import {resolutionPage,saveResolution} from './evidence/resolution'
import {migrationTargets} from './evidence/targets'
import {importSource,sources} from './sources'
const installationId='porthole-migration-v1',destination='migration-evidence'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
const field=(name:string,value:string)=>`<input type="hidden" name="${name}" value="${escape(value)}">`
function controls(source:string,planId:string,fingerprint:string){return ['apply','status','reconcile','undo'].map(action=>`<form method="post" action="/app/import/${action}">${field('source',source)}${field('planId',planId)}${action==='apply'?field('reviewedFingerprint',fingerprint):''}${action==='apply'?'<label><input type="checkbox" required name="confirm" value="reviewed"> I reviewed this exact fingerprint and its limitations</label>':''}<button>${({apply:'Apply or resume reviewed plan',status:'Refresh saved status',reconcile:'Reconcile source evidence',undo:'Undo imported evidence'})[action]}</button></form>`).join('')}
async function owner(request:Request,env:Bindings){
 const actor=await authority(request,env,{manage:true,post:request.method==='POST',stepUp:request.method==='POST'})
 if(actor.member.role!=='owner')fail('owner_required')
 const proof=request.method==='POST'?proofFence(actor):{sql:'1',args:[]}
 return {sql:`(${actor.fence}) AND (${proof.sql}) AND EXISTS(SELECT 1 FROM porthole_members WHERE operator_id=? AND role='owner')`,params:[...actor.args,...proof.args,actor.member.operatorId],email:actor.session.operator.email} satisfies D1Sql & {email:string}
}
async function handler(request:Request,env:Bindings,name:string){
 const source=importSource(name)
 if(!source)return json({error:'unknown_import_source'},400)
 let currentOwner
 try{currentOwner=await owner(request,env)}catch(error){if(error instanceof AuthError)return json({error:error.code},error.status);throw error}
 return createImportOperatorHandler({...source,database:env.DB as unknown as KitDatabase,targets:migrationTargets,
  installationId,appOrigin:env.AUTH_ORIGIN!,ownerEmail:currentOwner.email,ownerPrincipalId:'role:owner',namespace:name,destination,format:'json',
  reversalPolicy:'preserve-conflicts',limits:{maxBytes:1048576,maxRecords:200,maxRecordBytes:name==='splunk'?1048576:65536},
  authorize:async r=>{try{return await owner(r,env)}catch(error){if(error instanceof AuthError)return null;throw error}},
 })(request)
}
async function readRecords(env:Bindings,predicate:D1Sql){
 const guard=()=>env.DB.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('OWNER_REQUIRED') END`).bind(...predicate.params??[])
 const results=await env.DB.batch<Record<string,unknown>>([guard(),env.DB.prepare('SELECT kind,id,body,revision FROM porthole_migration_records ORDER BY kind,id'),guard()])
 return results[1].results.map(r=>({targetKind:r.kind as string,targetId:r.id as string,value:JSON.parse(r.body as string),revision:r.revision as string}))
}
async function page(env:Bindings,predicate:D1Sql,source='splunk',result?:Record<string,unknown>,status=200){
 const history=await readImportDoorHistory(env.DB as unknown as KitDatabase,installationId,predicate)
 const rows=await readRecords(env,predicate)
 const warning='<p role="note">Source evidence only. Business imports are disabled; only the native owner can import. Imports do not activate monitors, change collection, send notifications or transfer credentials. Native query translation, detector replay and equivalent cutover remain unqualified. Keep source monitoring and history available. Undo preserves source evidence edited by a reviewer; inspect retained records after Undo.</p>'
 const sourceWork=result&&Array.isArray(result.diagnostics)?result.diagnostics.filter((d:Record<string,unknown>)=>d.code==='UNMAPPED'):[]
 const review=sourceWork.length?`<section aria-label="Unresolved source work"><h2>Source work to resolve</h2><p>Every item remains a source dependency. Applying this plan retains evidence only.</p><ul>${sourceWork.map((d:Record<string,unknown>)=>`<li><strong>${escape(String(d.kind))} · ${escape(String(d.sourceId))}</strong> ${d.field?`<code>${escape(String(d.field))}</code> `:''}${escape(String(d.message))}</li>`).join('')}</ul></section>`:''
 const summary=result?.summary&&typeof result.summary==='object'?result.summary as Record<string,unknown>:null
 const counts=summary?`<dl>${Object.entries(summary).map(([key,value])=>`<dt>${escape(key)}</dt><dd>${escape(String(value))}</dd>`).join('')}</dl>`:''
 const rejected=result&&Array.isArray(result.rejected)?result.rejected as Record<string,unknown>[]:[]
 const rejections=rejected.length?`<h3>Rejected source records</h3><ul>${rejected.map(r=>`<li>${escape(String(r.kind))} · ${escape(String(r.sourceId))}: ${escape(String(r.reason))}</li>`).join('')}</ul>`:''
 const outcome=result?`<section aria-label="Import result"><h2>${result.error?'Import refused':'Saved plan and result'}</h2>${typeof result.fingerprint==='string'?`<p>Reviewed fingerprint <code>${escape(result.fingerprint)}</code></p>`:''}${counts}${rejections}${result.error?`<pre>${escape(JSON.stringify(result,null,2))}</pre>`:`<details><summary>Technical plan details</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details>`}${typeof result.planId==='string'?controls(source,result.planId,typeof result.fingerprint==='string'?result.fingerprint:''):''}</section>`:''
 const specialist=rows.some(r=>r.targetKind==='securityDashboards')?'<section aria-label="Security specialist handoff"><h2>Security specialist required</h2><p>Keep the original security dashboards in Splunk Enterprise Security or your selected specialist. Porthole retains their references; it does not execute security searches or provide security analytics.</p></section>':''
 const body=`${warning}${specialist}<p><a href="/app/import/guide">Export formats and remaining work</a></p><h2>Upload and preview</h2><form method="post" enctype="multipart/form-data" action="/app/import/plan"><label>Source <select name="source">${sources.map(s=>`<option value="${s}"${s===source?' selected':''}>${s}</option>`).join('')}</select></label><label>Source export JSON (up to 1 MiB, 200 objects) <input name="export" type="file" accept="application/json,.json" required></label><label><input name="catchup" type="checkbox" value="yes"> Compare a later export with the applied source snapshot</label><button>Save preview</button></form>${review}${outcome}<h2>Import history</h2>${history.length?history.map(h=>`<section><h3>${escape(h.namespace)} · ${escape(h.state)}</h3><p>${escape(h.caption)}</p><p>Fingerprint <code>${escape(h.fingerprint)}</code></p>${controls(h.namespace,h.planId,h.fingerprint)}</section>`).join(''):'<p>No approved imports.</p>'}${replayForm(rows.filter(r=>r.value.vendor==='splunk'&&['charts','detectors'].includes(r.targetKind)))}<h2>Retained source records (${rows.length})</h2>${rows.map(r=>`<p><a href="/app/import/review?kind=${encodeURIComponent(r.targetKind)}&amp;id=${encodeURIComponent(r.targetId)}">Review source items · ${escape(r.targetId)}</a></p><details><summary>${escape(r.targetKind)} · ${escape(r.targetId)}</summary><pre>${escape(JSON.stringify(r.value,null,2))}</pre></details>`).join('')}`
 return document('Move in',body,status,{forms:true})
}
async function boundedForm(request:Request){
 const reader=request.body?.getReader();if(!reader)fail('export_required',400)
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152)fail('export_too_large',413);chunks.push(value)}}finally{await reader.cancel()}
 const body=new Uint8Array(size);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length}
 return new Request(request.url,{method:'POST',headers:request.headers,body}).formData()
}
export async function migrationResponse(request:Request,env:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!path.startsWith('/app/import')&&!path.startsWith('/api/operator/import/')&&!path.startsWith('/api/rer/import/')&&!['/api/porthole/v1/migration/records','/api/porthole/v1/migration/replay','/api/porthole/v1/migration/resolutions'].includes(path))return null
 try{
  if(path.startsWith('/api/rer/import/'))return json({error:'not_found'},404)
  if(path.startsWith('/api/operator/import/'))return handler(request,env,request.headers.get('x-import-source')??'')
  const predicate=await owner(request,env)
  if(path==='/app/import/review'&&request.method==='GET')return await resolutionPage(request,env,predicate)
  if(['/app/import/resolutions','/api/porthole/v1/migration/resolutions'].includes(path)&&request.method==='POST'){
   return await saveResolution(await input(request),env,predicate,path.startsWith('/app/'))
  }
  if(['/app/import/replay','/api/porthole/v1/migration/replay'].includes(path)&&request.method==='POST')return await migrationReplay(request,env,predicate,path.startsWith('/app/'))
  if(path==='/api/porthole/v1/migration/records'&&request.method==='GET')return json({qualification:'source-evidence-only',records:await readRecords(env,predicate)})
  if(path==='/app/import'&&request.method==='GET')return page(env,predicate)
  if(path==='/app/import/guide'&&request.method==='GET')return document('Move-in export guide',`<p>Export only data you are authorized to retain. Keep the source available. Use a JSON object whose collection names contain arrays of original source objects, each with a stable id, uuid or name. Nested source fields are preserved as inactive evidence; this is not native query or alert conversion.</p><p>Splunk collections: charts, dashboards, detectors, services, rum, slos, notifications, logSearches, history, securityDashboards. For charts, dashboards and detectors, wrap complete original v2 resource arrays or complete list envelopes with count and results. Partial pages are named rejections. Chart list entries omit programText and tags: fetch each chart detail. The read-only command <code>node scripts/splunk-export.mjs --realm us0 --output ./splunk-export.json</code> saves these definitions; use <code>--resume</code> after an interrupted extraction. Keep its private checkpoint with the export. Set the source token only in the command environment. Every query and construct is listed for source parity review. The separate retained-sample analyzer supports only its stated grammar; imports do not execute queries or activate alerts. Obtain chart and detector definitions from the documented Splunk Observability API; attach authorized Log Observer and Splunk platform search references. Do not export credentials. Security dashboards require Splunk Enterprise Security or your selected specialist.</p><h2>Collect new telemetry</h2><p>After reviewing the source evidence, open <a href="/app/settings/credentials">Credentials</a> and mint a new ingest identity restricted to the intended services, environments, teams and signals. Configure your standard OTel exporter with this installation origin and its new identity in the private authorization header. Never copy a source credential. Use the repository OTLP guide for protocol configuration. Verify accepted and queryable signals in <a href="/app/ingest">Pipeline intake</a> and open the new request in <a href="/app/traces">Traces</a> before any separate cutover decision. This screen does not change a collector.</p><p>Challenger collection names and remaining qualification work are documented in the repository migration guide. Paid export limits, unread history and untranslated SignalFlow or SPL expressions stay named source work. No source is retired by this screen.</p><p><a href="/app/import">Return to Move in</a></p>`)
  const action=path.slice('/app/import/'.length)
  if(request.method!=='POST'||!['plan','apply','status','reconcile','undo'].includes(action))return json({error:'not_found'},404)
  const form=await boundedForm(request),source=String(form.get('source')??'')
  if(!importSource(source))fail('unknown_import_source',400)
  const call=async(action:string,body:unknown)=>{
   const headers=new Headers(request.headers);headers.set('content-type','application/json');headers.set('x-import-source',source);headers.delete('content-length')
   const response=await handler(new Request(env.AUTH_ORIGIN+'/api/operator/import/'+action,{method:'POST',headers,body:JSON.stringify(body)}),env,source)
   if(!response)throw Error('import_handler_missing')
   return {status:response.status,data:await response.json() as Record<string,unknown>}
  }
  if(action==='plan'){
   const file=form.get('export');if(!(file instanceof File)||!file.size)fail('export_required',400)
   if(file.size>1048576)fail('export_too_large',413)
   const bytes=new Uint8Array(await file.arrayBuffer()),hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('')
   const bundleSha256=await hash(bytes),totalChunks=Math.ceil(bytes.length/65536);let uploadId:unknown
   for(let index=0;index<totalChunks;index++){
    const chunk=bytes.slice(index*65536,(index+1)*65536);let binary='';for(const b of chunk)binary+=String.fromCharCode(b)
    const uploaded=await call('uploads',{uploadId,name:file.name,bundleSha256,totalBytes:bytes.length,totalChunks,index,chunkSha256:await hash(chunk),base64:btoa(binary)})
    if(uploaded.status!==200)return page(env,predicate,source,uploaded.data,uploaded.status)
    uploadId=uploaded.data.uploadId
   }
   const planned=await call('plan',{uploadId,...(form.get('catchup')==='yes'?{catchup:true}:{})})
   return page(env,predicate,source,planned.data,planned.status)
  }
  if(action==='apply'&&form.get('confirm')!=='reviewed')fail('review_confirmation_required',400)
  const result=await call(action,{planId:form.get('planId'),...(action==='apply'?{reviewedFingerprint:form.get('reviewedFingerprint')}:{})})
  const fingerprint=action==='apply'?form.get('reviewedFingerprint'):result.data.fingerprint
  return page(env,predicate,source,{...result.data,...(typeof fingerprint==='string'?{fingerprint}:{})},result.status)
 }catch(error){const status=error instanceof AuthError?error.status:503,code=error instanceof AuthError?error.code:'migration_unavailable';return path.startsWith('/app/')?document('Move in unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/import">Return to Move in</a></p>`,status):json({error:code},status)}
}
