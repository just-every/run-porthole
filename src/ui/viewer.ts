// The signed-in person as the app shows them: Base's session operator.
export interface Viewer { displayName: string; email: string; role: string }

const roles: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }
export const roleLabel = (role: string) => roles[role] ?? role
export const isOwner = (viewer: Viewer | undefined) => viewer?.role === 'owner'

/** Up to two letters for a round avatar: the first and last words' first letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return picked.map(word => [...word][0] ?? '').join('').toUpperCase() || '?'
}
