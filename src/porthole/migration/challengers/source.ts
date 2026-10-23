import type {Json} from '../../../modules/import-kit/src/types.ts'
import {readCollections} from '../splunk/source'
export const challengerCollections:Record<string,readonly string[]>={
 dash0:['dashboards','checkRules','openSLO','history'],
 signoz:['dashboards','alerts','history'],
 clickstack:['savedSearches','sources','dashboards','alerts','history'],
 honeycomb:['boards','queries','triggers','slos','history'],
 resolve:['investigations','knowledge','issues','connectors','history'],
 cleric:['investigations','knowledge','issues','connectors','history'],
 traversal:['investigations','knowledge','issues','connectors','history'],
}
export const parseChallenger=(vendor:string)=>(value:Json,index:number)=>readCollections(value,index,vendor,challengerCollections[vendor])
