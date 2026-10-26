import {parseJson,type Row} from './rows'

/** Reads bounded D1 pages, keeping at most one source document's chunks while
 * checking it. A product archive may hold arbitrarily many source plans. */
export class CustodyReader {
 constructor(private db:D1Database,private jobId:string){}
 async *rows(table:string,stream?:string,field?:string,value?:unknown):AsyncGenerator<Row> {
  const fields=field&&/^[a-z_]+$/.test(field)?` AND json_extract(json_extract(payload,'$.row.body'),'$.${field}')=?`:''
  const where=`job_id=? AND json_extract(payload,'$.table')='porthole_migration_custody' AND json_extract(payload,'$.row.source_table')=?${stream?' AND json_extract(payload,\'$.row.stream\')=?':''}${fields}`
  const args=[this.jobId,table,...stream?[stream]:[],...fields?[value]:[]]
  for(let offset=0;;offset+=24){
   const page=(await this.db.prepare(`SELECT json_extract(payload,'$.row.body') AS body FROM porthole_archive_rows WHERE ${where} ORDER BY ordinal LIMIT 24 OFFSET ?`).bind(...args,offset).all<{body:string}>()).results
   for(const row of page)yield parseJson(row.body) as Row
   if(page.length<24)break
  }
 }
 async list(table:string,stream:string,field?:string,value?:unknown):Promise<Row[]> {
  const rows:Row[]=[];for await(const row of this.rows(table,stream,field,value))rows.push(row);return rows
 }
 async streams():Promise<string[]> {
  return (await this.db.prepare("SELECT DISTINCT json_extract(payload,'$.row.stream') AS stream FROM porthole_archive_rows WHERE job_id=? AND json_extract(payload,'$.table')='porthole_migration_custody' ORDER BY stream").bind(this.jobId).all<{stream:string}>()).results.map(row=>row.stream)
 }
}
