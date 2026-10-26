-- Private inert evidence; this is never an import-kit job, approval or grant.
CREATE TABLE porthole_migration_custody (
 stream TEXT NOT NULL,
 source_table TEXT NOT NULL,
 source_key TEXT NOT NULL CHECK(json_valid(source_key)),
 body TEXT NOT NULL CHECK(json_valid(body)),
 state TEXT NOT NULL DEFAULT 'inactive' CHECK(state='inactive'),
 PRIMARY KEY(stream,source_table,source_key)
);
