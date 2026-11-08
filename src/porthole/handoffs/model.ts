import {fail} from '../security/authority'

export const products=[
 {id:'vane',name:'Vane',owns:'Cookie-free marketing traffic, audiences, goals and funnels.'},
 {id:'linen',name:'Linen',owns:'Employee IT requests, laptops and CMDB.'},
 {id:'evidence',name:'Evidence',owns:'Compliance programs; Porthole does not certify controls.'},
 {id:'vantage',name:'Vantage',owns:'Whole-cloud spend; Porthole owns only its telemetry spend.'},
 {id:'cloudzero',name:'CloudZero',owns:'Whole-cloud spend; Porthole owns only its telemetry spend.'},
 {id:'splunk-es',name:'Splunk Enterprise Security',owns:'Security analytics, SIEM and threat response.'},
 {id:'datadog-cloud-siem',name:'Datadog Cloud SIEM',owns:'Security analytics, SIEM and threat response.'},
 {id:'datadog-ci-visibility',name:'Datadog CI Visibility',owns:'CI pipeline and test execution; partner results are not locally measured service recovery.'},
 {id:'datadog-test-optimization',name:'Datadog Test Optimization',owns:'Test optimization; partner results are not locally measured service recovery.'},
 {id:'datadog-data-jobs',name:'Datadog Data Jobs Monitoring',owns:'Warehouse and Spark data-job operations.'},
 {id:'datadog-data-streams',name:'Datadog Data Streams Monitoring',owns:'Specialist stream-schema and data-quality analysis; Porthole owns runtime throughput, lag and asynchronous trace context.'},
 {id:'stream-specialist',name:'Selected stream specialist',owns:'Specialist stream-schema and data-quality analysis; Porthole owns runtime throughput, lag and asynchronous trace context.'},
] as const
export const responsibility='Porthole owns runtime traces, metrics, logs, profiles, APM, infrastructure, database and RUM performance, and its telemetry spend. A handoff is external navigation only: it sends no Porthole credential, confers no destination access and imports no partner result.'
export const placeholders=['service','environment','from','through'] as const
export const handoffColumns=['product','revision','destination','template','author_ref','created_at','state']
export interface Handoff {product:string;revision:number;destination:string;template:string;author_ref:string;created_at:number;state:string}
export function destination(value:unknown,template=false):string {
 if(typeof value!=='string'||!value||value.length>2000)fail('invalid_handoff_destination',400)
 let decoded=value
 for(let n=0;n<value.length;n++){if(/[\u0000-\u0020\u007f-\u009f\\]/.test(decoded))fail('invalid_handoff_destination',400);try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next}catch{fail('invalid_handoff_destination',400)}}
 const fields=[...value.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1])
 if((!template&&fields.length)||fields.some(v=>!placeholders.includes(v as typeof placeholders[number]))||/[{}]/.test(value.replace(/\{(service|environment|from|through)\}/g,'')))fail('invalid_handoff_template',400)
 let url:URL;try{url=new URL(value.replace(/\{(service|environment|from|through)\}/g,'synthetic-porthole-1'))}catch{return fail('invalid_handoff_destination',400)}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||/\{/.test(value.slice(0,value.indexOf('/',8)<0?value.length:value.indexOf('/',8))))fail('invalid_handoff_destination',400)
 let decodedUrl:URL;try{decodedUrl=new URL(decoded.replace(/\{(service|environment|from|through)\}/g,'synthetic-porthole-1'))}catch{return fail('invalid_handoff_destination',400)}
 for(const key of decodedUrl.searchParams.keys())if(/token|secret|password|credential|auth|api.?key|signature|session|cookie|access.?key/i.test(key))fail('handoff_credentials_forbidden',400)
 if(/(?:gh[pousr]_|github_pat_|Bearer\s|Basic\s)/i.test(decoded))fail('handoff_credentials_forbidden',400)
 return value
}
export function definition(data:Record<string,unknown>) {
 const target=destination(data.destination),template=data.template===''||data.template===undefined?'':destination(data.template,true)
 if(template&&new URL(template.replace(/\{\w+\}/g,'synthetic-porthole-1')).origin!==new URL(target).origin)fail('handoff_template_origin',400)
 return {destination:target,template}
}
export function validateHandoff(row:Record<string,unknown>) {
 if(!products.some(p=>p.id===row.product)||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||!Number.isSafeInteger(row.created_at)||Number(row.created_at)<0||typeof row.author_ref!=='string'||!/^[a-f0-9-]{36}$/.test(row.author_ref)||!['active','quarantined'].includes(String(row.state)))fail('invalid_handoff',422)
 definition(row)
}
export function links(rows:Handoff[],context?:{service:string;environment:string;from:string;through:string}) {
 return products.flatMap(p=>{const row=rows.find(r=>r.product===p.id);if(!row||row.state!=='active')return []
  const href=context&&row.template?row.template.replace(/\{(service|environment|from|through)\}/g,(_,key:keyof typeof context)=>encodeURIComponent(context[key])):row.destination
  return [{...p,href,revision:row.revision,placeholders:[...row.template.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1])}]
 })
}
