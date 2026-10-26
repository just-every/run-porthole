import {syntax,duration,SignalFlowUnsupported} from './syntax'
export {SignalFlowUnsupported} from './syntax'
export type Aggregate='mean'|'sum'|'min'|'max'
export type Condition={operator:string;threshold:number;lastingMs?:number;atLeast?:number}
export type CompiledSignalFlow={metric:string;filter?:{property:string;value:string};aggregate:Aggregate;label:string;condition?:Condition;off?:Condition;resolutionMs?:number;rollup?:string;window?:{aggregate:Aggregate;milliseconds:number}}
/** Closed finite-window grammar. Compilation never qualifies source execution parity. */
export function compileSignalFlow(source:string):CompiledSignalFlow{
 const p=syntax(source),{current,take,string,number,reject}=p
 let variable:string|undefined
 if(p.peek()?.text==='='){if(!/^[A-Za-z_]\w*$/.test(current().text))reject();variable=current().text;take(variable);take('=')}
 take('data');take('(');const metric=string(),options=new Set<string>()
 let filter:CompiledSignalFlow['filter'],resolutionMs:number|undefined,rollup:string|undefined
 while(current()?.text===','){
  take(',');const key=current()?.text;if(!key||options.has(key))reject('duplicate or invalid data option');options.add(key);take(key);take('=')
  if(key==='filter'){
   take('filter');take('(');const property=string();take(',');const value=string();take(')')
   if(!['service','environment','team'].includes(property)||/[?*]/.test(value))reject('filter property or wildcard')
   filter={property,value}
  }else if(key==='resolution'){
   resolutionMs=current()?.value!==undefined?duration(string()):number()
   if(!Number.isSafeInteger(resolutionMs)||resolutionMs<1000||resolutionMs>86400000||resolutionMs%1000)reject('data resolution')
  }else if(key==='rollup'){
   rollup=string();if(!['average','sum','min','max','latest'].includes(rollup))reject('rollup')
  }else if(key==='extrapolation'){
   if(string()!=='null')reject('extrapolation requires source inactivity qualification')
  }else reject(key)
 }
 take(')');take('.')
 const aggregate=current()?.text
 if(!['mean','sum','min','max'].includes(aggregate??''))reject()
 take(aggregate!);take('(');take(')')
 let window:CompiledSignalFlow['window']
 if(current()?.text==='.'&&['mean','sum','min','max'].includes(p.peek()?.text??'')){
  take('.');const operation=current().text as Aggregate;take(operation);take('(');take('over');take('=');const milliseconds=duration(string());take(')')
  if(!resolutionMs||milliseconds%resolutionMs)reject('window requires an explicit divisible data resolution')
  window={aggregate:operation,milliseconds}
 }
 const publish=()=>{take('.');take('publish');take('(');if(current()?.text==='label'){take('label');take('=')}const label=string();take(')');return label}
 if(variable&&current()?.text==='.')publish()
 if(current()?.text===';')take(';')
 const when=():Condition=>{
  take('when');take('(');take(variable!);const operator=current()?.text
  if(!['>','>=','<','<=','==','!='].includes(operator??''))reject()
  take(operator!);const wrapped=current()?.text==='threshold';if(wrapped){take('threshold');take('(')}const threshold=number();if(wrapped)take(')')
  const result:Condition={operator:operator!,threshold},seen=new Set<string>()
  while(current()?.text===','){
   take(',');const key=current()?.text;if(!key||seen.has(key))reject();seen.add(key);take(key);take('=')
   if(key==='lasting')result.lastingMs=duration(string())
   else if(key==='at_least'){result.atLeast=number();if(result.atLeast<=0||result.atLeast>1)reject('at_least')}
   else reject(key)
  }
  take(')')
  if((result.lastingMs||result.atLeast!==undefined)&&(!resolutionMs||!result.lastingMs||result.lastingMs%resolutionMs))reject('lasting requires an explicit divisible data resolution')
  return result
 }
 let condition:Condition|undefined,off:Condition|undefined
 if(variable){take('detect');take('(');condition=when();if(current()?.text===','){take(',');take('off');take('=');off=when()}take(')')}
 const label=publish();if(current()?.text===';')take(';');if(!p.end())reject()
 if((rollup||window)&&!resolutionMs)throw new SignalFlowUnsupported(0,'timing options require an explicit data resolution')
 return {metric,...(filter?{filter}:{}),aggregate:aggregate as Aggregate,label,...(condition?{condition}:{}),...(off?{off}:{}),...(resolutionMs?{resolutionMs}:{}),...(rollup?{rollup}:{}),...(window?{window}:{})}
}
