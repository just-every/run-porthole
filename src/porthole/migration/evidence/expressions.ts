import {removeCredentials} from '../../../modules/import-kit/src/provenance/credentials.ts'
import {compileSignalFlow,SignalFlowUnsupported} from '../splunk/signalflow/compile'
import type {Json} from '../../../modules/import-kit/src/types.ts'
type ObjectValue = {[key:string]:Json}
const object=(value:Json|undefined):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value)
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
  if(typeof child==='string'&&['programText','query','queryText','search','spl','expression','expr','sql','promql','promQL'].includes(key)&&child.trim()){
   let sampleAnalysis:Json|undefined
   if(key==='programText'){try{sampleAnalysis={state:'available',plan:compileSignalFlow(child)}}catch(error){if(!(error instanceof SignalFlowUnsupported))throw error;sampleAnalysis={state:'unsupported',offset:error.offset,construct:error.construct}}}
   out.push({field,...(sampleAnalysis?{sampleAnalysis}:{}),dialect:key==='programText'?'SignalFlow':kind==='logSearches'?'SPL':'unqualified source query',text:child,constructs:constructs(child),resolution:'Human source parity review required; retained-sample analysis does not qualify source execution'})
  }else if(['query','queries','querySpec','builderQuery'].includes(key)&&child!==null&&typeof child==='object'){const text=JSON.stringify(child);out.push({field,dialect:'unqualified structured source query',text,constructs:constructs(text),resolution:'Human source parity review required; structured source query remains inactive'})}else expressions(child,field,kind,out)
 }
}
export function expressionInventory(value:Json|undefined,kind:string):Json[]{const out:Expression[]=[];expressions(removeCredentials(value??null).value,'',kind,out);return out.map(value=>({...value,constructs:value.constructs.map(node=>({...node}))}))}
