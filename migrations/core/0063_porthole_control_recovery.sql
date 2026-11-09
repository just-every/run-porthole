-- An imported installation must earn live health from new destination input.
CREATE TABLE porthole_control_recovery (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 restored_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO porthole_control_recovery(singleton) VALUES(1);
