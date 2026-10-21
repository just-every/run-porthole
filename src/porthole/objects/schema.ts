import { fail } from '../security/authority'
const label=(value:unknown)=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value) ? value:fail('invalid_definition',400)
const record=(value:unknown):Record<string,unknown>=>value!==null && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:fail('invalid_definition',400)
export function validateBody(kind:string,raw:unknown):Record<string,unknown> {
 const body=record(raw)
 if(kind==='monitor') {
  if(Object.keys(body).some(key=>!['signal','operator','threshold','windowSeconds'].includes(key)) || !['logs','metrics','traces'].includes(String(body.signal)) || !['above','below'].includes(String(body.operator)) || typeof body.threshold!=='number' || !Number.isFinite(body.threshold) || !Number.isSafeInteger(body.windowSeconds) || Number(body.windowSeconds)<1 || Number(body.windowSeconds)>86400) fail('invalid_definition',400)
  return {signal:body.signal,operator:body.operator,threshold:body.threshold,windowSeconds:body.windowSeconds}
 }
 if(kind==='repair') {
  if(Object.keys(body).some(key=>!['steps','expiresAt'].includes(key)) || !Array.isArray(body.steps) || !body.steps.length || body.steps.length>20 || !Number.isSafeInteger(body.expiresAt)) fail('invalid_definition',400)
  const steps=(body.steps as unknown[]).map(value=>{const step=record(value);if(Object.keys(step).some(key=>!['kind','target','revision'].includes(key)) || !['restart','rollback'].includes(String(step.kind))) fail('invalid_definition',400);return {kind:step.kind,target:label(step.target),revision:label(step.revision)}})
  return {steps,expiresAt:body.expiresAt}
 }
 return fail('invalid_kind',400)
}
