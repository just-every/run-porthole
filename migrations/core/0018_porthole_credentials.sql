-- Installation-local identities, never person sessions. Secret material is
-- hashed before the write. This table is not portable approval authority.
CREATE TABLE porthole_credentials (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, class TEXT NOT NULL CHECK(class IN ('ingest','change-event','read','proposal','execution')),
 custodian_id TEXT NOT NULL REFERENCES oa_operators(id),
 secret_hash TEXT NOT NULL UNIQUE CHECK(length(secret_hash)=64), prefix TEXT NOT NULL, last_four TEXT NOT NULL CHECK(length(last_four)=4),
 scope TEXT NOT NULL CHECK(json_valid(scope)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','suspended')), revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>created_at), revoked_at INTEGER, suspended_at INTEGER,
 predecessor_id TEXT REFERENCES porthole_credentials(id), successor_id TEXT REFERENCES porthole_credentials(id),
 requests_per_minute INTEGER NOT NULL CHECK(requests_per_minute>0), accepted_bytes_per_minute INTEGER NOT NULL CHECK(accepted_bytes_per_minute>0),
 scanned_bytes_per_day INTEGER NOT NULL CHECK(scanned_bytes_per_day>0), usd_micros_per_day INTEGER NOT NULL CHECK(usd_micros_per_day>0),
 minute INTEGER NOT NULL DEFAULT 0, minute_requests INTEGER NOT NULL DEFAULT 0, minute_bytes INTEGER NOT NULL DEFAULT 0,
 utc_day INTEGER NOT NULL DEFAULT 0, day_scanned_bytes INTEGER NOT NULL DEFAULT 0, day_usd_micros INTEGER NOT NULL DEFAULT 0,
 last_used_at INTEGER, last_used_door TEXT, last_request_id TEXT
);
CREATE INDEX porthole_credentials_custodian ON porthole_credentials(custodian_id,status);
CREATE TRIGGER porthole_credentials_permanent BEFORE UPDATE OF status ON porthole_credentials
 WHEN OLD.status!='active' AND NEW.status!=OLD.status
 BEGIN SELECT RAISE(ABORT,'credential_permanently_inactive'); END;
CREATE TRIGGER porthole_credentials_custody BEFORE UPDATE OF custodian_id ON porthole_credentials
 WHEN NEW.custodian_id!=OLD.custodian_id AND (OLD.class!='ingest' OR NOT EXISTS(
 SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id
 WHERE m.operator_id=NEW.custodian_id AND m.role IN ('owner','admin') AND o.role=m.role AND o.status='active'
 AND NOT EXISTS(SELECT 1 FROM json_each(OLD.scope,'$.services') w WHERE NOT EXISTS(SELECT 1 FROM json_each(m.scope,'$.services') h WHERE h.value='*' OR h.value=w.value))
 AND NOT EXISTS(SELECT 1 FROM json_each(OLD.scope,'$.environments') w WHERE NOT EXISTS(SELECT 1 FROM json_each(m.scope,'$.environments') h WHERE h.value='*' OR h.value=w.value))
 AND NOT EXISTS(SELECT 1 FROM json_each(OLD.scope,'$.teams') w WHERE NOT EXISTS(SELECT 1 FROM json_each(m.scope,'$.teams') h WHERE h.value='*' OR h.value=w.value))))
 BEGIN SELECT RAISE(ABORT,'credential_custody_forbidden'); END;
-- Removal must move or explicitly revoke ingest first in the same batch.
-- Invitation activation is deliberately unaffected.
CREATE TRIGGER porthole_credentials_remove BEFORE UPDATE OF status ON oa_operators
 WHEN OLD.status='active' AND NEW.status='inactive'
 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM porthole_credentials WHERE custodian_id=OLD.id AND class='ingest' AND status='active') THEN RAISE(ABORT,'ingest_handover_required') END;
 UPDATE porthole_credentials SET status='suspended',suspended_at=CAST(unixepoch('subsec')*1000 AS INTEGER),revision=revision+1 WHERE custodian_id=OLD.id AND class!='ingest' AND status='active';
 END;
CREATE TRIGGER porthole_credentials_role_loss BEFORE UPDATE OF role ON porthole_members
 WHEN OLD.role IN ('owner','admin') AND NEW.role NOT IN ('owner','admin')
 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM porthole_credentials WHERE custodian_id=OLD.operator_id AND class='ingest' AND status='active') THEN RAISE(ABORT,'ingest_handover_required') END;
 UPDATE porthole_credentials SET status='suspended',suspended_at=CAST(unixepoch('subsec')*1000 AS INTEGER),revision=revision+1 WHERE custodian_id=OLD.operator_id AND status='active';
 END;
CREATE TRIGGER porthole_credentials_authority_change AFTER UPDATE OF role,scope ON porthole_members
 WHEN OLD.role!=NEW.role OR OLD.scope!=NEW.scope
 BEGIN
 UPDATE porthole_credentials SET status='suspended',suspended_at=CAST(unixepoch('subsec')*1000 AS INTEGER),revision=revision+1
 WHERE custodian_id=OLD.operator_id AND class IN ('read','proposal','execution') AND status='active';
 END;
