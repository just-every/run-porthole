import type {Bindings} from '../../../../auth.server'
import {AuthError} from '../../../../modules/operator-auth/index.mjs'
import {privateHeaders} from '../../../document'
import {IntakeError} from '../../../ingest/model'
import {fail} from '../../../security/authority'
import {input,text} from '../../../security/input'
import {migrationOwner} from '../../authority'
import {sourceRecord,fenceSourceRecords,type MigrationRecord} from '../../historical'
import {compileSpl,SplUnsupported} from './compile'
import {reviewedMapping,mappedRange,countMappedLogs} from './mapping'
import {readMappedLogs} from './read'
export async function migrationLogSearch(request:Request,env:Bindings):Promise<Response>{
 let sourceRow:MigrationRecord|undefined
 try{
  if(request.method!=='POST')fail('method_not_allowed',405)
  const predicate=await migrationOwner(request,env),data=await input(request)
  if(Object.keys(data).some(key=>!['targetId','targetRevision','mapping','from','through'].includes(key)))fail('invalid_log_search_input',400)
  const row=await sourceRecord(env,predicate,text(data.targetId,500),['logSearches'],text(data.targetRevision,100)),source=JSON.parse(row.body)
  sourceRow=row
  const definition=source.definition as Record<string,unknown>
  if(source.vendor!=='splunk'||!definition||typeof definition.query!=='string')fail('spl_source_search_required',422)
  const query=compileSpl(definition.query),mapping=reviewedMapping(data.mapping,query),range=mappedRange(data,definition,query)
  const native=await readMappedLogs(request,env,mapping,{from:range.from,through:range.through})
  if('response'in native)return native.response!
  const rows=countMappedLogs(native.records,query,mapping)
  await fenceSourceRecords(request,env,[row])
  // Preserve the initial session generation and exact owner revision as well as
  // the fresh proof and source body checked immediately above.
  const live=await sourceRecord(env,predicate,row.id,['logSearches'],row.revision)
  if(live.body!==row.body)fail('source_replay_stale',409)
  return Response.json({sourceId:definition.id,sourceRevision:row.revision,sourceText:definition.query,sourceDefinition:definition,plan:query,mapping,mappingReview:{owner:predicate.email,targetId:row.id,targetRevision:row.revision,authority:'current-native-owner'},range,rows,selectedRecords:native.records.length,snapshot:native.snapshot,queryRefs:native.queryRefs,queryRef:native.queryRefs[0],coverage:native.records.length?'complete-native-window':'no-native-data',sourceComparison:{state:'unqualified',reason:'No authorized source result capture has been compared. Native counts qualify only the complete selected native window and reviewed scope mapping.'},cutover:'blocked',notifications:'inactive'}, {headers:privateHeaders})
 }catch(error){
  if(error instanceof SplUnsupported&&sourceRow){try{await fenceSourceRecords(request,env,[sourceRow])}catch(fenced){error=fenced}}
  if(error instanceof SplUnsupported)return Response.json({error:'unqualified_spl',construct:error.construct,offset:error.offset,detail:error.message,cutover:'blocked'},{status:422,headers:privateHeaders})
  const failure=error,known=failure instanceof AuthError||failure instanceof IntakeError
  return Response.json({error:known?failure.code:'spl_native_search_unavailable'},{status:known?failure.status:503,headers:privateHeaders})
 }
}
