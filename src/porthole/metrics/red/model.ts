import { nano, object } from '../../ingest/model'
import { fail } from '../../security/authority'

export function selection(data:Record<string,unknown>) {
 if(Object.keys(data).some(key=>!['scope','from','through','inputStage'].includes(key)))fail('invalid_red_query',400)
 const scope=object(data.scope),keys=['team','service','environment'] as const
 if(Object.keys(scope).some(key=>!keys.includes(key as typeof keys[number])))fail('invalid_red_scope',400)
 for(const key of keys)if(typeof scope[key]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(scope[key])))fail('invalid_red_scope',400)
 const from=nano(data.from),through=nano(data.through),inputStage=data.inputStage??'pre-sampling'
 if(from>=through)fail('invalid_query_range',400)
 if(inputStage!=='pre-sampling'&&inputStage!=='accepted')fail('invalid_red_input_stage',400)
 const team=String(scope.team),service=String(scope.service),environment=String(scope.environment)
 return {team,service,environment,from,through,inputStage,scope:{teams:[team],services:[service],environments:[environment]}}
}
