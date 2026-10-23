import {canonicalJson} from '../../../modules/import-kit/src/provenance/identity.ts'
import type {D1TargetAdapter,D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import type {TargetRow} from '../../../modules/import-kit/src/types.ts'
const sql=(sql:string,...params:unknown[]):D1Sql=>({sql,params})
type Row={kind:string;id:string;body:string;revision:string}
const target=(r:Row):TargetRow=>({destination:'migration-evidence',targetKind:r.kind,targetId:r.id,value:JSON.parse(r.body),revision:r.revision})
const equal=(r:TargetRow|null,_d:string,kind:string,id:string)=>r?sql('EXISTS(SELECT 1 FROM porthole_migration_records WHERE kind=? AND id=? AND body=? AND revision=?)',kind,id,canonicalJson(r.value),r.revision):sql('NOT EXISTS(SELECT 1 FROM porthole_migration_records WHERE kind=? AND id=?)',kind,id)
const set=(rows:TargetRow[])=>[sql('(SELECT count(*) FROM porthole_migration_records)=?',rows.length),...rows.map(r=>equal(r,r.destination,r.targetKind,r.targetId))]
export const migrationTargets:D1TargetAdapter={
 async read(db,_d,kind,id){const row=await db.prepare('SELECT * FROM porthole_migration_records WHERE kind=? AND id=?').bind(kind,id).first<Row>();return row?target(row):undefined},
 matches:equal,matchesMany:set,
 matchesCount:n=>sql('(SELECT count(*) FROM porthole_migration_records)=?',n),
 write:r=>[sql('INSERT INTO porthole_migration_records(kind,id,body,revision) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,revision=excluded.revision',r.targetKind,r.targetId,canonicalJson(r.value),r.revision)],
 remove:(_d,kind,id)=>[sql('DELETE FROM porthole_migration_records WHERE kind=? AND id=?',kind,id)],
 async list(db){return (await db.prepare('SELECT * FROM porthole_migration_records ORDER BY kind,id').all<Row>()).results.map(target)},
 async preparePreservedUndo(db,destination,effects){const rows=await migrationTargets.list(db,destination);return {nativeRows:rows,observations:effects.map(e=>({effectId:e.provenance.id,current:rows.find(r=>r.targetKind===e.expected.targetKind&&r.targetId===e.expected.targetId)??null,entity:{table:'porthole_migration_records',recordId:e.expected.targetId}})),dependencies:[],guards:set(rows)}},
}
