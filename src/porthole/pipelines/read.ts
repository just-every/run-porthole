import type { Bindings } from '../../auth.server'
import { canonical } from '../ingest/model'
import { authority, fail, scopeWithin, type Authority } from '../security/authority'
import { definition, pipelineScope } from './model'
import type { Version } from './intake'

const encoder=new TextEncoder()
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0
interface Position { version:1; actor:string; revision:number; snapshot:number; before:number; limit:number }
async function key(env:Bindings) {
 return crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])
}
async function cursorFor(env:Bindings,position:Position) {
 const body=btoa(canonical(position)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',await key(env),encoder.encode('porthole.pipeline-history.v1:'+body)))
 return body+'.'+Array.from(signature,byte=>byte.toString(16).padStart(2,'0')).join('')
}
async function positionFor(env:Bindings,actor:Authority,cursor:string,limit:number):Promise<Position> {
 try {
  if(cursor.length>2048||!/^[-_A-Za-z0-9]+\.[a-f0-9]{64}$/.test(cursor))throw Error()
  const [body,signature]=cursor.split('.')
  const bytes=Uint8Array.from(signature.match(/../g)!,value=>parseInt(value,16))
  if(!await crypto.subtle.verify('HMAC',await key(env),bytes,encoder.encode('porthole.pipeline-history.v1:'+body)))throw Error()
  const value=JSON.parse(atob(body.replaceAll('-','+').replaceAll('_','/'))) as Position
  if(value.version!==1||value.actor!==actor.member.operatorId||value.revision!==actor.member.revision||value.limit!==limit||!integer(value.snapshot)||!integer(value.before)||value.before<1||value.before>value.snapshot)throw Error()
  return value
 }catch{return fail('invalid_pipeline_cursor',400)}
}
export function readOptions(params:URLSearchParams) {
 for(const name of params.keys())if(!['limit','cursor'].includes(name)||params.getAll(name).length!==1)fail('invalid_query',400)
 const raw=params.get('limit')??'50',limit=Number(raw)
 if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(limit)||limit>200)fail('invalid_pipeline_limit',400)
 if(params.has('cursor')&&!params.get('cursor'))fail('invalid_pipeline_cursor',400)
 return {limit,cursor:params.get('cursor')}
}
export async function pipelineHistory(env:Bindings,actor:Authority,options:{limit:number;cursor:string|null},snapshot:number) {
 const position=options.cursor?await positionFor(env,actor,options.cursor,options.limit):null
 const watermark=position?.snapshot??snapshot
 const parts=['revision<=?'],args:unknown[]=[watermark]
 if(position){parts.push('revision<?');args.push(position.before)}
 // Apply scope before LIMIT so a foreign revision cannot hide a later visible row.
 for(const [plural,singular] of [['services','service'],['environments','environment'],['teams','team']] as const) {
  parts.push(`EXISTS(SELECT 1 FROM json_each(?) granted WHERE granted.value='*' OR granted.value=json_extract(definition,'$.${singular}'))`)
  args.push(JSON.stringify(actor.member.scope[plural]))
 }
 const rows=(await env.DB.prepare(`SELECT * FROM porthole_pipeline_versions WHERE ${parts.join(' AND ')} AND ${actor.fence} ORDER BY revision DESC LIMIT ?`).bind(...args,...actor.args,options.limit+1).all<Version>()).results
 const history=rows.slice(0,options.limit).map(versionView)
 if(history.some(row=>!scopeWithin(pipelineScope(definition(row.definition)),actor.member.scope)))fail('authority_changed',409)
 const cursor=rows.length>options.limit?await cursorFor(env,{version:1,actor:actor.member.operatorId,revision:actor.member.revision,snapshot:watermark,before:history.at(-1)!.revision,limit:options.limit}):null
 return {history,snapshot:watermark,cursor}
}
export const versionView=(row:Version)=>({...row,definition:definition(JSON.parse(row.definition))})
export async function pipelineRevision(env:Bindings,actor:Authority,raw:string) {
 if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('invalid_pipeline_revision',400)
 const row=await env.DB.prepare(`SELECT * FROM porthole_pipeline_versions WHERE revision=? AND ${actor.fence}`).bind(Number(raw),...actor.args).first<Version>()
 if(!row)fail('pipeline_revision_not_found',404)
 const result=versionView(row)
 if(!scopeWithin(pipelineScope(result.definition),actor.member.scope))fail('pipeline_revision_not_found',404)
 return result
}
export async function checkPipelineReader(request:Request,env:Bindings,actor:Authority) {
 const live=await authority(request,env)
 if(live.session.kind!=='native'||live.member.role!=='owner')fail('owner_required')
 if(live.member.revision!==actor.member.revision)fail('authority_changed',409)
}
