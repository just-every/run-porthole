export type LogSearchScalar = string | number | boolean
export type LogSearchTerm = {op:'term';field:string} & (
 | {operator:'eq';value:LogSearchScalar}
 | {operator:'glob';value:string}
 | {operator:'exists'}
 | {operator:'gt'|'gte'|'lt'|'lte';value:number}
 | {operator:'range';lower:number|null;upper:number|null;includeLower:boolean;includeUpper:boolean}
)
export type LogSearchNode = LogSearchTerm | {op:'and'|'or';children:LogSearchNode[]} | {op:'not';child:LogSearchNode}
export interface LogSearchPlan {version:1;root:LogSearchNode}
export interface LogSearchScope {services:string[];environments:string[];teams:string[]}
export class LogSearchError extends Error {
 code:string
 status:number
 field:string
 hint:string
 constructor(code:string,hint:string,field?:string,status?:number)
}
export function parseLogSearch(expression:string):LogSearchPlan
export function validateLogSearch(plan:unknown):LogSearchPlan
export function compileLogSearch(plan:unknown,scope?:LogSearchScope):{sql:string;args:(string|number)[]}
