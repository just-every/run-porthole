import {fail} from '../../../security/authority'
import {nano} from '../../../ingest/model'
import {epochNanoseconds,SplUnsupported,type SplQuery,type ScopeField} from './compile'
export type IndexMapping={index:string;service:string;environment:string;team:string}
export function reviewedMapping(value:unknown,query:SplQuery):IndexMapping {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('spl_index_mapping_required',422)
 const mapping=value as Record<string,unknown>,keys=['index','service','environment','team'] as const
 if(Object.keys(mapping).length!==keys.length||Object.keys(mapping).some(key=>!keys.includes(key as typeof keys[number])))fail('spl_index_mapping_required',422)
 for(const key of keys)if(typeof mapping[key]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(mapping[key] as string))fail('spl_explicit_scope_required',422)
 if(mapping.index!==query.index)fail('spl_index_mapping_mismatch',422)
 for(const [key,value]of Object.entries(query.predicates))if(String(mapping[key]).toLowerCase()!==value!.toLowerCase())fail('spl_scope_mapping_mismatch',422)
 return Object.fromEntries(keys.map(key=>[key,mapping[key]])) as IndexMapping
}
export function mappedRange(data:Record<string,unknown>,definition:Record<string,unknown>,query:SplQuery){
 const from=String(BigInt(nano(data.from))),through=String(BigInt(nano(data.through)))
 if(BigInt(from)>BigInt(through))fail('invalid_query_range',400)
 // Only the documented REST event-time pair has a known external time shape.
 // Retain all other context, and refuse to silently reinterpret its semantics.
 for(const key of Object.keys(definition))if(!['id','name','description','tags','query','earliest_time','latest_time','sourceReference'].includes(key))throw new SplUnsupported(key,0,'This retained source context requires explicit source qualification before native execution.')
 let earliest=query.earliest,latest=query.latest
 if(definition.earliest_time!==undefined||definition.latest_time!==undefined){
  if(typeof definition.earliest_time!=='string'||typeof definition.latest_time!=='string')throw new SplUnsupported('earliest_time and latest_time',0,'Both retained REST event-time bounds must be absolute epoch-second strings.')
  const start=epochNanoseconds(definition.earliest_time),end=epochNanoseconds(definition.latest_time)
  if(earliest&&earliest!==start||latest&&latest!==end)throw new SplUnsupported('conflicting source time bounds',0,'Resolve differing inline and retained REST bounds explicitly.')
  earliest=start;latest=end
 }
 if(earliest&&latest&&(from!==earliest||BigInt(through)!==BigInt(latest)-1n))fail('spl_source_time_mismatch',422)
 return {from,through,...(earliest?{sourceEarliest:earliest,sourceLatestExclusive:latest}:{})}
}
export type NativeLog={id:string;event_time_ns:string;service:string;environment:string;team:string;payload:Record<string,unknown>}
export function countMappedLogs(records:NativeLog[],query:SplQuery,mapping:IndexMapping){
 const groups=new Map<string,number>()
 for(const row of records){
  for(const key of ['service','environment','team'] as ScopeField[])if(row[key]!==mapping[key])fail('spl_native_scope_mismatch',422)
  const group=query.groupBy?row[query.groupBy]:''
  groups.set(group,(groups.get(group)??0)+1)
 }
 if(!query.groupBy&&!records.length)groups.set('',0)
 return [...groups].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([group,count])=>({... (query.groupBy?{[query.groupBy]:group}:{}),count}))
}
