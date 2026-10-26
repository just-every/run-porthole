export type ScopeField='service'|'environment'|'team'
export type SplQuery={index:string;predicates:Partial<Record<ScopeField,string>>;groupBy?:ScopeField;earliest?:string;latest?:string}
export class SplUnsupported extends Error {
 readonly construct:string
 readonly offset:number
 constructor(construct:string,offset:number,detail:string){super(detail);this.construct=construct;this.offset=offset}
}
function unsupported(construct:string,offset:number,detail:string):never {throw new SplUnsupported(construct,offset,detail)}
const literal=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/
export function epochNanoseconds(value:string,offset=0):string {
 const match=/^(\d{1,11})(?:\.(\d{1,9}))?$/.exec(value)
 if(!match)unsupported(value,offset,'Only positive absolute epoch seconds with at most nine fractional digits are implemented. Relative time and snapping require source resolution.')
 const result=BigInt(match[1])*1000000000n+BigInt((match[2]??'').padEnd(9,'0'))
 if(result<1n||result>18446744073709551615n)unsupported(value,offset,'The source time is outside the supported native timestamp range.')
 return String(result)
}
/** A complete parse is required before any native read. No command is dropped. */
export function compileSpl(expression:string):SplQuery {
 if(!expression.trim()||expression.length>2048||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(expression))unsupported('search text',0,'Supply a retained source search of at most 2048 characters without control characters.')
 const pipe=expression.indexOf('|')
 if(pipe<0)unsupported(expression,0,'A terminal stats count command is required.')
 const tail=expression.slice(pipe+1),stats=/^\s*stats\s+count(?:\s+by\s+(service|environment|team))?\s*$/.exec(tail)
 if(!stats)unsupported(tail.trim(),pipe+1,'Only terminal stats count, optionally grouped by one mapped service, environment or team field, is implemented.')
 const head=expression.slice(0,pipe),predicates:SplQuery['predicates']={},seen=new Set<string>()
 let position=0,terms=0,afterAnd=false,index:string|undefined,earliest:string|undefined,latest:string|undefined
 const search=/^\s*search\s+/.exec(head)
 if(search)position=search[0].length
 while(position<head.length){
  const whitespace=/^\s+/.exec(head.slice(position))
  if(whitespace){position+=whitespace[0].length;continue}
  const and=/^AND(?=\s|$)/.exec(head.slice(position))
  if(and){if(!terms||afterAnd)unsupported('AND',position,'AND must join two literal predicates.');position+=3;afterAnd=true;continue}
  const token=/^(index|service|environment|team|earliest|latest)\s*=\s*(?:"([^"\\]*)"|([^\s]+))/.exec(head.slice(position))
  if(!token)unsupported(head.slice(position).trim(),position,'Only one literal index and literal service, environment and team equalities, joined by implicit or explicit AND, are implemented.')
  const [raw,key,quoted,bare]=token,value=quoted??bare
  if(seen.has(key))unsupported(raw,position,'Repeated source fields need explicit source qualification.')
  if(position+raw.length<head.length&&!/\s/.test(head[position+raw.length]))unsupported(raw,position,'Separate source predicates with whitespace.')
  if(key==='earliest'||key==='latest'){
   const ns=epochNanoseconds(value,position)
   if(key==='earliest')earliest=ns;else latest=ns
  }else{
   if(!literal.test(value)||quoted===undefined&&['AND','OR','NOT','IN','AS','BY'].includes(value))unsupported(raw,position,'Only literal scope values are implemented. Wildcards, escapes, expressions and keyword values without quotes require source resolution.')
   if(key==='index')index=value;else predicates[key as ScopeField]=value
  }
  seen.add(key);terms++;afterAnd=false;position+=raw.length
 }
 if(afterAnd)unsupported('AND',Math.max(0,position-3),'AND must join two literal predicates.')
 if(!index)unsupported('index',0,'An explicit source index and reviewed native mapping are required.')
 if(!!earliest!==!!latest)unsupported('earliest and latest',0,'Supply both absolute source time bounds or neither. An unresolved source default time is not executed.')
 if(earliest&&latest&&BigInt(earliest)>=BigInt(latest))unsupported('earliest and latest',0,'The exclusive source latest bound must follow earliest.')
 return {index,predicates,...(stats[1]?{groupBy:stats[1] as ScopeField}:{}),...(earliest?{earliest,latest}: {})}
}
