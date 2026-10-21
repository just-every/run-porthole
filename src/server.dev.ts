// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the Dev title and name suffix.
import worker from './server'
import { withDevIdentity } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from './auth.server'
import { devPersonas } from './dev-personas'
import { withDevAi } from './modules/ai/dev/index.mjs'
import { fontDocumentResponse } from './base/font-response'
import { fontLinks } from './base/font-head'
import { withBar } from './ui/document.server'

const development = withDevAi<Bindings, typeof worker>(worker, { bindings: runtimeBindings })
const dev = withDevIdentity<Bindings, typeof worker>(development, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })

// The dev layer answers its one-click sign-in and its hand-off page itself: they get the look and the signed-out bar
// the deployed sign-in pages get (the hand-off page also takes the themed frame's class Base's other frames carry).
const look = fontLinks.find(link => link.rel === 'stylesheet')!.href
export default {
  ...dev,
  async fetch(request, env, execution) {
    const response = await dev.fetch!(request, env, execution)
    const path = new URL(request.url).pathname
    if ((path !== '/signin' && path !== '/__dev/key') || !response.headers.get('content-type')?.startsWith('text/html') || (await response.clone().text()).includes(look)) return response
    const looked = (await fontDocumentResponse(response))!
    const themed = path === '/__dev/key' ? new Response((await looked.text()).replace('<html lang="en">', '<html lang="en" class="rer-themed">'), looked) : looked
    return withBar(themed)
  },
} satisfies ExportedHandler<Bindings>
