import {LogSearchError,parseLogSearch,type LogSearchNode} from '../../../workers/analytics/log-search.mjs'
import {filter,reject,type ParsedExpression,type Parameters} from './model'

export function lucene(expression:string):ParsedExpression {
 try {
  const logSearch=parseLogSearch(expression),parameters:Parameters={signal:'logs'}
  const exactScopes=(node:LogSearchNode):void=>{
   if(node.op==='and')node.children.forEach(exactScopes)
   else if(node.op==='term'&&node.operator==='eq'&&['service','environment','team'].includes(node.field)&&typeof node.value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(node.value))filter(parameters,node.field,node.value)
  }
  exactScopes(logSearch.root)
  return {parameters,logSearch}
 } catch(error) {
  if(error instanceof LogSearchError)reject(error.code,error.hint,error.field)
  throw error
 }
}
