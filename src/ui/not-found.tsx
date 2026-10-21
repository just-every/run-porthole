import { HydrationUnit } from '../base/hydration/unit'
import branding from '../branding.json'
import { AppBar } from './bar'
import { Arrow } from './icons'

/** Any address the app does not have: the app's bar, and one card that leads back. */
export function NotFound() {
  return <>
    <HydrationUnit><AppBar /></HydrationUnit>
    <main id="main">
      <HydrationUnit><section className="lost card" aria-labelledby="lost-title">
        <h1 id="lost-title">Page not found.</h1>
        <p>This address isn’t part of {branding.name}.</p>
        <a className="pill" href="/app">Open {branding.name}<Arrow /></a>
      </section></HydrationUnit>
    </main>
  </>
}
