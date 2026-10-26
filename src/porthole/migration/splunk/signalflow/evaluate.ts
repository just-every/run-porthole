import {canonicalJson} from '../../../../modules/import-kit/src/provenance/identity.ts'
import {attributes} from '../../../ingest/normalize'
import type {CompiledSignalFlow} from './compile'
import {aggregate,alignedWindow} from './aligned'
export type NativeSample={event_time_ns:string;payload:{resource:{attributes?:unknown};scope:unknown;metricKind?:string;metric:{name:string;unit?:string};record:{asDouble?:number;asInt?:string;attributes?:unknown;flags?:number}}}
/** Evaluate only observed, exactly timestamp-aligned gauge samples. No rollup or extrapolation. */
export function replaySamples(program:CompiledSignalFlow,rows:NativeSample[],range?:{from:string;through:string}){
 const groups=new Map<string,number[]>(),seen=new Set<string>(),units=new Set<string>(),population=new Set<string>()
 for(const row of rows){
  if(row.payload.metricKind!=='gauge')throw Error('Gauge samples required; counter rollup and rates remain unqualified')
  const record=row.payload.record
  if(record.flags!==undefined&&(!Number.isInteger(record.flags)||(record.flags&1)!==0))throw Error('Missing-value metric flags require source resolution')
  const value=record.asDouble??(record.asInt!==undefined?Number(record.asInt):NaN)
  if(!Number.isFinite(value)||record.asInt!==undefined&&!Number.isSafeInteger(value))throw Error('Nonfinite or inexact numeric sample')
  const series=canonicalJson([attributes(row.payload.resource?.attributes),row.payload.scope??null,attributes(record.attributes)])
  population.add(series)
  const identity=row.event_time_ns+':'+series
  if(seen.has(identity))throw Error('Ambiguous duplicate series timestamp')
  seen.add(identity);units.add(row.payload.metric.unit??'')
  const values=groups.get(row.event_time_ns)??[];values.push(value);groups.set(row.event_time_ns,values)
 }
 if(units.size>1)throw Error('Incompatible metric units')
 const points=[...groups].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0).map(([time,values])=>{
  const value=aggregate(values,program.aggregate)
  const c=program.condition
  const active=c?({'>' :value>c.threshold,'>=':value>=c.threshold,'<':value<c.threshold,'<=':value<=c.threshold,'==':value===c.threshold,'!=':value!==c.threshold}[c.operator]):undefined
  return {time,value,series:values.length,...(c?{active}:{} )}
 })
 if(program.resolutionMs){if(!range)throw Error('Explicit aligned source window required');return {label:program.label,unit:units.values().next().value??'',...alignedWindow(program,points,population.size,range)}}
 return {label:program.label,points,unit:units.values().next().value??'',coverage:points.length?'observed-samples-only':'no-data',qualification:'Retained-sample analysis only. Source resolution, rollup, extrapolation, missing intervals and detector lifecycle parity remain unqualified.'}
}
