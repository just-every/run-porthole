import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { fontLinks } from '../base/font-head'
import { pageStyle } from '../base/page-style'
import { introCss, introGuardScript } from '../base/hydration/intro-guard'
import branding from '../branding.json'
import { NotFound } from '../ui/not-found'

// Hydration units (src/base/hydration/README.md): every page section and any
// root chrome sits in a HydrationUnit. Never set shellComponent, wrapInSuspense
// or pendingComponent on this root route.
// The Worker answers every page it has (the Lobby, /app, Base's documents), so this
// root renders only the not-found page, and its title says so.
export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: `Page not found · ${branding.name}` }] }),
  notFoundComponent: NotFound,
  component: () => <html lang="en"><head>
    {fontLinks.map(link => <link key={link.href} {...link} />)}
    <link rel="stylesheet" href="/rer-theme.css" />
    <HeadContent />
    <script dangerouslySetInnerHTML={{ __html: introGuardScript }} />
    <style>{introCss}</style>
    <style>{pageStyle}</style>
  </head><body className="app"><Outlet /><Scripts /></body></html>,
})
