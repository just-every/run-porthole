import type {Bindings} from '../../auth.server'
import {operationDocument as document,escape} from '../document'
import {input,text} from '../security/input'
import {fail} from '../security/authority'
import {migrationErasureResponse} from './erasure/http'

type SourceRecord={targetKind:string;targetId:string;revision:string;value:{definition:{name?:string;id?:string}}}
const hidden=(name:string,value:string)=>`<input type="hidden" name="${name}" value="${escape(value)}">`
export function importErasureForm(records:SourceRecord[]){
 if(!records.length)return ''
 return `<details><summary>Erase imported evidence</summary><p>Review permanent local erasure of one imported record and its retained source copies. This also withdraws original import bundles, opaque saved source files, restored source-history units and frozen product archives. Unrelated native records remain. Source vendors and downloaded copies are untouched.</p><form method="post" action="/app/import/erasure"><label>Imported record<select name="targetRef">${records.map(row=>`<option value="${escape(JSON.stringify([row.targetKind,row.targetId,row.revision]))}">${escape(row.value.definition.name??row.value.definition.id??row.targetId)} · ${escape(row.targetKind)}</option>`).join('')}</select></label><button>Review import erasure</button></form></details>`
}
export async function importErasurePage(request:Request,env:Bindings,apply:boolean){
 const data=await input(request)
 if(Object.keys(data).some(key=>!['targetRef','digest','confirm'].includes(key)))fail('invalid_import_erasure_request',400)
 let ref:unknown;try{ref=JSON.parse(text(data.targetRef,1500))}catch{fail('invalid_source_reference',400)}
 if(!Array.isArray(ref)||ref.length!==3||ref.some(value=>typeof value!=='string'))fail('invalid_source_reference',400)
 const selection={kind:ref[0],id:ref[1],revision:ref[2]},headers=new Headers(request.headers)
 headers.set('content-type','application/json');headers.delete('content-length')
 const response=await migrationErasureResponse(new Request(env.AUTH_ORIGIN+'/api/porthole/v1/migration/erasure'+(apply?'/apply':''),{method:'POST',headers,body:JSON.stringify({...selection,...apply?{digest:data.digest,confirm:data.confirm}:{}})}),env)
 if(!response)throw Error('import_erasure_handler_missing')
 const result=await response.json() as Record<string,unknown>
 if(!response.ok)return document('Import erasure unavailable',`<p role="alert">${escape(String(result.error).replaceAll('_',' '))}</p><p><a href="/app/import">Return to Move in</a></p>`,response.status)
 if(apply)return document('Import erasure completed',`<p role="status">The reviewed imported record and its source copies were erased locally. Unrelated native records and review edits remain.</p><p>Keep the later erasure journal with every downloaded archive. Older archives that lack this checkpoint are refused whole.</p><p><a href="/api/porthole/v1/migration/erasure/journal" download="porthole-import-erasure.json">Download later erasure journal</a></p><details><summary>Erasure receipt</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details><p><a href="/app/import">Return to Move in</a></p>`)
 const stores=result.custodyReviewed as {rows:number;bytes:number}[],units=result.withdrawnInactiveUnits as unknown[],limitations=result.limitations as string[]
 return document('Review import erasure',`<p>Permanently erase <strong>${escape(selection.id)}</strong>. Review the complete custody inventory before confirming. A changed inventory requires a new review.</p><p>Custody reviewed: <strong>${stores.reduce((total,row)=>total+row.rows,0)} rows · ${stores.reduce((total,row)=>total+row.bytes,0).toLocaleString('en-US')} bytes</strong></p><p>Inactive source-history units withdrawn whole: <strong>${units.length}</strong></p><ul>${limitations.map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul><details><summary>Exact custody inventory</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details><form method="post" action="/app/import/erasure/apply">${hidden('targetRef',JSON.stringify(ref))}${hidden('digest',String(result.digest))}<label><input type="checkbox" required name="confirm" value="erase-exact-import-target"> Permanently erase this imported record and withdraw the listed source history</label><button>Erase reviewed import</button></form><p><a href="/app/import">Keep imported evidence</a></p>`,200,{forms:true})
}
