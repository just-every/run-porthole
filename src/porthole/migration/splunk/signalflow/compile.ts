/** Strict retained-sample replay grammar, never a full SignalFlow evaluator. */
export class SignalFlowUnsupported extends Error {
 constructor(readonly offset:number,readonly construct:string){super(`Unqualified SignalFlow construct at ${offset}: ${construct}`)}
}
type Token={text:string;offset:number;value?:string}
export type CompiledSignalFlow={metric:string;filter?:{property:string;value:string};aggregate:'mean'|'sum'|'min'|'max';label:string;condition?:{operator:string;threshold:number}}
function tokenize(source:string):Token[]{
 const tokens:Token[]=[]
 const pattern=/\s+|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][\w]*|\d+(?:\.\d+)?|>=|<=|==|!=|./g
 for(const match of source.matchAll(pattern)){
  const text=match[0],offset=match.index!
  if(/^\s|^#/.test(text))continue
  let value:string|undefined
  if(/^["']/.test(text)){
   const quote=text[0];if(text.at(-1)!==quote||text.length<2)throw new SignalFlowUnsupported(offset,'unterminated string')
   // Decode only explicit SignalFlow string escapes; other forms remain unqualified.
   value=text.slice(1,-1).replace(/\\([\\'"nrt])/g,(_all,c:string)=>({n:'\n',r:'\r',t:'\t'}[c]??c))
   if(/\\/.test(value))throw new SignalFlowUnsupported(offset,'string escape')
  }
  tokens.push({text,offset,...(value!==undefined?{value}:{})})
 }
 return tokens
}
export function compileSignalFlow(source:string):CompiledSignalFlow{
 const tokens=tokenize(source);let index=0
 const current=()=>tokens[index]
 const unsupported=():never=>{const token=current();throw new SignalFlowUnsupported(token?.offset??source.length,token?.text??'end of program')}
 const take=(text:string)=>{if(current()?.text!==text)unsupported();index++}
 const string=()=>{const token=current();if(token?.value===undefined)unsupported();index++;return token!.value!}
 let variable:string|undefined
 if(tokens[1]?.text==='='){if(!/^[A-Za-z_]\w*$/.test(current().text))unsupported();variable=current().text;index+=2}
 take('data');take('(');const metric=string();let filter:CompiledSignalFlow['filter']
 if(current()?.text===','){
  take(',');take('filter');take('=');take('filter');take('(');const property=string();take(',');const value=string();take(')')
  if(!['service','environment','team'].includes(property)||/[?*]/.test(value))throw new SignalFlowUnsupported(tokens[index-1].offset,'filter property or wildcard')
  filter={property,value}
 }
 take(')');take('.');const aggregate=current()?.text
 if(!['mean','sum','min','max'].includes(aggregate??''))unsupported()
 index++;take('(');take(')')
 if(current()?.text===';')take(';')
 let condition:CompiledSignalFlow['condition']
 if(variable){
  take('detect');take('(');take('when');take('(');take(variable)
  const operator=current()?.text
  if(!['>','>=','<','<=','==','!='].includes(operator??''))unsupported()
  index++;let sign=1;if(current()?.text==='-'){sign=-1;index++}
  const number=current();if(!number||!/^\d+(?:\.\d+)?$/.test(number.text))unsupported()
  const threshold=sign*Number(number!.text);if(!Number.isFinite(threshold))unsupported();index++
  condition={operator:operator!,threshold};take(')');take(')')
 }
 take('.');take('publish');take('(')
 if(current()?.text==='label'){take('label');take('=')}
 const label=string();take(')');if(current()?.text===';')take(';')
 if(index!==tokens.length)unsupported()
 return {metric,...(filter?{filter}:{}),aggregate:aggregate as CompiledSignalFlow['aggregate'],label,...(condition?{condition}:{})}
}
