import { rejectedResponse } from './base/rejected-response'
import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig, AuthError } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'
import { identity } from './identity'
import { asFrame, homeDocument, withBar } from './ui/document.server'
import { homeViews, settingsPath } from './ui/home'
import { productAuth, rolePolicy, guardNativeRequest } from './porthole/membership/auth'
import { settingsNav } from './porthole/membership/page'
import { document } from './porthole/document'
import { observeHealth } from './porthole/health/observe'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 ANALYTICS_PRIMARY?: Fetcher
 ANALYTICS_STANDBY?: Fetcher
 ANALYTICS_PRIMARY_URL?: string
 ANALYTICS_STANDBY_URL?: string
 ANALYTICS_PRIMARY_TOKEN?: string
 ANALYTICS_STANDBY_TOKEN?: string
 DB: D1Database
 ARCHIVE_BUCKET?: R2Bucket
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_BUSINESS_TRUST?: string
 RER_DEMO?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 OWNER_EMAIL: string
 INSTALLATION_KEY: string
 INSTALLATION_KEY_PREVIOUS?: string
 SESSION_SECRET: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'rer' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_RELAY_URL?: string
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function baseOperatorAuth(env: Bindings) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), rolePolicy: rolePolicy(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}
export function operatorAuth(env: Bindings) { return productAuth(env, baseOperatorAuth(env)) }

const settingsUnavailable = (status: number) => document('Settings unavailable','<p role="alert">Settings cannot be read right now. Try again or contact the installation owner.</p><p><a href="/app/settings/members">Try again</a></p>',status)

const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }

async function handleAuthResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 if(url.pathname==='/app/health/confirm')return null
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 if (url.pathname === '/auth/owner-claim') {
  // Managed installations and disposable verification share the signed owner
  // claim lifecycle. Unpaired installations retain identity-provider admission.
  if (env.RER_OWNER_CLAIM_PUBLIC_KEYS) {
   const claim = await createOwnerClaimHandler({
    db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '',
    issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '',
    appOrigin: env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS),
   })(request)
   return claim && asFrame(claim)
  }
  return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 }
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(operatorAuth(env), {
   defaultReturnTo: '/setup',
  })(request)
  if (page) return withBar((await fontDocumentResponse(page))!)
 }
 // Base's auth documents wear the app's bar: sign-in settings (the owner's) with the views and the person, the
 // link confirmations with the lockup alone.
 if (url.pathname.startsWith('/auth/')) {
  try { await guardNativeRequest(request,env) } catch (error) {
   const failure=error as {code?:string;status?:number}
   return Response.json({error:failure.code??'auth_unavailable'},{status:failure.status??503,headers:privateHeaders})
  }
  let response = await fontDocumentResponse(await createAuthHandler(operatorAuth(env))(request))
  if (!response || url.pathname !== settingsPath || response.status !== 200) return response && withBar(response)
  if (response.headers.get('content-type')?.startsWith('text/html')) { const html=await response.text();response=new Response(html.replace('</main>',settingsNav+'</main>'),response) }
  const session = await operatorAuth(env).getSession(request)
  return withBar(response, session ? { viewer: session.operator, views: homeViews(session.operator, settingsPath) } : {})
 }
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) {
   if(url.pathname.startsWith('/app/settings') && setup.status>=500) return settingsUnavailable(setup.status)
   if (url.pathname !== '/setup' || setup.status !== 200) return setup
   const state=await observeHealth(env)
   const coverage=state.configuration.noticesEnabled?'Independent notices enabled — recipient confirmed.':'Independent notices off — incomplete coverage. Confirm a recipient in Pipeline health after setup.'
   const covered=new Response((await setup.text()).replace('</main>',`<section aria-label="Pipeline coverage"><h2>Pipeline coverage</h2><p role="status">${coverage}</p><p>Finishing owner setup does not establish production observability coverage.</p></section></main>`),setup)
   const session = await operatorAuth(env).getSession(request)
   return withBar(covered, session ? { viewer: session.operator, home: '/setup' } : {})
  }
 }
 if (url.pathname === '/app') {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/signin' } })
  return homeDocument(session.operator, identity.runSite)
 }
 return null
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 try {
  const response = await handleAuthResponse(request, original)
  return response ? rejectedResponse(request, response) : null
 } catch(error) {
  const status=error instanceof AuthError?error.status:503
  if(new URL(request.url).pathname.startsWith('/app/settings')) return settingsUnavailable(status)
  return rejectedResponse(request,Response.json({error:error instanceof AuthError?error.code:'auth_unavailable'},{status,headers:privateHeaders}))
 }
}
