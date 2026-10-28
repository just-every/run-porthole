import {monitorDefinition} from '../monitors/model'
import { fail } from '../security/authority'
const label=(value:unknown)=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value) ? value:fail('invalid_definition',400)
const record=(value:unknown):Record<string,unknown>=>value!==null && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:fail('invalid_definition',400)
export function validateBody(kind:string,raw:unknown):Record<string,unknown> {
 const body=record(raw)
 if(kind==='monitor') {
  monitorDefinition(body)
  return {...body}
 }
 if(kind==='repair') {
  if(Object.keys(body).some(key=>!['steps','expiresAt'].includes(key)) || !Array.isArray(body.steps) || !body.steps.length || body.steps.length>20 || !Number.isSafeInteger(body.expiresAt)) fail('invalid_definition',400)
  const steps=(body.steps as unknown[]).map(value=>{const step=record(value);if(Object.keys(step).some(key=>!['kind','target','revision'].includes(key)) || !['restart','rollback'].includes(String(step.kind))) fail('invalid_definition',400);return {kind:step.kind,target:label(step.target),revision:label(step.revision)}})
  return {steps,expiresAt:body.expiresAt}
 }
 return fail('invalid_kind',400)
}
