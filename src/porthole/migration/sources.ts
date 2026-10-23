import type {ImportMapping} from '../../modules/import-kit/src/types.ts'
import {parseSplunk} from './splunk/source'
import {challengerCollections,parseChallenger} from './challengers/source'
export const sources=['splunk',...Object.keys(challengerCollections)]
export function importSource(name:string){
 if(!sources.includes(name))return null
 const mapping:ImportMapping={version:'source-evidence-v1',map:r=>r.kind==='unsupported'?{effects:[],rejection:'Unsupported export shape. Resolve the named source collection or stable identity before importing.'}:{effects:[{targetKind:r.kind,targetId:`${name}:${r.kind}:${r.sourceId}`,value:r.payload}],unmapped:[{reason:'Source evidence only. Query translation, detector replay, collection and cutover remain blocked pending native qualification.'}]}}
 return {parse:name==='splunk'?parseSplunk:parseChallenger(name),mapping}
}
