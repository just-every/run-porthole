import {expressionInventory} from '../evidence/expressions'
import type {Json} from '../../../modules/import-kit/src/types.ts'
import {readSourceStream} from './stream/index'
import {readSplunkHistory,splunkHistoryLimits} from './history'
type ObjectValue = {[key:string]:Json}
const object=(value:Json|undefined):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value)
type Issue={field:string;reason:string}
export function splunkReview(kind:string,value:Json|undefined,topology?:Json):Json{
 const issues:Issue[]=[],queries=expressionInventory(value,kind)
 const issue=(field:string,reason:string)=>issues.push({field,reason})
 const source=object(value)?value:{}
 for(const field of ['created','lastUpdated'])if(source[field]!==undefined&&(!Number.isSafeInteger(source[field])||Number(source[field])<0))issue(field,'Original source timestamp must remain an exact nonnegative millisecond integer')
 if(source.tags!==undefined&&(!Array.isArray(source.tags)||source.tags.some(tag=>typeof tag!=='string')))issue('tags','Source tags must remain the original array of strings')
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
 }else if(kind==='services'){
  if(typeof source.serviceName!=='string'||!source.serviceName)issue('serviceName','Official APM topology node requires a serviceName')
  if(typeof source.inferred!=='boolean')issue('inferred','Preserve whether the official APM node was inferred')
  if(!['service','database','pubsub'].includes(String(source.type)))issue('type','Official APM topology node type must be service, database or pubsub')
  if(object(topology)){
   const nodes=Array.isArray(topology.nodes)?topology.nodes:[],edges=Array.isArray(topology.edges)?topology.edges:[]
   const names=nodes.filter(object).map(node=>node.serviceName)
   if(new Set(names).size!==names.length)issue('sourceTopology.nodes','Duplicate service identities prevent complete topology qualification')
   edges.forEach((edge,index)=>{if(!object(edge)||typeof edge.fromNode!=='string'||typeof edge.toNode!=='string'||!names.includes(edge.fromNode)||!names.includes(edge.toNode))issue(`sourceTopology.edges[${index}]`,'Unresolved APM topology edge; retain both original endpoint identities')})
   for(const key of Object.keys(topology))if(!['nodes','edges'].includes(key))issue('sourceTopology.'+key,'Unqualified topology response metadata; review possible provider limits')
  }
  issue('sourceTopology','Service nodes and directed edges are retained source evidence. Preserve the authorized POST topology request timeRange and tagFilters separately; a service node does not export all APM configuration or historical traces')
 }else if(kind==='rum'){
  if(typeof source.applicationName!=='string'||!source.applicationName)issue('applicationName','Browser initialization evidence requires its explicit applicationName')
  if(typeof source.realm!=='string'&&typeof source.beaconEndpoint!=='string')issue('realm','Retain the original realm or explicit beaconEndpoint from browser setup')
  for(const key of ['applicationName','realm','beaconEndpoint','cookieDomain','deploymentEnvironment','version'])if(source[key]!==undefined&&typeof source[key]!=='string')issue(key,'Documented browser initialization setting must be a string')
  for(const key of ['debug','disableAutomationFrameworks','disableBots'])if(source[key]!==undefined&&typeof source[key]!=='boolean')issue(key,'Documented browser initialization setting must be boolean')
  for(const key of ['globalAttributes','instrumentations','privacy','tracer','user','context','exporter'])if(source[key]!==undefined&&!object(source[key]))issue(key,'Documented browser initialization setting requires an object; executable callbacks are not a JSON export')
  if(source.tracer!==undefined||source.exporter!==undefined||source.ignoreUrls!==undefined)issue('configuration','Sampler instances, callbacks and regular expressions require the original reviewed application configuration; JSON cannot establish their runtime meaning')
  issue('definition','Browser initialization settings are retained from an authorized application export, with credentials removed. This is not a RUM account export API; mobile setup, URL grouping, sessions, retention and native collection remain separate source work')
 }else if(kind==='sourceStreams'){
  const checked=readSourceStream(source)
  if(!checked.ok)issue('capture',checked.reason)
  issue('comparison','Retained finite source stream only. Source incident identities remain source evidence; no native notification, prior state or full lifecycle parity is inferred')
 }else if(kind==='history'&&source.source==='splunk-timeserieswindow'){
  const checked=readSplunkHistory(source)
  if(!checked.ok)issue('response',checked.reason)
  splunkHistoryLimits.forEach(reason=>issue('history',reason))
 }else issue('definition','Source evidence retained; this collection has no qualified official resource schema yet')
 return {schema:['charts','dashboards','detectors','slos','services'].includes(kind)?'Splunk Observability v2 resource subset':kind==='rum'?'Documented Splunk browser initialization evidence':kind==='history'&&source.source==='splunk-timeserieswindow'?'Splunk timeserieswindow response prose and example subset':'unqualified source evidence',issues,expressions:queries,cutover:'blocked'}
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
