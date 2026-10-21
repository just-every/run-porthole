// Shared by the root renderer and the no-JavaScript first-run document.
// Edition owners can replace these self-hosted URLs with their brand assets.
// Porthole: its text face (declared in /rer-theme.css) and the look every app
// document and Base frame wears (docs/LOOK.md).
export const fontLinks = [
  { rel: 'preload', href: '/fonts/porthole/inter-var.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: '/look/porthole.css' },
] as const

export const fontHead = fontLinks.map(link => `<link ${Object.entries(link).map(([name, value]) => `${name.toLowerCase()}="${value}"`).join(' ')}>`).join('')
