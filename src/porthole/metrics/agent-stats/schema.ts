import { array, invalid, object } from '../../ingest/model'

// Published Datadog StatsPayload schema, including its ProtoJSON field aliases:
// https://github.com/DataDog/datadog-agent/blob/dfa5e6a2108191cd666e03f640439ad53e995a3d/pkg/proto/datadog/trace/stats.proto
// The Agent's production writer uses gzip MessagePack. This door deliberately
// accepts the official schema's JSON representation; PORT-062 owns broader wire parity.
type Kind = 'string' | 'uint64' | 'int64' | 'uint32' | 'bool' | 'bytes' | 'strings' | 'messages' | 'trilean'
type Schema = Record<string, Kind>
export const payloadSchema: Schema = { agentHostname:'string',agentEnv:'string',stats:'messages',agentVersion:'string',clientComputed:'bool',splitPayload:'bool' }
export const clientSchema: Schema = { hostname:'string',env:'string',version:'string',stats:'messages',lang:'string',tracerVersion:'string',runtimeID:'string',sequence:'uint64',agentAggregation:'string',service:'string',containerID:'string',tags:'strings',git_commit_sha:'string',image_tag:'string',process_tags_hash:'uint64',process_tags:'string' }
export const bucketSchema: Schema = { start:'uint64',duration:'uint64',stats:'messages',agentTimeShift:'int64' }
export const groupSchema: Schema = { service:'string',name:'string',resource:'string',HTTP_status_code:'uint32',type:'string',DB_type:'string',hits:'uint64',errors:'uint64',duration:'uint64',okSummary:'bytes',errorSummary:'bytes',synthetics:'bool',topLevelHits:'uint64',span_kind:'string',peer_tags:'strings',is_trace_root:'trilean',GRPC_status_code:'string',HTTP_method:'string',HTTP_endpoint:'string',service_source:'string',span_derived_primary_tags:'strings',additional_metric_tags:'strings' }

const camel = (name:string) => name.replace(/_([a-z])/g,(_match,letter:string)=>letter.toUpperCase())
function text(value:unknown):string {
 if(typeof value!=='string'||value.length>8192)return invalid('invalid_agent_stats_string')
 return value
}
function integer(value:unknown,signed=false):string {
 if(typeof value==='number'&&!Number.isSafeInteger(value))return invalid('agent_stats_integer_precision_required')
 if(typeof value!=='number'&&typeof value!=='string')return invalid('invalid_agent_stats_integer')
 const encoded=String(value)
 if(!/^-?(0|[1-9][0-9]{0,19})$/.test(encoded))return invalid('invalid_agent_stats_integer')
 const n=BigInt(encoded)
 if(n<(signed?-9223372036854775808n:0n)||n>(signed?9223372036854775807n:18446744073709551615n))return invalid('agent_stats_integer_out_of_range')
 return n.toString()
}
/** Reject unknown fields instead of silently interpreting a future schema.
 * Go JSON field spelling and standard ProtoJSON spelling are both accepted.
 * The Pascal spellings match the exported Go fields; ambiguous aliases refuse. */
export function message(value:unknown,schema:Schema):Record<string,unknown> {
 const input=object(value),result:Record<string,unknown>={},aliases=new Map<string,string>()
 for(const name of Object.keys(schema)) {
  const jsonName=camel(name)
  for(const alias of [name,jsonName,name[0].toUpperCase()+name.slice(1),jsonName[0].toUpperCase()+jsonName.slice(1)])aliases.set(alias,name)
 }
 // These initialisms are exported differently by protoc's Go generator.
 for(const [alias,name] of [['HTTPStatusCode','HTTP_status_code'],['DBType','DB_type'],['GRPCStatusCode','GRPC_status_code'],['HTTPMethod','HTTP_method'],['HTTPEndpoint','HTTP_endpoint']] as const)if(name in schema)aliases.set(alias,name)
 for(const [raw,entry] of Object.entries(input)) {
  const key=aliases.get(raw)
  if(!key)return invalid('unsupported_agent_stats_field',415)
  if(Object.hasOwn(result,key))return invalid('ambiguous_agent_stats_field')
  const kind=schema[key]
  if(kind==='string')result[key]=text(entry)
  else if(kind==='uint64'||kind==='int64')result[key]=integer(entry,kind==='int64')
  else if(kind==='uint32') {
   const n=BigInt(integer(entry));if(n>4294967295n)return invalid('agent_stats_integer_out_of_range')
   result[key]=Number(n)
  }else if(kind==='bool') {
   if(typeof entry!=='boolean')return invalid('invalid_agent_stats_boolean')
   result[key]=entry
  }else if(kind==='bytes') {
   if(typeof entry!=='string'||entry.length>1024*1024||!/^[A-Za-z0-9+/_-]*={0,2}$/.test(entry))return invalid('invalid_agent_stats_summary')
   try {result[key]=btoa(atob(entry.replaceAll('-','+').replaceAll('_','/')))}catch{return invalid('invalid_agent_stats_summary')}
  }else if(kind==='trilean') {
   const n=typeof entry==='string'?['NOT_SET','TRUE','FALSE'].indexOf(entry):entry
   if(n!==0&&n!==1&&n!==2)return invalid('unsupported_agent_stats_trilean',415)
   result[key]=n
  }else {
   const items=array(entry)
   if(items.length>(kind==='strings'?128:5000))return invalid('agent_stats_repeated_field_limit',413)
   result[key]=kind==='strings'?items.map(text):items
  }
 }
 return result
}
