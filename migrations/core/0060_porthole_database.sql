-- Local collection authority is deliberately excluded from portable telemetry.
CREATE TABLE porthole_database_sources (
 id TEXT PRIMARY KEY,
 credential_id TEXT NOT NULL,
 service TEXT NOT NULL,
 environment TEXT NOT NULL,
 team TEXT NOT NULL,
 engine TEXT NOT NULL CHECK(engine IN ('postgresql','mysql')),
 plan_digest TEXT NOT NULL,
 revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 reviewed_at INTEGER NOT NULL,
 owner_id TEXT NOT NULL
);
