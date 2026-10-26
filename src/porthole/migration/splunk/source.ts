import {splunkReview} from './review'
import type {Json,ParsedRecord} from '../../../modules/import-kit/src/types.ts'
export const splunkCollections=['charts','dashboards','detectors','services','rum','slos','notifications','logSearches','history','securityDashboards'] as const
export function readCollections(value:Json,index:number,vendor:string,collections:readonly string[],maxItemBytes?:number):ParsedRecord[]{
 if(!value||typeof value!=='object'||Array.isArray(value))return [{kind:'unsupported',sourceId:String(index),payload:value}]
 const records:ParsedRecord[]=[]
 for(const [kind,items]of Object.entries(value)){
  if(!collections.includes(kind)||!Array.isArray(items)){records.push({kind:'unsupported',sourceId:`${index}:${kind}`,payload:{reason:'Unsupported export collection: '+kind}});continue}
  items.forEach((item,i)=>{
   if(maxItemBytes&&new TextEncoder().encode(JSON.stringify(item)).length>maxItemBytes){records.push({kind:'unsupported',sourceId:`${index}:${kind}:${i}`,payload:{reason:'Source object exceeds 64 KiB; retain the source and obtain a bounded export'}});return}
   if(!item||typeof item!=='object'||Array.isArray(item)){records.push({kind:'unsupported',sourceId:`${index}:${kind}:${i}`,payload:item});return}
   const id=item.id??item.uuid??item.name
   if(typeof id!=='string'||!id||id.length>200){records.push({kind:'unsupported',sourceId:`${index}:${kind}:${i}`,payload:{reason:'Missing stable source id'}});return}
   records.push({kind,sourceId:id,payload:{vendor,kind,definition:item,status:'source-evidence',qualification:'Native query and alert equivalence remains unproved',...(kind==='securityDashboards'?{specialist:'Splunk Enterprise Security',handoff:'Retain the source security dashboard and use the authorized security specialist'}:{})}})
  })
 }
 return records.length?records:[{kind:'unsupported',sourceId:String(index),payload:{reason:'Empty source export'}}]
}
type ObjectValue = {[key:string]:Json}
const object=(value:Json):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value)
const refusal=(index:number,kind:string,reason:string):ParsedRecord=>({kind:'unsupported',sourceId:`${index}:${kind}`,payload:{reason}})
/** Export bundles wrap original endpoint responses under their collection names. */
export function parseSplunk(value:Json,index:number):ParsedRecord[]{
 if(!object(value))return readCollections(value,index,'splunk',splunkCollections)
 const records:ParsedRecord[]=[]
 for(const [kind,collection]of Object.entries(value)){
  if(!splunkCollections.includes(kind as typeof splunkCollections[number])){
   records.push(refusal(index,kind,'Unsupported export collection: '+kind));continue
  }
  let items:Json=collection
  if(object(collection)&&'results' in collection){
   items=collection.results
   if(!Array.isArray(items)||!Number.isSafeInteger(collection.count)||Number(collection.count)<0){
    records.push(refusal(index,kind,'Invalid official list envelope: count and results are required'));continue
   }
   if(collection.count!==items.length)records.push(refusal(index,kind,`Incomplete official list export: received ${items.length} of ${collection.count}. Export all pages before qualification.`))
   for(const key of Object.keys(collection))if(!['count','results'].includes(key))records.push(refusal(index,kind+':'+key,'Unqualified list metadata: '+key))
  }
  if(Array.isArray(items)&&!items.length)continue
  for(const record of readCollections({[kind]:items},index,'splunk',[kind],65536)){
   if(record.kind!=='unsupported'&&object(record.payload)){
    record.payload={...record.payload,review:splunkReview(kind,record.payload.definition)}
   }
   records.push(record)
  }
 }
 return records.length?records:[refusal(index,'empty','Empty source export')]
}
