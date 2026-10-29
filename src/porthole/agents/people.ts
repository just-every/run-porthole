import { authConfig, operatorAuth, type Bindings } from '../../auth.server'
import { operatorAuthPeople, type PeopleAdapter, type Person } from '../../modules/agent-door/index.ts'
import { memberFor } from '../security/authority'

export function people(env:Bindings):PeopleAdapter {
 const base=operatorAuthPeople({db:env.DB,allowList:authConfig(env).allowList,session:request=>operatorAuth(env).getSession(request)})
 const admitted=async(person:Person|null)=>{
  if(!person)return null
  const member=await memberFor(env.DB,person.id)
  const binding=member?await base.businessMember!(person):null
  return member?{...person,role:member.role,policyRole:binding?.role??(person.role==='owner'?'owner':null)}:null
 }
 return {...base,
  person:async id=>admitted(await base.person(id)),
  sponsor:async claims=>admitted(await base.sponsor(claims)),
  session:async request=>admitted(await base.session(request)),
  // A native promotion never creates a Business policy editor. Native owner
  // controls remain available for an independently operated installation.
  businessRole:person=>(person as Person&{policyRole?:'owner'|'editor'|null}).policyRole??null,
 }
}
