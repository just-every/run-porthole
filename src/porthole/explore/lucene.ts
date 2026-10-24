import {filter,reject,type ParsedExpression,type Parameters} from './model'

export function lucene(expression:string):ParsedExpression {
 const tokens=expression.trim().split(/\s+/)
 if(tokens.length>5)reject('unsupported_lucene_expression','Use at most three exact scope terms, optionally joined by AND.')
 const parameters:Parameters={signal:'logs'}
 let previousTerm=false,terms=0
 for(const token of tokens) {
  if(token==='AND') {
   if(!previousTerm)reject('unsupported_lucene_expression','AND must join two exact scope terms.')
   previousTerm=false;continue
  }
  const pair=/^(service|environment|team):([a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119})$/.exec(token)
  if(!pair)reject('unsupported_lucene_expression','Only exact service, environment and team terms are implemented; body phrases, exclusions and wildcards are unsupported.')
  filter(parameters,pair[1],pair[2]);previousTerm=true;terms++
 }
 if(!previousTerm||!terms)reject('unsupported_lucene_expression','Use one or more exact scope terms.')
 return {parameters}
}
