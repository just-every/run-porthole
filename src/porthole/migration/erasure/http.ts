import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {privateHeaders} from '../../document'
import {input} from '../../security/input'
import {fail} from '../../security/authority'
import {erasureOwner} from './authority'
import {applyErasure} from './apply'
import {inventory,selection} from './inventory'
import {applyJournal,journalFormat,readJournal} from './journal'

const root='/api/porthole/v1/migration/erasure'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function migrationErasureResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(![root,root+'/apply',root+'/journal'].includes(url.pathname))return null
 try{
  if(url.search||url.hash)fail('invalid_import_erasure_request',400)
  if(request.method!=='POST'&&!(url.pathname===root+'/journal'&&request.method==='GET'))fail('method_not_allowed',405)
  const predicate=await erasureOwner(request,env)
  const authorized=async(epoch?:number)=>env.DB.batch([env.DB.prepare(`SELECT CASE WHEN (${predicate.sql})${epoch===undefined?'':' AND (SELECT revision FROM porthole_migration_erasure_state WHERE singleton=1)=?'} THEN 1 ELSE json('IMPORT_ERASURE_INVENTORY_CHANGED') END`).bind(...predicate.params??[],...epoch===undefined?[]:[epoch])])
  if(url.pathname===root+'/journal'){
   if(request.method==='POST')return json(await applyJournal(env.DB,predicate,await input(request)))
   const records=await readJournal(env.DB);await authorized();return json({format:journalFormat,records})
  }
  const data=await input(request)
  if(url.pathname===root+'/apply')return json(await applyErasure(env,predicate,data))
  if(Object.keys(data).sort().join(',')!=='id,kind,revision')fail('invalid_import_erasure_request',400)
  const preview=await inventory(env.DB,selection(data));await authorized(preview.revision);return json(preview)
 }catch(error){
  if(error instanceof AuthError)return json({error:error.code},error.status)
  const message=error instanceof Error?error.message:''
  if(/IMPORT_ERASURE_INVENTORY_CHANGED/.test(message))return json({error:'import_erasure_inventory_changed'},409)
  if(/IMPORT_(D1_(REQUEST|TRANSPORT|STATEMENT|VALUE)_LIMIT|ERASURE_SHARED_SOURCE)/.test(message))return json({error:'import_erasure_inventory_requires_smaller_operation'},413)
  return json({error:'import_erasure_refused'},409)
 }
}
