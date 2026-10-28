import {ExplorationError} from '../explore/normalize'
import {LogSearchError} from '../../../workers/analytics/log-search.mjs'
import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {fail} from '../security/authority'
import {input} from '../security/input'
import {escape,operationDocument as document,privateHeaders} from '../document'
import {queryActor} from './access'
import {executeQuery,queryKeys,snapshotInput} from './execute'
import {discoverAttributes} from './discovery'
import {runResponse,runRoot} from './runs'
import {editor,results,runPage} from './page'
const root='/api/porthole/v1/query',uuid='[a-f0-9-]{36}'
export async function queryResponse(request:Request,env:Bindings):Promise<Response|null>{
 const url=new URL(request.url),page=url.pathname.startsWith('/app/explore'),path=page?url.pathname.replace('/app/explore',root):url.pathname
 if(path!==root&&!new RegExp(`^${root}/(?:history|schema|estimate|runs(?:/${uuid}(?:/(?:advance|cancel))?)?|${uuid}(?:/export)?)$`).test(path))return null
 try{
  if(page&&request.headers.has('authorization'))fail('native_session_required')
  const actor=await queryActor(request,env)
  if(path.startsWith(runRoot)){
   const internal=new Request(new URL(path+url.search,request.url),request)
   const response=await runResponse(internal,env)
   return page&&response.ok?runPage(await response.json()as Record<string,unknown>):response
  }
  if(path===root+'/history'){
   if(request.method!=='GET'||url.search)fail('invalid_query_history',400)
   const rows=(await env.DB.prepare(`SELECT id,signal,created_at,scope,from_ns,through_ns,through_batch FROM porthole_query_snapshots WHERE actor_ref=? AND ${actor.fence} ORDER BY created_at DESC,id DESC LIMIT 50`).bind(actor.id,...actor.args).all<{id:string;signal:string;created_at:number;scope:string;from_ns:string;through_ns:string;through_batch:number}>()).results
   const history=rows.map(row=>({id:row.id,signal:row.signal,createdAt:row.created_at,source:JSON.parse(row.scope),from:row.from_ns,through:row.through_ns,snapshot:row.through_batch,replay:root+'/'+row.id}))
   return page?document('Query history',`<p><a href="/app/explore">New query</a></p><p>Your latest 50 private snapshots. Replay uses retained data and current authority.</p><ul>${history.map(row=>`<li><a href="/app/explore?${escape(new URLSearchParams({...row.source,signal:row.signal,from:row.from,through:row.through,snapshot:String(row.snapshot)}).toString())}">${escape(row.signal)} · ${escape(new Date(row.createdAt).toISOString())}</a><pre>${escape(JSON.stringify(row.source,null,2))}</pre></li>`).join('')}</ul>`):Response.json({history},{headers:privateHeaders})
  }
  if(page&&request.method==='GET'&&path===root&&!url.search)return editor()
  const exported=path.endsWith('/export'),id=path.slice(root.length+1).split('/')[0]
  let data:Record<string,unknown>
  if(exported){
   if(!actor.canExport)fail('export_forbidden')
   if(request.method!=='GET'||[...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1)fail('invalid_query_export',400)
   data=await snapshotInput(env,id,actor.id);delete data.cursor
   if(url.searchParams.has('cursor'))data.cursor=url.searchParams.get('cursor')!
  }else if(request.method==='GET'&&new RegExp(`^${uuid}$`).test(id)){if(url.search)fail('invalid_query',400);data=await snapshotInput(env,id)}
  else if(page&&request.method==='GET'){if([...url.searchParams.keys()].some(key=>!queryKeys.includes(key)))fail('invalid_query',400);data=Object.fromEntries(url.searchParams)}
  else{if(request.method!=='POST'||url.search)fail('invalid_query',400);data=await input(request)}
  const intent=page?String(data.intent??'query'):path===root+'/schema'?'schema':path===root+'/estimate'?'estimate':'query'
  if(page)delete data.intent
  const timeoutMs=page?data.timeoutMs:undefined;if(page)delete data.timeoutMs
  if(intent==='prepare'){
   const scanLimit=data.scanLimit;delete data.scanLimit
   const headers=new Headers(request.headers);headers.set('content-type','application/json')
   const response=await runResponse(new Request(new URL(runRoot,request.url),{method:'POST',headers,body:JSON.stringify({query:data,...(scanLimit?{scanLimit:Number(scanLimit)}:{}),...(timeoutMs?{timeoutMs:Number(timeoutMs)}:{})})}),env)
   return response.ok?runPage(await response.json()as Record<string,unknown>):response
  }
  if(!['query','schema','estimate'].includes(intent))fail('invalid_query',400)
  if(intent==='schema')data={...data,limit:200,scanLimit:data.scanLimit||200}
  const response=await executeQuery(request,env,data,{exportOnly:exported,estimateOnly:intent==='estimate'})
  if(!response.ok){if(!page)return response;const error=await response.json()as {error:string;hint?:string};return document('Query unavailable',`<p role="alert">${escape(error.error)}${error.hint?': '+escape(error.hint):''}</p><p><a href="/app/explore">Return to Explore</a></p>`,response.status)}
  const result=await response.json()as Record<string,unknown>
  if(intent==='estimate')return page?document('Query estimate',`<p><a href="/app/explore">Return to Explore</a></p><p>Authorized candidate work before evaluating predicates. A capped measurement is a lower bound and does not claim complete results.</p><pre>${escape(JSON.stringify(result,null,2))}</pre>`):Response.json(result,{headers:response.headers})
  if(exported){
   const next=result.cursor?root+'/'+id+'/export?'+new URLSearchParams({cursor:String(result.cursor)}):null
   const metadata={type:'query',source:result.source,parameters:result.parameters,plan:result.plan,snapshot:result.snapshot,metricResult:result.metricResult,coverage:result.coverage??{state:next?'partial':'complete'},next}
   return new Response([JSON.stringify(metadata),...(result.records as unknown[]).map(record=>JSON.stringify({type:'record',record}))].join('\n')+'\n',{headers:{...privateHeaders,'content-type':'application/x-ndjson','content-disposition':'attachment; filename="porthole-query.ndjson"',...(next?{'x-porthole-next':next}:{}),'x-porthole-entity':String(result.queryRef)}})
  }
  if(intent==='schema'){
   const discovered={...discoverAttributes(result.records as Parameters<typeof discoverAttributes>[0]),snapshot:result.snapshot,from:result.from,through:result.through,cursor:result.cursor,coverage:result.coverage}
   return page?document('Observed attributes',`<p><a href="/app/explore">Return to Explore</a></p><p>Types observed in this authorized candidate page. Missing paths are not evidence of absence outside this page.</p><pre>${escape(JSON.stringify(discovered,null,2))}</pre>`):Response.json(discovered,{headers:privateHeaders})
  }
  if(!page)return Response.json(result,{headers:response.headers})
  const next=new URL('/app/explore',request.url)
  for(const [key,value]of Object.entries({...result.parameters as Record<string,unknown>,dialect:(result.source as {dialect:string}).dialect,expression:(result.source as {text:string}).text,snapshot:result.snapshot,cursor:result.cursor}))if(value!==null&&value!==undefined)next.searchParams.set(key,String(value))
  const view=await results(result,result.cursor?next.pathname+next.search:undefined,actor.canExport);view.headers.set('x-porthole-entity',String(result.queryRef));return view
 }catch(error){
  const known=error instanceof AuthError||error instanceof LogSearchError,code=known?error.code:'query_unavailable',status=known?error.status:503,detail=error instanceof ExplorationError||error instanceof LogSearchError?{field:error.field,hint:error.hint}:{}
  return page?document('Query unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}${'hint'in detail?': '+escape(String(detail.hint)):''}</p><p><a href="/app/explore">Return to Explore</a></p>`,status,{forms:true}):Response.json({error:code,...detail},{status,headers:privateHeaders})
 }
}
