import type {Bindings} from '../../auth.server'
import {operationDocument as document,escape} from '../document'
import {input,text} from '../security/input'
import {fail} from '../security/authority'
import {migrationLogSearch} from './splunk/spl/execute'

type SourceSearch={targetId:string;revision:string;value:{definition:{id:string;name?:string}}}
export function logSearchForm(records:SourceSearch[]){
 if(!records.length)return ''
 return `<details><summary>Map a linked log search</summary><p>Review one source index mapped to one exact native service, environment and team. Only literal scope predicates and terminal stats count are supported. Select a native event-time window in nanoseconds. Source absolute earliest and latest bounds must match it exactly; latest is exclusive. Relative times, unknown context and other commands remain source work. Native counts do not establish source parity.</p><form method="post" action="/app/import/log-search"><label>Source log search<select name="targetRef">${records.map(row=>`<option value="${escape(JSON.stringify([row.targetId,row.revision]))}">${escape(row.value.definition.name??row.value.definition.id)}</option>`).join('')}</select></label>${['index','service','environment','team','from','through'].map(key=>`<label>${key==='index'?'Source index':key==='from'?'From in nanoseconds':key==='through'?'Through in nanoseconds':key}<input required name="${key}"></label>`).join('')}<label><input type="checkbox" required name="confirm" value="reviewed"> I reviewed this exact source index and native scope mapping</label><button>Count mapped native logs</button></form></details>`
}
export async function logSearchPage(request:Request,env:Bindings){
 const data=await input(request)
 if(Object.keys(data).some(key=>!['targetRef','index','service','environment','team','from','through','confirm'].includes(key)))fail('invalid_log_search_input',400)
 if(data.confirm!=='reviewed')fail('review_confirmation_required',400)
 let ref:unknown;try{ref=JSON.parse(text(data.targetRef,1000))}catch{fail('invalid_source_reference',400)}
 if(!Array.isArray(ref)||ref.length!==2||ref.some(value=>typeof value!=='string'))fail('invalid_source_reference',400)
 const headers=new Headers(request.headers);headers.set('content-type','application/json');headers.delete('content-length')
 const response=await migrationLogSearch(new Request(request.url,{method:'POST',headers,body:JSON.stringify({targetId:ref[0],targetRevision:ref[1],mapping:Object.fromEntries(['index','service','environment','team'].map(key=>[key,data[key]])),from:data.from,through:data.through})}),env)
 const result=await response.json() as Record<string,unknown>
 if(!response.ok)return document('Log search unavailable',`<p role="alert">${escape(String(result.detail??result.error).replaceAll('_',' '))}</p>${result.construct?`<p>Untranslated source construct: <code>${escape(String(result.construct))}</code></p>`:''}<p><a href="/app/import">Return to Move in</a></p>`,response.status)
 const rows=result.rows as Record<string,string|number>[],columns=rows.length?Object.keys(rows[0]):[]
 return document('Mapped native log count',`<p>Complete selected native window: ${escape(String(result.selectedRecords))} observations. This result uses your explicit source index mapping and current native owner authority. No source result capture has been compared. Source parity and cutover remain unqualified.</p>${rows.length?`<table class="porthole-observation-table"><thead><tr>${columns.map(key=>`<th>${escape(key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(key=>`<td>${escape(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p>No native observations in this window. Source completeness is unknown.</p>'}<details><summary>Exact search and mapping</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details><p>No monitor is activated and no notification is sent.</p><p><a href="/app/import">Return to Move in</a></p>`)
}
