-- Product portability has no reference to native secrets, sessions or grants.
CREATE TABLE porthole_archive_jobs (
 id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('export','restore')),
 owner_ref TEXT NOT NULL, created_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('snapshot','staging','complete','committed')),
 manifest TEXT, row_count INTEGER NOT NULL DEFAULT 0, next_chunk INTEGER NOT NULL DEFAULT 0,
 chain_hash TEXT NOT NULL, validation TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE porthole_archive_rows (
 job_id TEXT NOT NULL REFERENCES porthole_archive_jobs(id), ordinal INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)), table_name TEXT, row_key TEXT,
 PRIMARY KEY(job_id,ordinal), UNIQUE(job_id,table_name,row_key)
);
CREATE TABLE porthole_archive_chunks (
 job_id TEXT NOT NULL REFERENCES porthole_archive_jobs(id), chunk_index INTEGER NOT NULL,
 digest TEXT NOT NULL, packet TEXT NOT NULL CHECK(json_valid(packet)), PRIMARY KEY(job_id,chunk_index)
);
-- Historical identities never join native authentication or membership.
CREATE TABLE porthole_archive_actors (
 actor_ref TEXT PRIMARY KEY, role TEXT NOT NULL, scope TEXT NOT NULL CHECK(json_valid(scope)),
 state TEXT NOT NULL CHECK(state='inactive')
);
-- Original bytes/hash and sequence are immutable, grouped by original stream.
CREATE TABLE porthole_archive_audit (
 stream TEXT NOT NULL, sequence INTEGER NOT NULL, event_id TEXT NOT NULL,
 previous_hash TEXT NOT NULL, hash TEXT NOT NULL, entry TEXT NOT NULL CHECK(json_valid(entry)),
 PRIMARY KEY(stream,sequence), UNIQUE(stream,event_id)
);
CREATE TRIGGER porthole_archive_audit_no_update BEFORE UPDATE ON porthole_archive_audit
 BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
CREATE TRIGGER porthole_archive_audit_no_delete BEFORE DELETE ON porthole_archive_audit
 BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
CREATE TRIGGER porthole_archive_audit_chain BEFORE INSERT ON porthole_archive_audit
 WHEN NEW.sequence != COALESCE((SELECT MAX(sequence) FROM porthole_archive_audit WHERE stream=NEW.stream),0)+1
 OR NEW.previous_hash != COALESCE((SELECT hash FROM porthole_archive_audit WHERE stream=NEW.stream ORDER BY sequence DESC LIMIT 1),'0000000000000000000000000000000000000000000000000000000000000000')
 OR json_extract(NEW.entry,'$.sequence') IS NOT NEW.sequence
 OR json_extract(NEW.entry,'$.eventId') IS NOT NEW.event_id
 OR json_extract(NEW.entry,'$.previousHash') IS NOT NEW.previous_hash
 BEGIN SELECT RAISE(ABORT,'audit_chain_conflict'); END;
-- Imported configuration keeps its original lifecycle label but has no authority.
CREATE TABLE porthole_archive_quarantine (
 object_id TEXT PRIMARY KEY REFERENCES porthole_objects(id), source_state TEXT NOT NULL,
 archive_id TEXT NOT NULL, restored_at INTEGER NOT NULL,
 collection TEXT NOT NULL DEFAULT 'paused', schedules TEXT NOT NULL DEFAULT 'paused',
 delivery TEXT NOT NULL DEFAULT 'quarantined', execution TEXT NOT NULL DEFAULT 'paused', leases TEXT NOT NULL DEFAULT 'interrupted'
);
