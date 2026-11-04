/** SQL samples are structure only. Quoted atoms, comments, numeric literals and
 * bind values never survive. An unrecognized lexical form withholds the sample. */
export function fingerprint(sql) {
 if(typeof sql!=='string'||sql.length>32768)return '[sample withheld]'
 let i=0,out=''
 while(i<sql.length){
  const tail=sql.slice(i),c=sql[i]
  if(tail.startsWith('--')||c==='#'){const end=sql.indexOf('\n',i);i=end<0?sql.length:end;out+=' ';continue}
  if(tail.startsWith('/*')){let depth=1;i+=2;while(i<sql.length&&depth){if(sql.slice(i,i+2)==='/*'){depth++;i+=2}else if(sql.slice(i,i+2)==='*/'){depth--;i+=2}else i++}if(depth)return '[sample withheld]';out+=' ';continue}
  const dollar=/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(tail)
  if(dollar){const end=sql.indexOf(dollar[0],i+dollar[0].length);if(end<0)return '[sample withheld]';i=end+dollar[0].length;out+='?';continue}
  if(/["'`]/.test(c)){const quote=c;i++;let closed=false;while(i<sql.length){if(sql[i]==='\\'){i+=2;continue}if(sql[i]===quote){if(sql[i+1]===quote){i+=2;continue}i++;closed=true;break}i++}if(!closed)return '[sample withheld]';out+='?';continue}
  const bind=/^\$[0-9]+/.exec(tail),number=/^(?:0x[0-9a-fA-F]+|0b[01]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?)/i.exec(tail)
  if(bind){i+=bind[0].length;out+='?';continue}
  if(number){i+=number[0].length;out+='?';continue}
  const word=/^[a-zA-Z_][a-zA-Z0-9_$]*/.exec(tail)
  if(word){out+=word[0].toLowerCase();i+=word[0].length;continue}
  if(!/[\s(),.*+\-/<>=!?%:;[\]|&^~]/.test(c))return '[sample withheld]'
  out+=c;i++
 }
 return out.replace(/\s+/g,' ').replace(/\s*;\s*$/,'').trim().slice(0,4096)
}
/** Execution plans expose only operator kinds and numeric estimates. Engine
 * expressions, constants, object names and diagnostic text are withheld. */
export function structuralPlan(plan,engine) {
 const output=[]
 function walk(value,depth=0){
  if(!value||typeof value!=='object'||depth>24||output.length>=64)return
  if(Array.isArray(value)){for(const v of value)walk(v,depth+1);return}
  const kind=value['Node Type']??value.access_type
  if(typeof kind==='string'&&/^[a-zA-Z_ ]{1,64}$/.test(kind)){
   const row={operator:kind}
   for(const [native,key]of engine==='postgresql'?[['Plan Rows','estimatedRows'],['Total Cost','estimatedCost'],['Plan Width','estimatedWidth']]:[['rows_examined_per_scan','estimatedRows'],['rows_produced_per_join','estimatedOutputRows']])if(Number.isFinite(Number(value[native])))row[key]=Number(value[native])
   output.push(row)
  }
  for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,depth+1)
 }
 walk(plan);return output
}

export function reviewedPlans(value) {
 if(!Array.isArray(value)||value.length>4)throw Error('invalid_reviewed_plans')
 return value.map(sql=>{
  if(typeof sql!=='string'||sql.length>512||!/^SELECT (?:count\(\*\)|[a-z_][a-z0-9_]*(?:, [a-z_][a-z0-9_]*)*) FROM [a-z_][a-z0-9_]* WHERE [a-z_][a-z0-9_]* = \?$/i.test(sql))throw Error('invalid_reviewed_plans')
  return sql.toLowerCase()
 })
}
