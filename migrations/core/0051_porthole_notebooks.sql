CREATE TABLE porthole_notebooks (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_ref TEXT NOT NULL, author_ref TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(json_valid(scope)), body TEXT NOT NULL CHECK(json_valid(body)),
 revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE porthole_notebook_versions (
 id TEXT NOT NULL, name TEXT NOT NULL, owner_ref TEXT NOT NULL, author_ref TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(json_valid(scope)), body TEXT NOT NULL CHECK(json_valid(body)),
 revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(id,revision)
);
CREATE TABLE porthole_notebook_shares (
 notebook_id TEXT NOT NULL REFERENCES porthole_notebooks(id), kind TEXT NOT NULL CHECK(kind IN ('member','team')),
 target TEXT NOT NULL, owner_ref TEXT NOT NULL, owner_revision INTEGER NOT NULL, operator_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(notebook_id,kind,target)
);
CREATE TRIGGER porthole_notebook_created AFTER INSERT ON porthole_notebooks BEGIN
 INSERT OR IGNORE INTO porthole_notebook_versions SELECT NEW.id,NEW.name,NEW.owner_ref,NEW.author_ref,NEW.scope,NEW.body,NEW.revision,NEW.state,NEW.created_at,NEW.updated_at;
END;
CREATE TRIGGER porthole_notebook_revised AFTER UPDATE ON porthole_notebooks BEGIN
 INSERT OR IGNORE INTO porthole_notebook_versions SELECT NEW.id,NEW.name,NEW.owner_ref,NEW.author_ref,NEW.scope,NEW.body,NEW.revision,NEW.state,NEW.created_at,NEW.updated_at;
END;
