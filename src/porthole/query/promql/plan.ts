import {reject,filter,type Parameters} from '../../explore/model'
const label=/^[a-zA-Z_][a-zA-Z0-9_]*$/
export interface Plan {metric:string;matchers:Record<string,string>;operation:'select'|'rate'|'increase';windowSeconds:number;groupBy?:string[]}
export interface Evaluation {start:string;end:string;stepSeconds:number;lookbackSeconds:number;scanLimit:number;instant:boolean}
export const evaluationKeys=['time','start','end','step','lookback','scanLimit']
export function duration(value:string):number {
 const match=/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/.exec(value.trim())
 if(!match)reject('unsupported_promql_duration','Use one positive duration with ms, s, m, h, d, w or y.')
 const seconds=Number(match[1])*({ms:.001,s:1,m:60,h:3600,d:86400,w:604800,y:31536000}[match[2]]!)
 if(!Number.isFinite(seconds)||!Number.isSafeInteger(seconds*1000)||seconds<=0||seconds>2678400)reject('unsupported_promql_duration','Duration must be positive and at most 31 days.')
 return seconds
}
export function parsePromql(expression:string):Plan {
 let text=expression.trim(),groupBy:string[]|undefined
 const sum=/^sum\s+by\s*\(([^()]*)\)\s*\(([\s\S]*)\)$/.exec(text)
 if(sum) {
  groupBy=sum[1].trim()?sum[1].split(',').map(value=>value.trim()):[]
  if(groupBy.length>16||new Set(groupBy).size!==groupBy.length||groupBy.some(value=>!label.test(value)||value==='__name__'))reject('unsupported_promql_group','Use up to sixteen distinct label names, excluding __name__.')
  text=sum[2].trim()
 }
 let operation:Plan['operation']='select',windowSeconds=0
 const fn=/^(rate|increase)\s*\(([\s\S]*)\)$/.exec(text)
 if(fn) {
  operation=fn[1] as Plan['operation'];text=fn[2].trim()
  const range=/\[([^\[\]]+)\]$/.exec(text)
  if(!range)reject('promql_range_required','Counter evaluation requires a range selector.')
  windowSeconds=duration(range[1]);text=text.slice(0,range.index).trim()
 }
 const selected=/^([a-zA-Z_:][a-zA-Z0-9_:]{0,119})?\s*(?:\{([\s\S]*)\})?$/.exec(text)
 if(!selected||!selected[1]&&selected[2]===undefined)reject('unsupported_promql_expression','Use an exact selector, sum by, rate or increase from the declared scalar subset.')
 if(selected[1]&&['bool','on','ignoring','group_left','group_right'].includes(selected[1]))reject('unsupported_promql_expression','Use an exact __name__ matcher for reserved metric names.')
 let metric=selected[1]??'',tail=selected[2]?.trim()??''
 const matchers:Record<string,string>=Object.create(null)
 while(tail) {
  const pair=/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*("(?:[^"\\\r\n]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*")\s*(,\s*|$)/.exec(tail)
  if(!pair||Object.hasOwn(matchers,pair[1])||Object.keys(matchers).length>=16)reject('unsupported_promql_matcher','Use up to sixteen distinct exact equality matchers.')
  const value=JSON.parse(pair[2]) as string
  if(value.length>1024||/[\u0000-\u001f\u007f]/.test(value))reject('unsupported_promql_matcher','Label values must be printable text of at most 1024 characters.')
  matchers[pair[1]]=value;tail=tail.slice(pair[0].length)
 }
 if(matchers.__name__!==undefined) {
  if(metric&&metric!==matchers.__name__)reject('conflicting_query_filter','Metric name and __name__ must agree.')
  metric=matchers.__name__;delete matchers.__name__
 }
 if(!metric||metric.length>120)reject('metric_selection_required','Select exactly one metric name.')
 return {metric,matchers,operation,windowSeconds,...(groupBy===undefined?{}:{groupBy})}
}
export function planParameters(plan:Plan):Parameters {
 const parameters:Parameters={signal:'metrics',metric:plan.metric}
 for(const key of ['service','environment','team'])if(plan.matchers[key]!==undefined&&plan.matchers[key]!=='')filter(parameters,key,plan.matchers[key])
 return parameters
}
function timestamp(value:unknown,key:string):string {
 if(typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>18446744073709551615n)reject('invalid_promql_time','Use decimal Unix nanoseconds as text.',key)
 return BigInt(value).toString()
}
function seconds(value:unknown,fallback:number,key:string,max:number):number {
 const n=value===undefined||value===''?fallback:Number(value)
 if(!Number.isFinite(n)||n<=0||n>max||!Number.isSafeInteger(n*1000))reject('invalid_promql_duration','Use a positive duration in seconds with millisecond precision.',key)
 return n
}
export function evaluation(input:Record<string,unknown>):Evaluation|undefined {
 if(!evaluationKeys.some(key=>input[key]!==undefined&&input[key]!==''))return
 const instant=input.time!==undefined&&input.time!==''
 if(instant&&[input.start,input.end,input.step].some(value=>value!==undefined&&value!==''))reject('conflicting_promql_time','Choose an instant time or a range start, end and step.','time')
 if(!instant&&(input.start===undefined||input.end===undefined||input.step===undefined))reject('promql_time_required','Supply time, or start, end and step.','time')
 const start=timestamp(instant?input.time:input.start,instant?'time':'start'),end=timestamp(instant?input.time:input.end,instant?'time':'end')
 const stepSeconds=seconds(input.step,1,'step',2678400),lookbackSeconds=seconds(input.lookback,300,'lookback',2678400)
 const scanLimit=Number(input.scanLimit??5000)
 if(!Number.isSafeInteger(scanLimit)||scanLimit<1||scanLimit>5000)reject('invalid_promql_scan_limit','Choose a scan limit from 1 to 5000.','scanLimit')
 if(BigInt(start)>BigInt(end)||Number((BigInt(end)-BigInt(start))/(BigInt(stepSeconds*1000)*1000000n))+1>1000)reject('promql_evaluation_budget_exceeded','Select at most 1000 evaluation instants.','step')
 return {start,end,stepSeconds,lookbackSeconds,scanLimit,instant}
}
