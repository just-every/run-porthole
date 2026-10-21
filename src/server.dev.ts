// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the Dev title and name suffix.
import worker from './server'
import { withDevIdentity, type DevPersona } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from './auth.server'
import { devPersonas } from './dev-personas'
import { withDevAi } from './modules/ai/dev/index.mjs'
import { fontLinks } from './base/font-head'
import { asFrame } from './ui/document.server'

// rer dev offers Base's Dev personas. rer demo (RER_DEMO) offers the page's own cast beside its owner, Marcus Reed
// (src/demo.ts): Dana Brooks, the checkout lead who approves the rollback, and Keisha Grant, on call when the monitor
// fired.
const demoPersonas = (): DevPersona[] => [
  { as: 'admin', role: 'admin', displayName: 'Dana Brooks' },
  { as: 'member', role: 'member', displayName: 'Keisha Grant' },
]

const development = withDevAi<Bindings, typeof worker>(worker, { bindings: runtimeBindings })
const withPersonas = (personas: () => DevPersona[]) => withDevIdentity<Bindings, typeof worker>(development, { bindings: runtimeBindings, config: authConfig, personas })
const dev = withPersonas(devPersonas), demo = withPersonas(demoPersonas)

// The dev layer answers its one-click sign-in and its hand-off page itself: they get the look and the signed-out bar
// the deployed sign-in pages get (the hand-off page also takes the themed frame's class Base's other frames carry).
const look = fontLinks.find(link => link.rel === 'stylesheet')!.href
export default {
  ...dev,
  async fetch(request, env, execution) {
    const response = await (env.RER_DEMO === '1' ? demo : dev).fetch!(request, env, execution)
    const path = new URL(request.url).pathname
    if ((path !== '/signin' && path !== '/__dev/key') || !response.headers.get('content-type')?.startsWith('text/html') || (await response.clone().text()).includes(look)) return response
    return asFrame(response)
  },
} satisfies ExportedHandler<Bindings>
