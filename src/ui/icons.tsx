// Inline line icons (decorative: every one sits beside its own words). Porthole Inter's Latin file has no ✓ or →.
const line = { viewBox: '0 0 24 24', 'aria-hidden': true } as const

export const Search = () => <svg {...line}><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5.5 5.5" /></svg>
export const Chevron = () => <svg {...line}><path d="m6 9 6 6 6-6" /></svg>
export const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h12.5M11 5l5 5-5 5" /></svg>
export const Check = () => <svg className="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6l3.1 3.1L13 4.6" /></svg>

/** The evidence cards' heads: a query, log lines, a profile's stacked frames, a deploy's commit. */
export const EvidenceIcon = ({ kind }: { kind: 'query' | 'log' | 'profile' | 'deploy' }) => {
  if (kind === 'query') return <svg {...line}><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></svg>
  if (kind === 'log') return <svg {...line}><path d="M5 3h10l4 4v14H5zM14.5 3v4.5H19M8.5 11h7M8.5 14.5h7M8.5 18h4.5" /></svg>
  if (kind === 'profile') return <svg {...line}><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="10" width="13" height="4" rx="1" /><rect x="3" y="16" width="7" height="4" rx="1" /></svg>
  return <svg {...line}><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></svg>
}
