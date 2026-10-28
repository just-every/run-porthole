import {filter,reject,type Parameters} from './model'

export interface JoinPlan {version:1;left:'logs';right:'traces';key:'trace_id';semantics:'retained-same-scope-and-time'}
export interface ParsedJoin {parameters:Parameters;join:JoinPlan}

/** A fixed native correlation grammar. No SQL is passed to a database. */
export function parseJoin(expression:string):ParsedJoin {
 if(typeof expression!=='string'||expression.length>2048||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(expression))reject('invalid_join_expression','Enter one supported join statement of at most 2048 printable characters.')
 const statement=/^\s*SELECT\s+\*\s+FROM\s+logs\s+(?:INNER\s+)?JOIN\s+traces\s+ON\s+logs\.trace_id\s*=\s*traces\.trace_id(?:\s+WHERE\s+([\s\S]+?))?\s*$/i.exec(expression)
 if(!statement)reject('unsupported_join_expression',"Use SELECT * FROM logs JOIN traces ON logs.trace_id = traces.trace_id with optional exact service, environment and team filters joined by AND.")
 const parameters:Parameters={signal:'logs'}
 if(statement[1]) {
  const conditions=statement[1].split(/\s+AND\s+/i)
  if(conditions.length>3)reject('unsupported_join_expression','Specify at most one exact service, environment and team equality.')
  for(const condition of conditions) {
   const pair=/^\s*(service|environment|team)\s*=\s*'([^'\\\r\n]*)'\s*$/i.exec(condition)
   if(!pair)reject('unsupported_join_expression','Join WHERE accepts only unescaped single-quoted service, environment and team equality filters joined by AND.')
   filter(parameters,pair[1].toLowerCase(),pair[2])
  }
 }
 return {parameters,join:{version:1,left:'logs',right:'traces',key:'trace_id',semantics:'retained-same-scope-and-time'}}
}
