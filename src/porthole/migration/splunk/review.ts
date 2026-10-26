import {compileSignalFlow,SignalFlowUnsupported} from './signalflow/compile'
import type {Json} from '../../../modules/import-kit/src/types.ts'
type ObjectValue = {[key:string]:Json}
const object=(value:Json|undefined):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value)
type Issue={field:string;reason:string}
type Construct={kind:string;text:string;offset:number}
type Expression={field:string;dialect:string;text:string;constructs:Construct[];resolution:string;sampleAnalysis?:Json}
/** Inventory only: no syntax here is declared translated or executable. */
function constructs(text:string):Construct[]{
 const values:Construct[]=[]
 const tokens=/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w.$]*|(?:\d+(?:\.\d+)?)|\s+|[^\s]/g
 for(const token of text.matchAll(tokens)){
  const word=token[0];if(/^\s|^#/.test(word))continue
  const tail=text.slice(token.index!+word.length)
  const kind=/^["']/.test(word)?'literal':/^[\d]/.test(word)?'number':/^[\w$]/.test(word)?(/^\s*\(/.test(tail)?'call':'identifier'):'syntax'
  values.push({kind,text:word,offset:token.index!})
 }
 return values
}
function expressions(value:Json|undefined,path:string,kind:string,out:Expression[]){
 if(Array.isArray(value))value.forEach((item,index)=>expressions(item,`${path}[${index}]`,kind,out))
 else if(object(value))for(const [key,child]of Object.entries(value)){
  const field=path?`${path}.${key}`:key
  if(typeof child==='string'&&['programText','query','queryText','search','spl'].includes(key)&&child.trim()){
   let sampleAnalysis:Json|undefined
   if(key==='programText'){try{sampleAnalysis={state:'available',plan:compileSignalFlow(child)}}catch(error){if(!(error instanceof SignalFlowUnsupported))throw error;sampleAnalysis={state:'unsupported',offset:error.offset,construct:error.construct}}}
   out.push({field,...(sampleAnalysis?{sampleAnalysis}:{}),dialect:key==='programText'?'SignalFlow':kind==='logSearches'?'SPL':'unqualified source query',text:child,constructs:constructs(child),resolution:'Human source parity review required; retained-sample analysis does not qualify source execution'})
  }else expressions(child,field,kind,out)
 }
}
export function splunkReview(kind:string,value:Json|undefined):Json{
 const issues:Issue[]=[],queries:Expression[]=[]
 const issue=(field:string,reason:string)=>issues.push({field,reason})
 const source=object(value)?value:{}
 if(['charts','dashboards','detectors'].includes(kind)){
  for(const key of ['id','name'])if(typeof source[key]!=='string'||!source[key])issue(key,'Official resource requires a nonempty string')
  if(kind==='charts'||kind==='detectors'){
   if(typeof source.programText!=='string'||!source.programText.trim())issue('programText','Full detail required; list metadata alone cannot qualify a program')
  }
  if(kind==='detectors'){
   if(!Array.isArray(source.rules))issue('rules','Official detector rule array required')
   else source.rules.forEach((rule,index)=>{
    if(!object(rule)||typeof rule.detectLabel!=='string'||!['Critical','Major','Minor','Warning','Info'].includes(String(rule.severity)))issue(`rules[${index}]`,'Rule needs a detect label and an official severity')
    if(object(rule)&&rule.notifications!==undefined)issue(`rules[${index}].notifications`,'Review each destination before any routing; no notification is activated')
   })
  }
  if(kind==='dashboards'){
   if(!Array.isArray(source.charts))issue('charts','Official dashboard placement array required')
   else source.charts.forEach((chart,index)=>{
    if(!object(chart)||typeof chart.chartId!=='string'||!['column','row','width','height'].every(key=>Number.isInteger(chart[key])))issue(`charts[${index}]`,'Chart placement needs chartId and integer column, row, width and height')
   })
   if(object(source.filters)&&Array.isArray(source.filters.variables))issue('filters.variables','Retained dashboard variables need native binding qualification')
  }
 }else issue('definition','Source evidence retained; this collection has no qualified official resource schema yet')
 expressions(value,'',kind,queries)
 return {schema:['charts','dashboards','detectors'].includes(kind)?'Splunk Observability v2 resource subset':'unqualified source evidence',issues,expressions:queries,cutover:'blocked'}
}
export function splunkUnmapped(payload:Json):{field?:string;reason:string}[]{
 if(!object(payload)||!object(payload.review))return []
 const review=payload.review
 const issues=Array.isArray(review.issues)?review.issues:[]
 const queries=Array.isArray(review.expressions)?review.expressions:[]
 return [
  ...issues.filter(object).map(item=>({field:String(item.field),reason:String(item.reason)})),
  ...queries.filter(object).flatMap(query=>[
   {field:String(query.field),reason:`${object(query.sampleAnalysis)&&query.sampleAnalysis.state==='available'?'Unqualified source parity for':'Untranslated'} ${query.dialect} expression; explicit human resolution required: ${query.text}`},
   ...(Array.isArray(query.constructs)?query.constructs:[]).filter(object).map(node=>({field:`${query.field}@${node.offset}`,reason:`Unqualified ${query.dialect} ${node.kind}: ${node.text}; retain source dependency`}))
  ])
 ]
}
