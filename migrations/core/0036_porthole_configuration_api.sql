CREATE TABLE porthole_api_idempotency (
 actor_ref TEXT NOT NULL,
 request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 response TEXT NOT NULL CHECK(json_valid(response)),
 status INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_ref,request_key)
);
