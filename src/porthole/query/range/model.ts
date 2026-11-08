import {reject} from '../../explore/model'
import {nano} from '../../ingest/model'
export const rangeKeys=['mode','start','end','step','lookback','groupBy','aggregation']
export interface RangePlan {start:string;end:string;step:number;lookback:number;groupBy:string[];aggregation:'sum'|'average'|'min'|'max'}
export function rangePlan(data:Record<string,unknown>):RangePlan|undefined {
 const present=rangeKeys.some(key=>data[key]!==undefined&&data[key]!=='')
 if(!present||data.mode==='records'&&!rangeKeys.slice(1).some(key=>data[key]!==undefined&&data[key]!==''))return
 if(data.mode!=='range'||data.signal!=='metrics'||!data.metric||data.dialect!==undefined&&data.dialect!=='visual')reject('invalid_metric_range','Choose a visual metrics range and one exact metric.','mode')
 if(['from','through','cursor','limit','trace','record'].some(key=>data[key]!==undefined&&data[key]!==''))reject('invalid_metric_range','Range mode uses start and end, with no record pagination.','start')
 let start:string,end:string
 try{start=nano(data.start);end=nano(data.end)}catch{reject('invalid_metric_range','Start and end must be unsigned Unix nanoseconds.','start')}
 if(start>end)reject('invalid_metric_range','End must be at least start.','end')
 const seconds=(key:string)=>{const value=data[key];if(!['string','number'].includes(typeof value)||!/^\d+$/.test(String(value)))reject('invalid_metric_range','Step and lookback require whole seconds from 1 to 86400.',key);const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>86400)reject('invalid_metric_range','Step and lookback require whole seconds from 1 to 86400.',key);return n}
 const step=seconds('step'),lookback=seconds('lookback')
 if((BigInt(end)-BigInt(start))/(BigInt(step)*1000000000n)>=1000n)reject('metric_range_limit','Use at most 1000 evaluation instants.','step')
 if(typeof data.groupBy!=='string')reject('invalid_metric_range','Declare group labels as a comma-separated list, or an empty list.','groupBy')
 const groupBy=data.groupBy===''?[]:data.groupBy.split(',').map(key=>key.trim())
 if(groupBy.length>8||new Set(groupBy).size!==groupBy.length||groupBy.some(key=>!(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,119}$/).test(key)))reject('invalid_metric_range','Use at most eight distinct attribute or scope label names.','groupBy')
 if(!['sum','average','min','max'].includes(String(data.aggregation)))reject('invalid_metric_range','Choose sum, average, min or max.','aggregation')
 return {start,end,step,lookback,groupBy,aggregation:data.aggregation as RangePlan['aggregation']}
}
