import {sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import type {Json} from '../../../modules/import-kit/src/types.ts'

type ObjectValue = {[key:string]:Json}
const object=(value:unknown):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value)
export type SplunkMetricHistory={
 id:string;source:'splunk-timeserieswindow';timestampUnit:'milliseconds'
 request:{query:string;startMs:number;endMS:number;resolution:number}
 response:{data:{[id:string]:[number,number][]};errors:[];[key:string]:Json}
 metadata:{[id:string]:{metric:string;type:'GAUGE'|'COUNTER'|'CUMULATIVE_COUNTER'|'HISTOGRAM';dimensions:{[key:string]:string};tags?:string[];[key:string]:Json|undefined}}
 limitations:string[]
}
export const splunkHistoryLimits=[
 'Only the selected query and time window were read; no complete account history or transactional snapshot is established.',
 'The provider returns default rollups: gauge average, counter sum, cumulative counter maximum. Requested resolution does not recover original raw samples.',
 'Retention, entitlement and paid export availability require source-account review; absent intervals remain unknown and are never filled.',
 'The official response schema disagrees with its documented timestamp-value pairs and fractional-value example. This reader follows the explicit response prose and example.',
 'The official startMs parameter and startMS operation prose disagree. Extraction uses the parameter schema spelling and retains the exact request.',
]

/** Validates the documented response prose and example, preserving every source field. */
export function readSplunkHistory(value:unknown):{ok:true;history:SplunkMetricHistory}|{ok:false;reason:string}{
 const fail=(reason:string)=>({ok:false as const,reason})
 if(!object(value)||value.source!=='splunk-timeserieswindow'||typeof value.id!=='string'||!/^timeserieswindow:[a-f0-9]{64}$/.test(value.id)||value.timestampUnit!=='milliseconds')return fail('Historical evidence needs the supported source, stable window identity and original millisecond timestamps')
 const request=value.request,response=value.response,metadata=value.metadata
 if(!object(request)||typeof request.query!=='string'||!request.query.trim()||request.query.length>4096||![request.startMs,request.endMS].every(time=>typeof time==='number'&&Number.isSafeInteger(time)&&time>=0&&time<=18446744073709)||Number(request.endMS)<=Number(request.startMs)||![1000,60000,300000,3600000].includes(Number(request.resolution)))return fail('Historical request needs an explicit query, safe millisecond window and documented resolution')
 if(Object.keys(request).some(key=>!['query','startMs','endMS','resolution'].includes(key))||value.id!=='timeserieswindow:'+sha256(JSON.stringify({query:request.query,startMs:request.startMs,endMS:request.endMS,resolution:request.resolution})))return fail('Historical identity does not match its exact source query, time window and resolution')
 if(!object(response)||!object(response.data)||!Array.isArray(response.errors)||response.errors.length||response.code!==undefined&&response.code!==200)return fail('Historical response is incomplete: require a data map, no provider errors and successful status')
 if(Object.keys(response).some(key=>!['data','errors','code'].includes(key)))return fail('Historical response contains unqualified status or truncation metadata')
 if(!object(metadata))return fail('Historical MTS metadata map is required')
 const ids=Object.keys(response.data)
 if(ids.length>=10000)return fail('Historical response reached the provider 10,000-MTS cap; use a narrower authorized query')
 if(Object.keys(metadata).length!==ids.length||Object.keys(metadata).some(id=>!Object.hasOwn(response.data as ObjectValue,id)))return fail('Historical MTS metadata does not match the returned series identities')
 for(const id of ids){
  if(!id||id.length>200||/[\u0000-\u001f\u007f]/.test(id))return fail('Historical MTS identity is invalid')
  const points=response.data[id],meta=metadata[id]
  if(!Array.isArray(points))return fail('Historical data must use documented timestamp-value pairs for each MTS')
  let previous=-1
  for(const point of points){
   if(!Array.isArray(point)||point.length!==2||typeof point[0]!=='number'||!Number.isSafeInteger(point[0])||point[0]<Number(request.startMs)||point[0]>Number(request.endMS)||point[0]<=previous||typeof point[1]!=='number'||!Number.isFinite(point[1])||Number.isInteger(point[1])&&!Number.isSafeInteger(point[1]))return fail('Historical points have an invalid, duplicate, unordered or out-of-window timestamp, or an inexact value')
   previous=point[0]
  }
  if(!object(meta)||typeof meta.metric!=='string'||!meta.metric||!['GAUGE','COUNTER','CUMULATIVE_COUNTER','HISTOGRAM'].includes(String(meta.type))||!object(meta.dimensions)||Object.values(meta.dimensions).some(v=>typeof v!=='string')||meta.tags!==undefined&&(!Array.isArray(meta.tags)||meta.tags.some(v=>typeof v!=='string'))||meta.id!==undefined&&meta.id!==id)return fail('Historical metadata requires the matching MTS identity, metric, type, dimensions and valid tags')
  for(const field of ['created','lastUpdated'])if(meta[field]!==undefined&&(!Number.isSafeInteger(meta[field])||Number(meta[field])<0))return fail('Historical metadata has an inexact original timestamp')
 }
 if(!Array.isArray(value.limitations)||value.limitations.some(limit=>typeof limit!=='string'))return fail('Historical evidence must retain explicit extraction limitations')
 return {ok:true,history:value as unknown as SplunkMetricHistory}
}

export function splunkTimestampNs(milliseconds:number):string{
 if(!Number.isSafeInteger(milliseconds)||milliseconds<0)throw new Error('Expected an exact nonnegative millisecond timestamp')
 return (BigInt(milliseconds)*1000000n).toString()
}
