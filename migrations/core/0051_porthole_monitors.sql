CREATE TABLE porthole_monitor_versions (
 object_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL,
 scope TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(object_id,revision)
);
INSERT INTO porthole_monitor_versions SELECT id,revision,name,scope,body,updated_at FROM porthole_objects WHERE kind='monitor';
CREATE TRIGGER porthole_monitor_version_insert AFTER INSERT ON porthole_objects WHEN NEW.kind='monitor' AND NEW.state!='quarantined' BEGIN
 INSERT INTO porthole_monitor_versions VALUES(NEW.id,NEW.revision,NEW.name,NEW.scope,NEW.body,NEW.updated_at);
END;
CREATE TRIGGER porthole_monitor_version_update AFTER UPDATE OF revision ON porthole_objects WHEN NEW.kind='monitor' AND NEW.revision!=OLD.revision AND NEW.state!='quarantined' BEGIN
 INSERT INTO porthole_monitor_versions VALUES(NEW.id,NEW.revision,NEW.name,NEW.scope,NEW.body,NEW.updated_at);
END;
CREATE TRIGGER porthole_monitor_version_immutable BEFORE UPDATE ON porthole_monitor_versions BEGIN SELECT RAISE(ABORT,'monitor_revision_immutable'); END;
CREATE TABLE porthole_monitor_runs (
 id TEXT PRIMARY KEY, object_id TEXT NOT NULL, revision INTEGER NOT NULL,
 evaluated_at INTEGER NOT NULL, result TEXT NOT NULL
);
CREATE INDEX porthole_monitor_runs_object ON porthole_monitor_runs(object_id,evaluated_at DESC,id);
