import {canonicalJson} from '../../../../modules/import-kit/src/provenance/identity.ts'
import {dimensions,nanoseconds,numeric,object,strings,type SourceObject,type SourceStream} from './types'
export type FiniteResult={
 sourceText?:string;label?:string;resolutionMs?:number;coverage?:string
 dimensions?:Record<string,string>;tags?:string[]
 points:{time:string;value:number|null;state?:string}[]
 transitions?:{time:string;was:string;is:string}[]
}
export type SourceMismatch={code:string;time?:string;field?:string;source:unknown;compiled:unknown}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b)
const sorted=(tags:string[])=>[...tags].sort()
/** Exact finite comparison only; provider incident IDs are retained, never re-created or equated to local IDs. */
export function compareSourceStream(stream:SourceStream,result:FiniteResult,range:{from:string;through:string}){
 const mismatches:SourceMismatch[]=[],unqualified:string[]=[]
 let values=0,transitions=0,inputValues=0
 const mismatch=(code:string,source:unknown,compiled:unknown,extra:{time?:string;field?:string}={})=>mismatches.push({code,source,compiled,...extra})
 const finish=()=>({status:mismatches.length?'mismatched':unqualified.length?'unqualified':'matched',sourceStreamId:stream.id,resolutionMs:stream.resolutionMs,range,compared:{values,transitions,inputValues},mismatches,unqualified:[...new Set(unqualified)],fullLifecycleParity:'unqualified',qualification:'Only declared aligned finite values, dimensions, tags and transitions are compared. Full source detector lifecycle, notifications, incident identity and pre-window state remain unqualified.'})
 if(result.sourceText!==stream.programText){mismatch('program-text-mismatch',stream.programText,result.sourceText??null);return finish()}
 if(!/^\d{1,20}$/.test(range.from)||!/^\d{1,20}$/.test(range.through)){unqualified.push('Comparison requires an exact nanosecond range');return finish()}
 const from=BigInt(range.from),through=BigInt(range.through),step=BigInt(stream.resolutionMs)*1000000n
 if(from>through||from<BigInt(stream.request.startMs)*1000000n||through>BigInt(stream.request.stopMs)*1000000n||from%step||through%step){unqualified.push('Comparison range must lie within the captured request and align exactly to source job resolution');return finish()}
 if((through-from)/step>=2000n){unqualified.push('Comparison exceeds the finite 2000-point window');return finish()}
 if(result.resolutionMs!==stream.resolutionMs)mismatch('job-resolution-mismatch',stream.resolutionMs,result.resolutionMs??null)
 if(stream.request.resolution!==stream.resolutionMs)unqualified.push('Requested resolution differs from the actual captured source job resolution')
 if(result.label!==stream.comparison.label)mismatch('publish-label-mismatch',stream.comparison.label,result.label??null)
 const meta=stream.metadata[stream.comparison.valueTsId]
 if(meta.sf_metric!==stream.comparison.label)mismatch('source-publish-label-mismatch',stream.comparison.label,meta.sf_metric??null)
 const compareMetadata=(metadata:SourceObject,kind:string)=>{
  for(const [key,value]of Object.entries(stream.comparison.dimensions)){
   if(metadata[key]!==value)mismatch(kind+'-dimension-mismatch',metadata[key]??null,value,{field:key})
  }
  if(!dimensions(result.dimensions))unqualified.push('Compiled sample dimensions were not established from actual observations')
  else if(!same(stream.comparison.dimensions,result.dimensions))mismatch('compiled-dimensions-mismatch',stream.comparison.dimensions,result.dimensions)
  if(!strings(metadata.sf_tags))unqualified.push(kind+' tags are absent from source metadata; empty tags cannot be assumed')
  else if(!same(sorted(metadata.sf_tags),sorted(stream.comparison.tags)))mismatch(kind+'-declared-tags-mismatch',metadata.sf_tags,stream.comparison.tags)
  if(!strings(result.tags))unqualified.push('Compiled metric tags were not established from actual observations; definition tags cannot substitute')
  else if(!same(sorted(stream.comparison.tags),sorted(result.tags)))mismatch('compiled-tags-mismatch',stream.comparison.tags,result.tags)
 }
 compareMetadata(meta,'source-value')
 for(const record of stream.info){const message=record.data.message as SourceObject;if(message.messageCode!=='JOB_RUNNING_RESOLUTION')unqualified.push('Retained source information requires interpretation: '+String(message.messageCode));if(message.messageLevel==='WARNING')unqualified.push('Source emitted warning: '+String(message.messageCode))}
 const sourcePoints=new Map<string,number>(),compiledPoints=new Map<string,FiniteResult['points'][number]>()
 for(const record of stream.data){
  const time=nanoseconds(Number(record.data.logicalTimestampMs));if(BigInt(time)<from||BigInt(time)>through)continue
  for(const raw of record.data.data as SourceObject[])if(raw.tsId===stream.comparison.valueTsId){
   if(BigInt(time)%step){mismatch('unaligned-source-value',time,null,{time});continue}
   sourcePoints.set(time,Number(raw.value))
  }
 }
 for(const point of result.points){
  if(!/^\d{1,20}$/.test(point.time)){mismatch('malformed-compiled-time',null,point.time);continue}
  const time=BigInt(point.time).toString()
  if(BigInt(time)<from||BigInt(time)>through){mismatch('compiled-point-outside-range',null,point,{time});continue}
  if(BigInt(time)%step){mismatch('unaligned-compiled-value',null,point,{time});continue}
  if(compiledPoints.has(time)){mismatch('duplicate-compiled-time',null,point,{time});continue}
  compiledPoints.set(time,point)
 }
 for(let time=from;time<=through;time+=step){
  const key=time.toString(),source=sourcePoints.get(key),compiled=compiledPoints.get(key)
  if(source===undefined){unqualified.push('No source value at '+key+'; absence does not establish a null or incident state');if(compiled?.value!==null&&compiled?.value!==undefined)mismatch('source-value-missing',null,compiled.value,{time:key});continue}
  if(!compiled||compiled.value===null){mismatch('compiled-value-missing',source,compiled?.value??null,{time:key});continue}
  if(!numeric(compiled.value)){mismatch('compiled-value-invalid',source,compiled.value,{time:key});continue}
  values++;if(source!==compiled.value)mismatch('value-mismatch',source,compiled.value,{time:key})
 }
 if(!values)unqualified.push('No finite aligned values were comparable')
 if(stream.comparison.eventTsId){
  compareMetadata(stream.metadata[stream.comparison.eventTsId],'source-event')
  const events=new Map<string,SourceObject>(),nativeTransitions=new Map<string,{time:string;was:string;is:string}>()
  for(const record of stream.events){if(record.data.tsId!==stream.comparison.eventTsId)continue;const time=nanoseconds(Number(record.data.timestampMs));if(BigInt(time)>=from&&BigInt(time)<=through){if(BigInt(time)%step)mismatch('unaligned-source-transition',record.data,null,{time});else events.set(time,record.data)}}
  for(const transition of result.transitions??[]){
   if(!/^\d{1,20}$/.test(transition.time)){mismatch('malformed-compiled-transition-time',null,transition.time);continue}
   const time=BigInt(transition.time).toString()
   if(BigInt(time)<from||BigInt(time)>through||BigInt(time)%step){mismatch('compiled-transition-outside-aligned-range',null,transition,{time});continue}
   if(nativeTransitions.has(time)){mismatch('duplicate-compiled-transition',null,transition,{time});continue}
   // The first local observation establishes a state; it does not establish a source incident.
   if(transition.was==='unknown'||transition.was==='Unknown'){
    unqualified.push('Initial compiled incident state is unknown at '+time+'; its prior state cannot be compared')
    if(!events.has(time))continue
   }
   nativeTransitions.set(time,transition)
  }
  for(const time of new Set([...events.keys(),...nativeTransitions.keys()])){
   const event=events.get(time),transition=nativeTransitions.get(time)
   if(!event){mismatch('source-transition-missing',null,transition,{time});continue}
   if(!transition){mismatch('compiled-transition-missing',event,null,{time});continue}
   const properties=event.properties as SourceObject
   transitions++
   if(transition.was!=='unknown'&&transition.was!=='Unknown'&&transition.was!==properties.was)mismatch('transition-was-mismatch',properties.was,transition.was,{time})
   if(transition.is!==properties.is)mismatch('transition-is-mismatch',properties.is,transition.is,{time})
   const inputs=JSON.parse(String(properties.inputValues)) as SourceObject,variable=stream.comparison.inputVariable
   if(!variable)unqualified.push('No declared event input variable links source inputValues to compiled values')
   else if(!Object.hasOwn(inputs,variable))mismatch('event-input-variable-missing',inputs,null,{time,field:variable})
   else{
    const point=compiledPoints.get(time)
    if(!point||point.value===null)unqualified.push('Compiled event input value is unknown at '+time)
    else{inputValues++;if(inputs[variable]!==point.value)mismatch('event-input-value-mismatch',inputs[variable],point.value,{time,field:variable})}
    if(Object.keys(inputs).some(key=>key!==variable))unqualified.push('Additional source event input variables have no declared compiled comparison')
   }
  }
  unqualified.push('Source pre-window incident state and provider incident identity remain unqualified')
 }else if((result.transitions?.length??0)>0)unqualified.push('No source event series was declared; compiled transitions remain unqualified')
 if(stream.events.some(record=>record.data.tsId!==stream.comparison.eventTsId))unqualified.push('Additional source event series were retained but are outside the declared comparison')
 if(stream.data.some(record=>(record.data.data as SourceObject[]).some(point=>point.tsId!==stream.comparison.valueTsId)))unqualified.push('Additional source value series were retained but are outside the declared comparison')
 return finish()
}
