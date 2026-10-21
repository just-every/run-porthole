import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFile,readdir} from 'node:fs/promises'

// Exercise the shipped additive migration, against the exact previous schema
// and preexisting accounts. The CLI/runtime journey separately proves its UI.
export async function migrationJourney() {
 const db=new DatabaseSync(':memory:')
 try {
  for(const path of (await readdir('migrations/core')).filter(path=>path<'0017').sort()) db.exec(await readFile('migrations/core/'+path,'utf8'))
  const insert=db.prepare('INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,?,?,?,?)')
  for(const [id,role] of [['synthetic-porthole-1','owner'],['synthetic-porthole-2','admin'],['synthetic-porthole-3','member']]) insert.run(id,`${id}@example.com`,id,role,'active',Date.now())
  db.exec(await readFile('migrations/core/0017_porthole_members.sql','utf8'))
  const rows=db.prepare('SELECT * FROM porthole_membership_migration ORDER BY operator_id').all()
  assert.deepEqual(rows.map(row=>[row.previous_role,row.assigned_role,row.gained_access]),[['owner','owner',0],['admin','admin',0],['member','read-only analyst',0]])
  assert.deepEqual(JSON.parse(rows[2].assigned_scope),{services:[],environments:[],teams:[]})
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM porthole_members').get().n,3)
  assert.throws(()=>db.exec("UPDATE porthole_members SET role='read-only analyst' WHERE operator_id='synthetic-porthole-1'"),/last_owner/)
  assert.throws(()=>db.exec("DELETE FROM oa_operators WHERE id='synthetic-porthole-1'"),/last_owner/)
  console.log('migrationJourney passed: existing roles migrate once without access gain and Base final-owner guards remain')
 } finally {db.close()}
}
