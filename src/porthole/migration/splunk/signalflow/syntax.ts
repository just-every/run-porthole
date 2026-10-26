export class SignalFlowUnsupported extends Error {
 constructor(readonly offset:number,readonly construct:string){super(`Unqualified SignalFlow construct at ${offset}: ${construct}`)}
}
export type Token={text:string;offset:number;value?:string}
export function syntax(source:string){
 const tokens:Token[]=[]
 const pattern=/\s+|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][\w]*|\d+(?:\.\d+)?|>=|<=|==|!=|./g
 for(const match of source.matchAll(pattern)){
  const text=match[0],offset=match.index!
  if(/^\s|^#/.test(text))continue
  let value:string|undefined
  if(/^["']/.test(text)){
   if(text.at(-1)!==text[0]||text.length<2)throw new SignalFlowUnsupported(offset,'unterminated string')
   value=text.slice(1,-1).replace(/\\([\\'"nrt])/g,(_all,c:string)=>({n:'\n',r:'\r',t:'\t'}[c]??c))
   if(/\\/.test(value))throw new SignalFlowUnsupported(offset,'string escape')
  }
  tokens.push({text,offset,...(value!==undefined?{value}:{})})
 }
 let index=0
 const current=()=>tokens[index]
 const reject=(construct?:string):never=>{throw new SignalFlowUnsupported(current()?.offset??source.length,construct??current()?.text??'end of program')}
 const take=(text:string)=>{if(current()?.text!==text)reject();index++}
 const string=()=>{const token=current();if(token?.value===undefined)reject();index++;return token!.value!}
 const number=()=>{let sign=1;if(current()?.text==='-'){take('-');sign=-1}const token=current();if(!token||!/^\d+(?:\.\d+)?$/.test(token.text))reject();index++;const n=sign*Number(token!.text);if(!Number.isFinite(n))reject();return n}
 return {current,take,string,number,reject,peek:(offset=1)=>tokens[index+offset],end:()=>index===tokens.length}
}
export function duration(value:string):number{
 const match=/^(\d+)(ms|s|m|h|d)$/.exec(value)
 const n=match?Number(match[1])*({ms:1,s:1000,m:60000,h:3600000,d:86400000}[match[2]]??NaN):NaN
 if(!Number.isSafeInteger(n)||n<1000||n>86400000||n%1000)throw new SignalFlowUnsupported(0,'duration must be whole seconds within one day')
 return n
}
