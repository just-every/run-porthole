import type { MailSender } from './modules/operator-auth/index.mjs'
import type { Bindings } from './auth.server'
export function operatorMail(env: Bindings, dependencies?: { fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }): MailSender | undefined
