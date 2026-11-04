import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {CredentialLimit} from '../../credentials/verify'
import {authority,fail} from '../../security/authority'
import {input} from '../../security/input'
import {operationDocument as document,escape,privateHeaders} from '../../document'
import {ExplorationError} from '../../explore/normalize'
import {clusters} from './read'
const api='/api/porthole/v1/logs/clusters',page='/app/explore/clusters'
export async function clusterResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),browser=url.pathname===page
 if(!browser&&url.pathname!==api)return null
 try{
  if(!['GET','POST'].includes(request.method)||!browser&&request.method!=='POST')fail('method_not_allowed',405)
  if(!browser&&url.search)fail('invalid_cluster_query',400)
  if(!browser&&!request.headers.has('authorization'))await authority(request,env,{post:true})
  if(browser)await authority(request,env,{post:request.method==='POST'})
  if(browser&&request.method==='GET'&&!url.search)return document('Log patterns',`<p><a href="/app/explore">Explore telemetry</a></p><p>Group retained log messages at one completion watermark. Counts describe only your current scope. Partial scans do not publish patterns or counts.</p><form method="get" action="${page}"><label>Service <input name="service" required></label><label>Environment <input name="environment" required></label><label>Team <input name="team" required></label><label>From in nanoseconds <input name="from" inputmode="numeric"></label><label>Through in nanoseconds <input name="through" inputmode="numeric"></label><button>Find patterns</button></form>`,200,{forms:true})
  if(browser&&request.method==='GET'&&new Set(url.searchParams.keys()).size!==[...url.searchParams].length)fail('invalid_cluster_query',400)
  const data=request.method==='GET'?Object.fromEntries(url.searchParams):await input(request)
  const {actorRef,actorRevision,...result}=await clusters(request,env,data)
  const headers={...privateHeaders,'x-porthole-actor':actorRef,'x-porthole-actor-revision':String(actorRevision)}
  if(!browser)return Response.json(result,{headers})
  const link=(extra:Record<string,string|number|null>)=>{
   const next=new URL(page,request.url)
   for(const [key,value]of Object.entries({...result.parameters,scanLimit:result.scanLimit,limit:result.limit,...extra}))if(value!==null)next.searchParams.set(key,String(value))
   return escape(next.pathname+next.search)
  }
  const body=result.state==='partial'?`<p role="status">Partial scan: ${escape(result.reason!)}. Scanned ${result.scanned} records. Exact counts and member pivots are unavailable. Narrow the scope or time range.</p>`:
   `<p role="status">Complete: ${result.totalRecords} retained records in ${result.totalClusters} patterns.</p>${result.cluster?`<h2>${escape(result.cluster.pattern.template)}</h2><p>${result.cluster.count} original records</p><ol>${result.records.map(row=>`<li><a href="${escape(row.pivot)}">Open original record ${escape(row.id)}</a><pre>${escape(JSON.stringify(row.payload,null,2))}</pre></li>`).join('')}</ol>`:`<ul>${result.clusters.map(group=>`<li><h2>${escape(group.pattern.template)}</h2><p>${escape(group.pattern.service)} · ${escape(group.pattern.environment)} · ${escape(group.pattern.team)} · ${escape(group.pattern.severity)}</p><p>${group.count} original records · <a href="${link({cluster:group.id})}">View members</a></p></li>`).join('')}</ul>`}${result.cursor?`<p><a href="${link({cluster:result.cluster?.id??null,cursor:result.cursor})}">Next page</a></p>`:''}`
  const view=await document('Log patterns',`<p><a href="${page}">New pattern search</a> · <a href="/app/explore">Explore telemetry</a></p><p>Completion watermark: ${result.snapshot}</p>${body}`,200,{forms:true})
  view.headers.set('x-porthole-actor',actorRef);view.headers.set('x-porthole-actor-revision',String(actorRevision));return view
 }catch(error){
  const known=error instanceof AuthError||error instanceof CredentialLimit,code=known?error.code:'clusters_unavailable',status=known?error.status:503
  const diagnostic=error instanceof ExplorationError?{field:error.field,hint:error.hint}:{}
  return browser?document('Log patterns unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}${diagnostic.hint?': '+escape(diagnostic.hint):''}</p><p><a href="${page}">New pattern search</a></p>`,status,{forms:true}):Response.json({error:code,...diagnostic},{status,headers:{...privateHeaders,...(error instanceof CredentialLimit?{'retry-after':String(error.retryAfter)}:{})}})
 }
}
