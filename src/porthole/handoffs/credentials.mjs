// Shared by live handoffs and native archive export. Decode before looking at
// credential names so case and nested percent encoding cannot hide authority.
export function hasHandoffCredentials(value) {
 if(typeof value!=='string')return true
 let decoded=value
 for(let n=0;n<value.length;n++){
  try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next}catch{return true}
 }
 for(const text of [value,decoded]){
  let url;try{url=new URL(text.replace(/\{(service|environment|from|through)\}/g,'synthetic-porthole-1'))}catch{continue}
  if(url.username||url.password)return true
  for(const key of url.searchParams.keys())if(/token|secret|password|credential|auth|key|signature|^sig$|session|cookie/i.test(key))return true
 }
 return /(?:gh[pousr]_|github_pat_|Bearer\s|Basic\s)/i.test(decoded)
}
