import { array, canonical, invalid, nano, type TelemetryRecord } from '../../ingest/model'
import { record } from '../../ingest/normalize'
import { bucketSchema, clientSchema, groupSchema, message, payloadSchema } from './schema'

export const agentStatsMetric = 'datadog.agent.full_traffic'
export const agentStatsProtocol = 'datadog.StatsPayload/v0.2/json'
const str=(value:unknown)=>typeof value==='string'?value:''
/** One metric record per official grouped bucket. No trace is synthesized and
 * these aggregate counters never enter custom span-derived metric rules. */
export function agentStatsRecords(value:Record<string,unknown>,headers:Headers):TelemetryRecord[] {
 const payload=message(value,payloadSchema),result:TelemetryRecord[]=[]
 let normalizedBytes=2
 if(!Object.hasOwn(payload,'stats'))return invalid('agent_stats_payload_required')
 for(const clientInput of array(payload.stats)) {
  const client=message(clientInput,clientSchema)
  for(const bucketInput of array(client.stats??[])) {
   const bucket=message(bucketInput,bucketSchema),start=str(bucket.start),duration=str(bucket.duration)
   if(!start||!duration||BigInt(duration)===0n)return invalid('invalid_agent_stats_bucket')
   const end=BigInt(start)+BigInt(duration)
   if(end>18446744073709551615n)return invalid('invalid_agent_stats_bucket')
   for(const groupInput of array(bucket.stats??[])) {
    const group=message(groupInput,groupSchema)
    const hits=str(group.hits)||'0',errors=str(group.errors)||'0',totalDuration=str(group.duration)||'0',topLevelHits=str(group.topLevelHits)||'0'
    if(BigInt(errors)>BigInt(hits)||BigInt(topLevelHits)>BigInt(hits))return invalid('inconsistent_agent_stats_counts')
    const service=str(group.service)||str(client.service),environment=str(client.env)||str(payload.agentEnv)
    // Envelope metadata shared with other services is deliberately not copied.
    // Every retained group contains only its own scoped dimensions and stats.
    const entry=record({
     metric:{name:agentStatsMetric,unit:'ns',temporality:'delta'},metricKind:'agentStats',
     record:{...group,hits,errors,duration:totalDuration,topLevelHits,timeUnixNano:start},
     agentStats:{protocol:agentStatsProtocol,schemaSource:'dfa5e6a2108191cd666e03f640439ad53e995a3d',
      bucket:{start:nano(start),duration,end:nano(end.toString()),agentTimeShift:bucket.agentTimeShift??'0'},
      agentVersion:payload.agentVersion??'',clientComputed:payload.clientComputed??false,splitPayload:payload.splitPayload??false,
      runtimeID:client.runtimeID??'',sequence:client.sequence??'0',version:client.version??'',lang:client.lang??'',tracerVersion:client.tracerVersion??'',agentAggregation:client.agentAggregation??'',
      input:'source-asserted-full-traffic',independentlyVerified:false,ordinaryTraceSamplingApplied:false,
      latencySketch:{encoding:'base64-protobuf-ddsketch',ok:group.okSummary??'',error:group.errorSummary??'',quantilesAvailable:false}},
    },{'service.name':service||headers.get('x-porthole-service')||'','deployment.environment.name':environment||headers.get('x-porthole-environment')||''},start,headers,'metrics')
    normalizedBytes+=new TextEncoder().encode(canonical(entry)).length+1
    if(result.length>=5000)return invalid('too_many_records',413)
    if(normalizedBytes>1024*1024)return invalid('normalized_batch_too_large',413)
    result.push(entry)
   }
  }
 }
 return result
}
