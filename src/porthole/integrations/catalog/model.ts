import declarations from './packs.json'
import {fail,scopeWithin,type Scope} from '../../security/authority'
export const packs=declarations
export interface Binding {id:string;pack:string;service:string;environment:string;team:string;credential_id:string|null;dashboard_id:string|null;state:string;revision:number;created_at:number;owner_id:string}
export const columns=['id','pack','service','environment','team','credential_id','dashboard_id','state','revision','created_at','owner_id']
export const bindingScope=(b:Pick<Binding,'service'|'environment'|'team'>):Scope=>({services:[b.service],environments:[b.environment],teams:[b.team]})
export const packFor=(id:string)=>packs.find(p=>p.id===id)??fail('integration_pack_not_found',404)
export function validateBinding(row:Record<string,unknown>) {
 packFor(String(row.pack))
 for(const key of ['id','owner_id'])if(!/^[a-f0-9-]{36}$/.test(String(row[key])))fail('invalid_integration_binding',422)
 for(const key of ['service','environment','team'])if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(String(row[key])))fail('invalid_integration_binding',422)
 if(row.credential_id!==null||row.dashboard_id!==null&&!/^[a-f0-9-]{36}$/.test(String(row.dashboard_id))||!['enabled','quarantined'].includes(String(row.state))||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||!Number.isSafeInteger(row.created_at))fail('invalid_integration_binding',422)
}
export function visible(b:Binding,scope:Scope){return scopeWithin(bindingScope(b),scope)}
