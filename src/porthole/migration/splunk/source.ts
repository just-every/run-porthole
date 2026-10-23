import type {Json,ParsedRecord} from '../../../modules/import-kit/src/types.ts'
export const splunkCollections=['charts','dashboards','detectors','services','rum','slos','notifications','logSearches','history','securityDashboards'] as const
export function readCollections(value:Json,index:number,vendor:string,collections:readonly string[]):ParsedRecord[]{
 if(!value||typeof value!=='object'||Array.isArray(value))return [{kind:'unsupported',sourceId:String(index),payload:value}]
 const records:ParsedRecord[]=[]
 for(const [kind,items]of Object.entries(value)){
  if(!collections.includes(kind)||!Array.isArray(items)){records.push({kind:'unsupported',sourceId:`${index}:${kind}`,payload:{reason:'Unsupported export collection: '+kind}});continue}
  items.forEach((item,i)=>{
   if(!item||typeof item!=='object'||Array.isArray(item)){records.push({kind:'unsupported',sourceId:`${index}:${kind}:${i}`,payload:item});return}
   const id=item.id??item.uuid??item.name
   if(typeof id!=='string'||!id||id.length>200){records.push({kind:'unsupported',sourceId:`${index}:${kind}:${i}`,payload:{reason:'Missing stable source id'}});return}
   records.push({kind,sourceId:id,payload:{vendor,kind,definition:item,status:'source-evidence',qualification:'Native query and alert equivalence remains unproved',...(kind==='securityDashboards'?{specialist:'Splunk Enterprise Security',handoff:'Retain the source security dashboard and use the authorized security specialist'}:{})}})
  })
 }
 return records.length?records:[{kind:'unsupported',sourceId:String(index),payload:{reason:'Empty source export'}}]
}
export const parseSplunk=(value:Json,index:number)=>readCollections(value,index,'splunk',splunkCollections)
