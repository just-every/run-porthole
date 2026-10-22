import type { Bindings } from '../../auth.server'
import { fail } from '../security/authority'

export type StorageBindings = Bindings & { ARCHIVE_BUCKET?: R2Bucket }
export interface HistoryReference {
 id: string
 source_binding: 'ARCHIVE_BUCKET'
 object_key: string
 sha256: string
 byte_count: number
 content_type: string
 source_label: string
 history_label: string
 created_at: number
 state: 'active' | 'quarantined'
}
export const historyColumns = ['id','source_binding','object_key','sha256','byte_count','content_type','source_label','history_label','created_at','state']
export const maxHistoryBytes = 33554432
export const historyTypes = new Set(['application/json','application/x-ndjson','text/csv','text/plain','application/vnd.apache.parquet'])
export const historyLabel = (value: unknown): value is string => typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._:/-]{0,119}$/.test(value)
export const historyId = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
export const historyKey = (id: string, sha256: string) => `porthole/history/${id}/${sha256}`
export function validHistoryReference(row: Record<string,unknown>): boolean {
 return Object.keys(row).sort().join(',')===[...historyColumns].sort().join(',') && historyId(row.id)
  && row.source_binding==='ARCHIVE_BUCKET' && typeof row.sha256==='string' && /^[a-f0-9]{64}$/.test(row.sha256)
  && row.object_key===historyKey(row.id,row.sha256) && Number.isSafeInteger(row.byte_count)
  && Number(row.byte_count)>0 && Number(row.byte_count)<=maxHistoryBytes
  && historyTypes.has(String(row.content_type)) && historyLabel(row.source_label) && historyLabel(row.history_label)
  && Number.isSafeInteger(row.created_at) && Number(row.created_at)>=0 && ['active','quarantined'].includes(String(row.state))
}
export function archiveBucket(env: StorageBindings): R2Bucket {
 if(!env.ARCHIVE_BUCKET)fail('archive_bucket_unavailable',503)
 return env.ARCHIVE_BUCKET
}
