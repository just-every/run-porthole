import {fail,parseScope} from '../security/authority'
import {timestamp} from '../dashboards/model'

export interface PublicPanel {id:string;label:string;value:number|null;state:'empty'|'complete'|'partial'|'stale'|'error';unit:string}
export interface Projection {version:1;title:string;range:{from:string;through:string};panels:PublicPanel[]}
export interface PublicationRow {
 id:string;dashboard_id:string;source_revision:number;owner_id:string;owner_revision:number;operator_version:number;
 projection:string;source_review:string;allowed_origins:string;expires_at:number;digest:string;
 state:'draft'|'published'|'revoked'|'quarantined';revision:number;created_at:number;updated_at:number;approved_at:number|null;revoked_at:number|null
}
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const safeText=(v:string)=>!/[\u0000-\u001f\u007f]/.test(v)&&!/(?:https?\s*:\s*\/\/|\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:|\b(?:bearer|basic)\s+\S+|\b(?:access_token|api_key|token|secret|credential)\s*=)/i.test(v)
export const publicText=(v:unknown,max=120):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&safeText(v)
export function validProjection(v:unknown):v is Projection {
 if(!object(v)||!exact(v,['version','title','range','panels'])||v.version!==1||!publicText(v.title)||!object(v.range)||!exact(v.range,['from','through'])||!Array.isArray(v.panels)||v.panels.length<1||v.panels.length>30)return false
 try{if(BigInt(timestamp(v.range.from))>BigInt(timestamp(v.range.through)))return false}catch{return false}
 const ids=new Set<string>()
 return v.panels.every(p=>{
  if(!object(p)||!exact(p,['id','label','value','state','unit'])||!uuid(p.id)||ids.has(p.id)||!publicText(p.label)||typeof p.unit!=='string'||p.unit.length>32||!safeText(p.unit)||!(p.value===null||typeof p.value==='number'&&Number.isFinite(p.value))||typeof p.state!=='string'||!['empty','complete','partial','stale','error'].includes(p.state))return false
  ids.add(p.id);return !['empty','partial','error'].includes(String(p.state))||p.value===null
 })
}
export function allowedOrigins(raw:unknown):string[] {
 const values=typeof raw==='string'?JSON.parse(raw):raw
 if(!Array.isArray(values)||values.length>20||values.some(v=>typeof v!=='string'))fail('invalid_public_origins',400)
 const origins=values.map(value=>{
  let u:URL;try{u=new URL(value)}catch{return fail('invalid_public_origins',400)}
  if(u.origin!==value||u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))fail('invalid_public_origins',400)
  return u.origin
 })
 if(new Set(origins).size!==origins.length)fail('invalid_public_origins',400)
 return origins
}
export function validateRow(v:Record<string,unknown>):boolean {
 try {
  if(!exact(v,['id','dashboard_id','source_revision','owner_id','owner_revision','operator_version','projection','source_review','allowed_origins','expires_at','digest','state','revision','created_at','updated_at','approved_at','revoked_at']))return false
  if(![v.id,v.dashboard_id,v.owner_id].every(uuid)||![v.source_revision,v.owner_revision,v.operator_version,v.revision].every(n=>Number.isSafeInteger(n)&&Number(n)>0)||![v.expires_at,v.created_at,v.updated_at].every(n=>Number.isSafeInteger(n)&&Number(n)>=0)||![v.approved_at,v.revoked_at].every(n=>n===null||Number.isSafeInteger(n)&&Number(n)>=0))return false
  if(typeof v.projection!=='string'||!validProjection(JSON.parse(v.projection))||typeof v.allowed_origins!=='string'||typeof v.source_review!=='string'||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest)||typeof v.state!=='string'||!['draft','published','revoked','quarantined'].includes(v.state))return false
  if(Number(v.updated_at)<Number(v.created_at)||Number(v.expires_at)<=Number(v.created_at)||v.state==='published'&&(v.approved_at===null||v.revoked_at!==null)||v.state==='draft'&&(v.approved_at!==null||v.revoked_at!==null)||v.state==='revoked'&&v.revoked_at===null)return false
  allowedOrigins(v.allowed_origins)
  const source=JSON.parse(v.source_review)
  if(!object(source)||!exact(source,['panels','filters'])||!Array.isArray(source.panels)||!object(source.filters)||!exact(source.filters,['team','environment','from','through','scope']))return false
  const projection=JSON.parse(v.projection) as Projection
  if(source.panels.length!==projection.panels.length||source.filters.from!==projection.range.from||source.filters.through!==projection.range.through||!publicText(source.filters.team)||!publicText(source.filters.environment))return false
  parseScope(source.filters.scope)
  const ids=new Set<string>()
  return source.panels.every((panel:unknown,index:number)=>{
   if(!object(panel)||!exact(panel,['sourcePanel','publicPanel','query','queryRef'])||!publicText(panel.sourcePanel)||ids.has(panel.sourcePanel)||panel.publicPanel!==projection.panels[index].id||typeof panel.query!=='string'||panel.query.length>4000||!panel.query.startsWith('/app/explore?')||!(panel.queryRef===null||uuid(panel.queryRef)))return false
   ids.add(panel.sourcePanel);return true
  })
 }catch{return false}
}
