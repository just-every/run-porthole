import { fail } from '../../security/authority'
import { canonical, object } from '../../ingest/model'
import {field,predicate,type Predicate} from './fields'
import {costModel,type CostModel} from './cost'
export interface Definition { name:string; service:string; environment:string; team:string; spanName:string; kind:'counter'|'sum'|'distribution'; value:string; unit:string; dimensions:{key:string;values:string[]}[]; upstream:'complete'|'sampled'|'unknown'; inputStage:'accepted'|'pre-sampling'; status:'any'|'error'; predicate?:Predicate; costModel?:CostModel }
const label=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(v)?v:fail('invalid_rule',400)
export function definition(value:unknown):Definition {
 const d=object(value)
 if(Object.keys(d).some(k=>!['name','service','environment','team','spanName','kind','value','unit','dimensions','upstream','inputStage','status','predicate','costModel'].includes(k)))fail('invalid_rule',400)
 if(d.inputStage!==undefined&&!['accepted','pre-sampling'].includes(String(d.inputStage))||d.status!==undefined&&!['any','error'].includes(String(d.status)))fail('invalid_rule',400)
 const kind=d.kind
 if(!['counter','sum','distribution'].includes(String(kind)))fail('invalid_metric_kind',400)
 const dimensions=d.dimensions
 if(!Array.isArray(dimensions)||dimensions.length>3)fail('group_by_refused',422)
 let cardinality=1
 const seen=new Set<string>()
 const groups=dimensions.map(raw=>{
  const item=object(raw),key=field(item.key)
  if(Object.keys(item).some(k=>!['key','values'].includes(k))||seen.has(key))fail('group_by_refused',422)
  seen.add(key)
  if(!Array.isArray(item.values)||!item.values.length||item.values.length>20)fail('cardinality_refused',422)
  const values=item.values.map(label)
  if(new Set(values).size!==values.length)fail('invalid_rule',400)
  cardinality*=values.length+1
  return {key,values:values.sort()}
 }).sort((a,b)=>a.key.localeCompare(b.key))
 if(cardinality>100)fail('cardinality_refused',422)
 const attribute=kind==='counter'?'count':field(d.value)
 if(!['complete','sampled','unknown'].includes(String(d.upstream)))fail('input_completeness_required',400)
 return {...(d.predicate===undefined?{}:{predicate:predicate(d.predicate)}),...(d.costModel===undefined?{}:{costModel:costModel(d.costModel)}),inputStage:d.inputStage==='pre-sampling'?'pre-sampling':'accepted',status:d.status==='error'?'error':'any',name:label(d.name),service:label(d.service),environment:label(d.environment),team:label(d.team),spanName:d.spanName===undefined?'*':typeof d.spanName==='string'&&d.spanName.length>0&&d.spanName.length<=120&&!/[\x00-\x1f\x7f]/.test(d.spanName)?d.spanName:fail('invalid_span_name',400),kind:kind as Definition['kind'],value:attribute,unit:label(d.unit),dimensions:groups,upstream:d.upstream as Definition['upstream']}
}
export const scope=(d:Definition)=>({services:[d.service],environments:[d.environment],teams:[d.team]})
export const encoded=(d:Definition)=>canonical(d)
