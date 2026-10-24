import {filter,reject,type ParsedExpression,type Parameters} from './model'

/** Selector exploration returns retained samples; it is not an instant or
 * range evaluation of Prometheus series, lookback or staleness. */
export function promql(expression:string):ParsedExpression {
 const match=/^\s*([a-zA-Z_:][a-zA-Z0-9_:]{0,119})?\s*(?:\{([^{}]*)\})?\s*$/.exec(expression)
 if(!match||!match[1]&&match[2]===undefined)reject('unsupported_promql_expression','Use one bare metric selector. Aggregation, range selectors and evaluation functions are not implemented.')
 const parameters:Parameters={signal:'metrics'}
 if(match[1]) {
  if(['bool','on','ignoring','group_left','group_right'].includes(match[1]))reject('unsupported_promql_expression','Use the __name__ equality matcher for reserved metric names.')
  filter(parameters,'metric',match[1])
 }
 if(match[2]?.trim()) {
  const labels=match[2].split(',')
  if(labels.length>4)reject('unsupported_promql_expression','Select one metric and at most three exact scope labels.')
  for(const label of labels) {
   const pair=/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"([^"\\\r\n]*)"\s*$/.exec(label)
   if(!pair)reject('unsupported_promql_expression','Only unescaped double-quoted equality matchers are supported.')
   filter(parameters,pair[1]==='__name__'?'metric':pair[1],pair[2])
  }
 }
 if(!parameters.metric)reject('metric_selection_required','Select one metric identifier or provide one __name__ equality matcher.')
 return {parameters}
}
