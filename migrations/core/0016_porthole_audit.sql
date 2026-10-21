-- Edition-owned audit. Existing migration history is deliberately unchanged.
CREATE TABLE porthole_audit_entries (
 sequence INTEGER PRIMARY KEY CHECK(sequence > 0),
 event_id TEXT NOT NULL UNIQUE,
 previous_hash TEXT NOT NULL UNIQUE CHECK(length(previous_hash)=64),
 hash TEXT NOT NULL UNIQUE CHECK(length(hash)=64),
 entry TEXT NOT NULL CHECK(json_valid(entry))
);
CREATE TRIGGER porthole_audit_no_update BEFORE UPDATE ON porthole_audit_entries
 BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
CREATE TRIGGER porthole_audit_no_delete BEFORE DELETE ON porthole_audit_entries
 BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
CREATE TRIGGER porthole_audit_chain BEFORE INSERT ON porthole_audit_entries
 WHEN NEW.sequence != COALESCE((SELECT MAX(sequence) FROM porthole_audit_entries),0)+1
 OR NEW.previous_hash != COALESCE((SELECT hash FROM porthole_audit_entries ORDER BY sequence DESC LIMIT 1), '0000000000000000000000000000000000000000000000000000000000000000')
 OR json_extract(NEW.entry,'$.sequence') IS NOT NEW.sequence
 OR json_extract(NEW.entry,'$.eventId') IS NOT NEW.event_id
 OR json_extract(NEW.entry,'$.previousHash') IS NOT NEW.previous_hash
 BEGIN SELECT RAISE(ABORT, 'audit_chain_conflict'); END;
