import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {fail} from '../security/authority'
import {journalRows} from '../privacy/erasure/journal'
import {configuration,selected,roles,rpc,type Configuration,type Role} from './client'
export async function syncRoleErasure(env:Bindings,config:Configuration,role:Role) {
 const records=await journalRows(env.DB)
 for(let index=0;index<records.length;) {
  const chunk=[]
  let ordinals=0
  // The worker bounds both journal entries and their total selected records.
  // A valid entry fits alone; never retry a permanently oversized combination.
  while(index<records.length&&chunk.length<100) {
   const row=records[index],count=row.ordinals?.length??0
   if(chunk.length&&ordinals+count>10000)break
   chunk.push(row);ordinals+=count;index++
  }
  const result=await rpc<{sourceIdentity:string;applied:number}>(env,role,'/v1/erase',{sourceIdentity:config.source_identity,records:chunk})
  if(result.sourceIdentity!==config.source_identity||result.applied!==chunk.length)fail('analytics_erasure_incomplete',503)
 }
}
export async function syncErasure(env:Bindings) {
 const config=await configuration(env)
 if(!selected(env,config))return {complete:true,copies:[]}
 const copies=[]
 for(const role of roles) {
  try{await syncRoleErasure(env,config,role);copies.push({role,status:'erased'})}
  catch(error){copies.push({role,status:'pending',error:error instanceof AuthError?error.code:'analytics_erasure_unavailable'})}
 }
 return {complete:copies.every(row=>row.status==='erased'),copies}
}
