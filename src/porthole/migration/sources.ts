import type {ImportMapping} from '../../modules/import-kit/src/types.ts'
import {splunkUnmapped} from './splunk/review'
import {parseSplunk} from './splunk/source'
import {challengerCollections,parseChallenger} from './challengers/source'
export const sources=['splunk',...Object.keys(challengerCollections)]
export function importSource(name:string){
 if(!sources.includes(name))return null
 const mapping:ImportMapping={version:name==='splunk'?'splunk-reviewed-source-v2':'source-evidence-v1',map:r=>r.kind==='unsupported'?{effects:[],rejection:r.payload&&typeof r.payload==='object'&&!Array.isArray(r.payload)&&typeof r.payload.reason==='string'?r.payload.reason:'Unsupported export shape. Resolve the named source collection or stable identity before importing.'}:{effects:[{targetKind:r.kind,targetId:`${name}:${r.kind}:${r.sourceId}`,value:r.payload}],unmapped:[...(name==='splunk'?splunkUnmapped(r.payload):[]),{reason:'Source evidence only. Query translation, detector replay, collection and cutover remain blocked pending native qualification.'}]}}
 return {parse:name==='splunk'?parseSplunk:parseChallenger(name),mapping}
}
