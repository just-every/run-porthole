import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {fail} from '../security/authority'
import {journalRows,type ErasedBatch} from '../privacy/erasure/journal'
import {configuration,selected,roles,rpc,type Configuration,type Role} from './client'
export async function syncRoleErasure(env:Bindings,config:Configuration,role:Role) {
 const records=await journalRows(env.DB)
 let chunk:ErasedBatch[]=[],ordinals=0
 const flush=async()=>{
  if(!chunk.length)return
  const result=await rpc<{sourceIdentity:string;applied:number}>(env,role,'/v1/erase',{sourceIdentity:config.source_identity,records:chunk})
  if(result.sourceIdentity!==config.source_identity||result.applied!==chunk.length)fail('analytics_erasure_incomplete',503)
  chunk=[];ordinals=0
 }
 // The worker bounds both journal entries and their combined ordinal count.
 // Selective fences merge on receipt, so even one large entry can be split.
 for(const entry of records) {
  if(entry.ordinals===null) {
   if(chunk.length===100)await flush()
   chunk.push(entry)
   continue
  }
  for(let offset=0;offset<entry.ordinals.length;) {
   if(chunk.length===100||ordinals===10000)await flush()
   const selection=entry.ordinals.slice(offset,offset+10000-ordinals)
   chunk.push({...entry,ordinals:selection})
   ordinals+=selection.length;offset+=selection.length
  }
 }
 await flush()
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
