import {filter,reject,type ParsedExpression,type Parameters,type Aggregate} from './model'

export function sql(expression:string):ParsedExpression {
 const statement=/^\s*SELECT\s+(COUNT\s*\(\s*\*\s*\)|AVG\s*\(\s*value\s*\)|PERCENTILE_DISC\s*\(\s*0\.95\s*\)\s+WITHIN\s+GROUP\s*\(\s*ORDER\s+BY\s+duration\s*\))\s+FROM\s+(logs|metrics|traces)(?:\s+WHERE\s+([\s\S]+?))?\s*$/i.exec(expression)
 if(!statement)reject('unsupported_sql_expression','Use a documented COUNT, AVG or discrete duration percentile statement with exact equality filters joined by AND.')
 const operation=statement[1].replace(/\s/g,'').toUpperCase(),signal=statement[2].toLowerCase()
 const aggregate:Aggregate=operation==='COUNT(*)'?'count':operation==='AVG(VALUE)'?'average':'p95'
 if(aggregate==='count'&&signal!=='logs'||aggregate==='average'&&signal!=='metrics'||aggregate==='p95'&&signal!=='traces')reject('unsupported_sql_expression','COUNT selects logs, AVG(value) selects metrics, and the duration percentile selects traces.')
 const parameters:Parameters={signal}
 if(statement[3]) {
  // Splitting is deliberately conservative. A separator inside a quoted
  // literal is outside this supported grammar and is rejected in full.
  const conditions=statement[3].split(/\s+AND\s+/i)
  if(conditions.length>4)reject('unsupported_sql_expression','Specify at most four exact equality filters.')
  for(const condition of conditions) {
   const pair=/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'([^'\\\r\n]*)'\s*$/.exec(condition)
   if(!pair)reject('unsupported_sql_expression','Only unescaped single-quoted equality filters joined by AND are supported.')
   const key=pair[1].toLowerCase()
   if(key==='metric'&&signal!=='metrics')reject('conflicting_query_filter','The metric filter applies only to metrics.','metric')
   filter(parameters,key,pair[2])
  }
 }
 return {parameters,aggregate}
}
