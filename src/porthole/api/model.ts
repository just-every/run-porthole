import { fail } from '../security/authority'
import type { ObjectRow } from '../objects/http'

export const configurationRoot = '/api/porthole/v1/configuration'
export const collections = { monitors: 'monitor', repairs: 'repair' } as const
export type Collection = keyof typeof collections
export function collection(value: unknown): Collection {
 if (typeof value !== 'string' || !Object.hasOwn(collections,value)) fail('configuration_not_found',404)
 return value as Collection
}
export const entityTag = (revision: number) => `"${revision}"`
export function representation(row: ObjectRow) {
 return {...row, scope: JSON.parse(row.scope), body: JSON.parse(row.body)}
}
export function revision(request: Request) {
 const tag=request.headers.get('if-match')
 if(!tag)fail('revision_required',428)
 if(!/^"[1-9][0-9]*"$/.test(tag))fail('invalid_revision',400)
 const value=Number(tag.slice(1,-1))
 if(!Number.isSafeInteger(value))fail('invalid_revision',400)
 return value
}
export function canonical(value: unknown): string {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`
 if(value && typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
 return JSON.stringify(value)
}
