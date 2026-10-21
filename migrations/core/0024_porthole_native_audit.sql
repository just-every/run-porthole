-- Opaque aliases for native settings; private keys/labels never enter audit.
CREATE TABLE porthole_entity_refs(kind TEXT NOT NULL,key_ref TEXT NOT NULL,entity_ref TEXT NOT NULL UNIQUE,PRIMARY KEY(kind,key_ref));
CREATE TRIGGER porthole_native_fact_oa_auth_settings_insert AFTER INSERT ON oa_auth_settings WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_auth_settings',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_auth_settings' AND key_ref=NEW.singleton),NEW.generation,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_auth_settings_update AFTER UPDATE ON oa_auth_settings WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_auth_settings',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_auth_settings' AND key_ref=NEW.singleton),NEW.generation,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_auth_settings_delete AFTER DELETE ON oa_auth_settings WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_auth_settings',OLD.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_auth_settings' AND key_ref=OLD.singleton),OLD.generation,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_domain_rules_insert AFTER INSERT ON oa_domain_rules WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_domain_rules',NEW.domain,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_domain_rules' AND key_ref=NEW.domain),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_domain_rules_update AFTER UPDATE ON oa_domain_rules WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_domain_rules',NEW.domain,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_domain_rules' AND key_ref=NEW.domain),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_domain_rules_delete AFTER DELETE ON oa_domain_rules WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_domain_rules',OLD.domain,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_domain_rules' AND key_ref=OLD.domain),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_identity_providers_insert AFTER INSERT ON oa_identity_providers WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_identity_providers',NEW.provider_id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_identity_providers' AND key_ref=NEW.provider_id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_identity_providers_update AFTER UPDATE ON oa_identity_providers WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_identity_providers',NEW.provider_id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_identity_providers' AND key_ref=NEW.provider_id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_identity_providers_delete AFTER DELETE ON oa_identity_providers WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_identity_providers',OLD.provider_id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_identity_providers' AND key_ref=OLD.provider_id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_policy_approvals_insert AFTER INSERT ON oa_policy_approvals WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_policy_approvals',NEW.id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_policy_approvals' AND key_ref=NEW.id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_policy_approvals_update AFTER UPDATE ON oa_policy_approvals WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_policy_approvals',NEW.id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_policy_approvals' AND key_ref=NEW.id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_oa_policy_approvals_delete AFTER DELETE ON oa_policy_approvals WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('oa_policy_approvals',OLD.id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='oa_policy_approvals' AND key_ref=OLD.id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_bootstrap_fact AFTER INSERT ON oa_bootstrap BEGIN
 INSERT INTO porthole_audit_facts VALUES(lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,lower(hex(randomblob(16))),NEW.claim_id,1,'identity.bootstrap',NEW.claim_id,1,NEW.claimed_at,CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
CREATE TRIGGER porthole_native_fact_porthole_ingest_control_insert AFTER INSERT ON porthole_ingest_control WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_ingest_control',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_ingest_control' AND key_ref=NEW.singleton),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_porthole_ingest_control_update AFTER UPDATE ON porthole_ingest_control WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_ingest_control',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_ingest_control' AND key_ref=NEW.singleton),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_porthole_ingest_events_insert AFTER INSERT ON porthole_ingest_events WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_ingest_events',NEW.id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_ingest_events' AND key_ref=NEW.id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_porthole_ingest_events_update AFTER UPDATE ON porthole_ingest_events WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_ingest_events',NEW.id,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_ingest_events' AND key_ref=NEW.id),NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_porthole_health_configuration_insert AFTER INSERT ON porthole_health_configuration WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_health_configuration',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_health_configuration' AND key_ref=NEW.singleton),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_native_fact_porthole_health_configuration_update AFTER UPDATE ON porthole_health_configuration WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_health_configuration',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_health_configuration' AND key_ref=NEW.singleton),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
-- Native rer transfers already commit their job state with the operation. Keep
-- their minimal audit trail in that same bookkeeping row until projection;
-- this does not make an otherwise empty restore destination nonempty.
CREATE TRIGGER porthole_cli_audit_insert AFTER INSERT ON rer_portability_jobs BEGIN
 UPDATE rer_portability_jobs SET metadata=json_set(metadata,'$.portholeAuditTrail',json_array(json_object('id',lower(hex(randomblob(16))),'phase',NEW.phase,'occurredAt',CAST(unixepoch('subsec')*1000 AS INTEGER),'actorRef',COALESCE((SELECT claim_id FROM oa_bootstrap WHERE singleton=1),(SELECT source_identity FROM rer_portability_state WHERE id=1)),'actorRevision',(SELECT version FROM oa_operators WHERE id=(SELECT claim_id FROM oa_bootstrap WHERE singleton=1))))) WHERE id=NEW.id;
END;
CREATE TRIGGER porthole_cli_audit_update AFTER UPDATE ON rer_portability_jobs
 WHEN NEW.phase!=OLD.phase OR json_extract(NEW.metadata,'$.portholeAuditTrail') IS NULL BEGIN
 UPDATE rer_portability_jobs SET metadata=json_set(metadata,'$.portholeAuditTrail',json(
 CASE WHEN NEW.phase!=OLD.phase THEN json_insert(COALESCE(json_extract(OLD.metadata,'$.portholeAuditTrail'),'[]'),'$[#]',json_object('id',lower(hex(randomblob(16))),'phase',NEW.phase,'occurredAt',CAST(unixepoch('subsec')*1000 AS INTEGER),'actorRef',COALESCE((SELECT claim_id FROM oa_bootstrap WHERE singleton=1),(SELECT source_identity FROM rer_portability_state WHERE id=1)),'actorRevision',(SELECT version FROM oa_operators WHERE id=(SELECT claim_id FROM oa_bootstrap WHERE singleton=1))))
 ELSE COALESCE(json_extract(OLD.metadata,'$.portholeAuditTrail'),'[]') END)) WHERE id=NEW.id;
END;
