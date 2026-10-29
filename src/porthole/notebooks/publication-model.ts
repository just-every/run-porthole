import {fail} from '../security/authority'
import {publicText} from '../publication/model'
import {uuid} from '../portability/format-id'
import {integer,object} from './model'

export interface PublicCell {id:string;kind:'query'|'chart';label:string;unit:string;from:string;through:string;count:number;value:number|null;points:{timeNs:string;value:number}[]}
export interface PublicNotebook {version:1;title:string;summary:string;cells:PublicCell[]}
export interface NotebookPublication {
 id:string;notebook_id:string;source_revision:number;owner_ref:string;owner_revision:number;operator_version:number;
 projection:string;source_review:string;expires_at:number;digest:string;state:'draft'|'published'|'revoked'|'quarantined';
 revision:number;created_at:number;updated_at:number;approved_at:number|null;revoked_at:number|null
}
export const publicationColumns=['id','notebook_id','source_revision','owner_ref','owner_revision','operator_version','projection','source_review','expires_at','digest','state','revision','created_at','updated_at','approved_at','revoked_at']
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const bound=(v:unknown):v is string=>typeof v==='string'&&/^\d{20}$/.test(v)&&BigInt(v)<=18446744073709551615n
export const publicUnit=(v:unknown):v is string=>v===''||publicText(v,32)
export function publicNotebook(value:unknown):PublicNotebook {
 const v=object(value)
 if(!exact(v,['version','title','summary','cells'])||v.version!==1||!publicText(v.title)||!publicText(v.summary,2000)||!Array.isArray(v.cells)||!v.cells.length||v.cells.length>30)fail('invalid_public_notebook',400)
 const ids=new Set<string>()
 for(const raw of v.cells) {
  const c=object(raw)
  if(!exact(c,['id','kind','label','unit','from','through','count','value','points'])||!uuid(c.id)||ids.has(c.id)||!['query','chart'].includes(String(c.kind))||!publicText(c.label)||!publicUnit(c.unit)||!bound(c.from)||!bound(c.through)||c.from>c.through||!integer(c.count)||c.count>2000||c.value!==null&&(typeof c.value!=='number'||!Number.isFinite(c.value))||!Array.isArray(c.points)||c.points.length>2000)fail('invalid_public_notebook',400)
  for(const rawPoint of c.points) {
   const p=object(rawPoint)
   if(!exact(p,['timeNs','value'])||!bound(p.timeNs)||p.timeNs<c.from||p.timeNs>c.through||typeof p.value!=='number'||!Number.isFinite(p.value))fail('invalid_public_notebook',400)
  }
  ids.add(c.id)
 }
 return v as unknown as PublicNotebook
}
export function publicationRow(v:Record<string,unknown>) {
 if(!exact(v,publicationColumns)||![v.id,v.notebook_id,v.owner_ref].every(uuid)||![v.source_revision,v.owner_revision,v.operator_version,v.revision].every(n=>integer(n,1))||![v.expires_at,v.created_at,v.updated_at].every(n=>integer(n))||![v.approved_at,v.revoked_at].every(n=>n===null||integer(n))||!['draft','published','revoked','quarantined'].includes(String(v.state))||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest))fail('invalid_notebook_publication',400)
 if(Number(v.expires_at)<=Number(v.created_at)||Number(v.updated_at)<Number(v.created_at)||v.state==='published'&&(v.approved_at===null||v.revoked_at!==null)||v.state==='draft'&&(v.approved_at!==null||v.revoked_at!==null)||v.state==='revoked'&&v.revoked_at===null)fail('invalid_notebook_publication',400)
 const projection=publicNotebook(JSON.parse(String(v.projection))),review=object(JSON.parse(String(v.source_review)))
 if(!exact(review,['cells','recordIds'])||!Array.isArray(review.cells)||review.cells.length!==projection.cells.length||review.cells.some(c=>typeof c!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(c))||new Set(review.cells).size!==review.cells.length||!Array.isArray(review.recordIds)||review.recordIds.length>60000||review.recordIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}:\d+$/.test(id))||new Set(review.recordIds).size!==review.recordIds.length)fail('invalid_notebook_publication',400)
}
