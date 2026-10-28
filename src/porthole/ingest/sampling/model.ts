import { canonical, object, sha256 } from '../model'
import { fail } from '../../security/authority'

export interface SamplingPolicy { team:string;service:string;environment:string;ordinaryPercent:number;slowThresholdMs:number }
export const defaults={ordinaryPercent:10,slowThresholdMs:150}
const label=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value)?value:fail('invalid_sampling_scope',400)
export function policy(value:unknown):SamplingPolicy {
 const d=object(value)
 if(Object.keys(d).some(key=>!['team','service','environment','ordinaryPercent','slowThresholdMs'].includes(key)))fail('invalid_sampling_policy',400)
 const ordinaryPercent=d.ordinaryPercent,slowThresholdMs=d.slowThresholdMs
 if(!Number.isSafeInteger(ordinaryPercent)||Number(ordinaryPercent)<0||Number(ordinaryPercent)>100||!Number.isSafeInteger(slowThresholdMs)||Number(slowThresholdMs)<1||Number(slowThresholdMs)>60000)fail('invalid_sampling_policy',400)
 return {team:label(d.team),service:label(d.service),environment:label(d.environment),ordinaryPercent:Number(ordinaryPercent),slowThresholdMs:Number(slowThresholdMs)}
}
export const policyScope=(d:Pick<SamplingPolicy,'team'|'service'|'environment'>)=>({teams:[d.team],services:[d.service],environments:[d.environment]})
/** A stable, source-independent cohort; every ordinary sibling shares a draw. */
export async function cohort(team:string,environment:string,traceId:string):Promise<number> {
 const hash=await sha256(new TextEncoder().encode(canonical([team,environment,traceId])))
 return Number.parseInt(hash.slice(0,8),16)%10000
}
