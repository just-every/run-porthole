import {expressionInventory} from '../evidence/expressions'
import type {Json} from '../../../modules/import-kit/src/types.ts'
type ObjectValue = {[key:string]:Json}
const object=(value:Json|undefined):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value)
type Issue={field:string;reason:string}
export function splunkReview(kind:string,value:Json|undefined):Json{
 const issues:Issue[]=[],queries=expressionInventory(value,kind)
 const issue=(field:string,reason:string)=>issues.push({field,reason})
 const source=object(value)?value:{}
 if(['charts','dashboards','detectors','slos'].includes(kind)){
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
  if(kind==='slos'){
   if(source.type!=='RequestBased')issue('type','Only the documented RequestBased source resource is recognized; retain other types for source qualification')
   if(!object(source.inputs))issue('inputs','Official SLO inputs object required for definition review')
   else for(const key of ['programText','goodEventsLabel','totalEventsLabel'])if(typeof source.inputs[key]!=='string'||!String(source.inputs[key]).trim())issue('inputs.'+key,'Official SLO input requires a nonempty string')
   if(source.metadata!==undefined&&(!Array.isArray(source.metadata)||source.metadata.some(item=>typeof item!=='string')))issue('metadata','Official SLO metadata is an array of strings')
   if(!Array.isArray(source.targets)||source.targets.length!==1)issue('targets','Official source response specifies one SLO target')
   else source.targets.forEach((target,index)=>{
    if(!object(target)){issue(`targets[${index}]`,'Official SLO target object required');return}
    if(typeof target.compliancePeriod!=='string'||!target.compliancePeriod.trim())issue(`targets[${index}].compliancePeriod`,'Retain the exact source compliance period')
    if(typeof target.slo!=='number'||!Number.isFinite(target.slo)||target.slo<=0||target.slo>=100)issue(`targets[${index}].slo`,'Official SLO percentage must be strictly between zero and one hundred')
    if(!['RollingWindow','CalendarWindow'].includes(String(target.type)))issue(`targets[${index}].type`,'Source window policy requires explicit qualification')
    if(!Array.isArray(target.sloAlertRules))issue(`targets[${index}].sloAlertRules`,'Official SLO alert rule array required')
    else target.sloAlertRules.forEach((group,g)=>{
     if(!object(group)||!['BREACH','ERROR_BUDGET_LEFT','BURN_RATE'].includes(String(group.type))||!Array.isArray(group.rules)){issue(`targets[${index}].sloAlertRules[${g}]`,'Unqualified source alert rule group');return}
     group.rules.forEach((rule,n)=>{if(!object(rule)||!['Critical','Major','Minor','Warning','Info'].includes(String(rule.severity)))issue(`targets[${index}].sloAlertRules[${g}].rules[${n}]`,'Official source alert severity required')})
    })
    issue(`targets[${index}]`,'Source SLO evaluation and alert routing remain inactive. Official response schema and example disagree about cycle fields; preserve the exact source policy for review')
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
 return {schema:['charts','dashboards','detectors','slos'].includes(kind)?'Splunk Observability v2 resource subset':'unqualified source evidence',issues,expressions:queries,cutover:'blocked'}
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
