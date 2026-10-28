import type { Bindings } from '../../../auth.server'

const attribute=(key:string)=>`(SELECT COALESCE(json_extract(a.value,'$.value.stringValue'),json_extract(a.value,'$.value.intValue'),json_extract(a.value,'$.value.doubleValue')) FROM json_each(j.value,'$.payload.record.attributes') a WHERE json_extract(a.value,'$.key')='${key}' LIMIT 1)`
// Split uint64 timestamps before subtraction: SQLite's signed CAST would clamp
// timestamps above 2^63. Ordinary durations remain exact integer nanoseconds.
const timestamp=(edge:string,offset:number)=>`CAST(substr('00000000000000000000'||json_extract(j.value,'$.payload.record.${edge}TimeUnixNano'),${offset},10) AS INTEGER)`
const duration=`((${timestamp('end',-20)}-${timestamp('start',-20)})*10000000000+${timestamp('end',-10)}-${timestamp('start',-10)})`

/** Include these writes in the processor's original pending->complete batch,
 * before any sampling decision. The batch/ordinal primary key makes replay inert. */
export async function redContributions(env:Bindings,batchId:string):Promise<D1PreparedStatement[]> {
 if(!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_red_points'").first())return []
 return [env.DB.prepare(`INSERT INTO porthole_red_points(batch_id,ordinal,team,service,environment,event_time_ns,input_stage,endpoint,error,duration_ns)
  SELECT b.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.eventTimeNs'),COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted'),
  COALESCE(NULLIF(${attribute('http.route')},''),json_extract(j.value,'$.payload.record.name'),''),
  CASE WHEN json_extract(j.value,'$.payload.record.status.code') IN (2,'STATUS_CODE_ERROR') OR CAST(COALESCE(${attribute('http.response.status_code')},${attribute('http.status_code')}) AS INTEGER) BETWEEN 500 AND 599 OR CAST(${attribute('rpc.grpc.status_code')} AS INTEGER)!=0 THEN 1 ELSE 0 END,
  CASE WHEN ${duration} BETWEEN 0 AND 9007199254740991 THEN ${duration} ELSE NULL END
  FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.id=? AND b.state='pending' AND b.signal='traces' AND COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted') IN ('accepted','pre-sampling')
  ON CONFLICT(batch_id,ordinal) DO NOTHING`).bind(batchId)]
}
