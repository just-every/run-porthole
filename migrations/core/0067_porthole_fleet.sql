-- Install observations confer no collection authority. Credential bindings never travel.
CREATE TABLE porthole_fleet_installs (
 id TEXT PRIMARY KEY,
 credential_id TEXT,
 service TEXT NOT NULL,
 environment TEXT NOT NULL,
 team TEXT NOT NULL,
 report TEXT NOT NULL,
 observed_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','stopped','quarantined'))
);
