import {operatorMail} from '../../mail.server.mjs'
import type {MailMessage} from '../../modules/operator-auth/index.mjs'
import type {HealthBindings} from '../health/model'

export const independentMailConfigured=(env:HealthBindings)=>['resend','sendgrid'].includes(env.MAIL_PROVIDER??'') && !!env.MAIL_API_KEY && !!env.MAIL_FROM
export function frozenNotice(env:HealthBindings,id:string,recipient:string,subject:string,text:string):string {
 const message:MailMessage={deliveryId:`porthole-health/${id}`,from:env.MAIL_FROM??'',to:[recipient],subject:`${subject} [${id}]`,text,html:'<p>Porthole pipeline coverage changed. Sign in to inspect Pipeline health. This notice authorizes no repair.</p>',headers:{'Auto-Submitted':'auto-generated','X-Porthole-Notice':id}}
 return JSON.stringify({provider:env.MAIL_PROVIDER??'development',message})
}
export async function submitNotice(env:HealthBindings,frozen:string,recipient:string) {
 const value=JSON.parse(frozen) as {provider:string;message:MailMessage}
 if(value.provider!==env.MAIL_PROVIDER || value.message.from!==env.MAIL_FROM || value.message.to.length!==1 || value.message.to[0]!==recipient)throw Error('notice_configuration_changed')
 const sender=operatorMail(env)
 if(!sender)throw Error('notice_transport_unconfigured')
 return sender.send(value.message)
}
