import type {Aggregate,CompiledSignalFlow,Condition} from './compile'
type Point={time:string;value:number;series:number;active?:boolean}
type AlignedPoint={time:string;value:number|null;series:number;reason:string|null}
export function aggregate(values:number[],operation:Aggregate){
 const sum=values.reduce((total,value)=>total+value,0)
 if(['sum','mean'].includes(operation)&&values.every(Number.isSafeInteger)&&!Number.isSafeInteger(sum))throw Error('Inexact integer aggregation')
 const value=operation==='min'?Math.min(...values):operation==='max'?Math.max(...values):sum/(operation==='mean'?values.length:1)
 if(!Number.isFinite(value))throw Error('Aggregate overflow')
 return value
}
function compare(value:number,c:Condition){return ({'>':value>c.threshold,'>=':value>=c.threshold,'<':value<c.threshold,'<=':value<=c.threshold,'==':value===c.threshold,'!=':value!==c.threshold})[c.operator]!}
function predicate(points:AlignedPoint[],index:number,c:Condition,resolution:number):boolean|null{
 const length=c.lastingMs?c.lastingMs/resolution:1
 if(index+1<length)return null
 const selected=points.slice(index-length+1,index+1),valid=selected.filter(point=>point.value!==null)
 if(!valid.length)return null
 return valid.filter(point=>compare(point.value!,c)).length/length>=(c.atLeast??1)
}
/** No bucket assignment or guessed interpolation. Inputs must already align exactly. */
export function alignedWindow(program:CompiledSignalFlow,observations:Point[],population:number,range:{from:string;through:string}){
 const resolution=program.resolutionMs!,step=BigInt(resolution)*1000000n,start=BigInt(range.from),end=BigInt(range.through)
 if(start%step||end%step||end<start)throw Error('Source window must align exactly to declared data resolution')
 const length=(end-start)/step+1n
 if(length>2000n)throw Error('Aligned replay exceeds 2000 compute points; narrow the window')
 const byTime=new Map(observations.map(point=>[BigInt(point.time).toString(),point]))
 for(const point of observations)if(BigInt(point.time)%step)throw Error('Unaligned samples require source-qualified bucket and rollup semantics')
 const aligned:AlignedPoint[]=Array.from({length:Number(length)},(_,index)=>{
  const time=(start+BigInt(index)*step).toString(),observed=byTime.get(time)
  const reason=!observed?'Missing interval':observed.series!==population?'Incomplete observed series population':null
  return {time,value:reason?null:observed!.value,series:observed?.series??0,reason}
 })
 const points=program.window?aligned.map((point,index)=>{
  const count=program.window!.milliseconds/resolution,window=aligned.slice(Math.max(0,index-count+1),index+1)
  if(window.length<count)return {...point,value:null,reason:'Transformation warm-up incomplete'}
  if(window.some(value=>value.value===null))return {...point,value:null,reason:'Transformation contains missing intervals'}
  return {...point,value:aggregate(window.map(value=>value.value!),program.window!.aggregate)}
 }):aligned
 let held:'ok'|'anomalous'|'unknown'='unknown'
 const transitions:{time:string;was:string;is:string}[]=[]
 const results=points.map((point,index)=>{
  if(!program.condition)return point
  const on=predicate(points,index,program.condition,resolution)
  const off=program.off?predicate(points,index,program.off,resolution):on===null?null:!on
  const historyLength=Math.max(program.condition.lastingMs??resolution,program.off?.lastingMs??resolution)/resolution
  const incomplete=point.value===null||index+1<historyLength||points.slice(Math.max(0,index-historyLength+1),index+1).some(value=>value.value===null)
  if(incomplete)return {...point,on,off,state:'Unknown',heldState:held}
  const next=on===true&&off===false?'anomalous':on===false&&off===true?'ok':held
  if(next!==held){transitions.push({time:point.time,was:held,is:next});held=next}
  return {...point,on,off,state:held==='unknown'?'Unknown':held,heldState:held}
 })
 return {points:results,transitions,resolutionMs:resolution,coverage:!observations.length?'no-data':points.some(point=>point.value===null)?'incomplete-aligned-window':'complete-aligned-window',assumptions:['The supplied cadence is the data resolution, not proof of the source job resolution.','Input values must already be aligned; no source bucket boundaries or arrival ordering are inferred.','Lasting uses complete trailing windows and an inclusive at_least comparison.','Initial incident state is unknown; missing evidence never establishes recovery.'],qualification:'Finite aligned replay only. Source job cadence, extrapolation, bucket boundaries, initial incident state and full detector parity require source execution comparison.'}
}
