-- Imported-target erasure is explicit, local and separately approved.
-- Receipts contain no source IDs, target IDs, original names or source values.
CREATE TABLE porthole_migration_erasure_fences (
 receipt_id TEXT PRIMARY KEY CHECK(length(receipt_id)=36 AND receipt_id NOT GLOB '*[^a-f0-9-]*'),
 inventory_digest TEXT NOT NULL CHECK(length(inventory_digest)=64 AND inventory_digest NOT GLOB '*[^a-f0-9]*'),
 erased_at INTEGER NOT NULL CHECK(typeof(erased_at)='integer' AND erased_at>=0)
);
CREATE TRIGGER porthole_migration_erasure_immutable_insert BEFORE INSERT ON porthole_migration_erasure_fences
 WHEN EXISTS(SELECT 1 FROM porthole_migration_erasure_fences WHERE receipt_id=NEW.receipt_id AND (inventory_digest!=NEW.inventory_digest OR erased_at!=NEW.erased_at))
 BEGIN SELECT RAISE(ABORT,'IMPORT_ERASURE_FENCE_CHANGED'); END;
CREATE TRIGGER porthole_migration_erasure_immutable_update BEFORE UPDATE ON porthole_migration_erasure_fences
 WHEN NEW.receipt_id IS NOT OLD.receipt_id OR NEW.inventory_digest IS NOT OLD.inventory_digest OR NEW.erased_at IS NOT OLD.erased_at
 BEGIN SELECT RAISE(ABORT,'IMPORT_ERASURE_FENCE_CHANGED'); END;
CREATE TRIGGER porthole_migration_erasure_immutable_delete BEFORE DELETE ON porthole_migration_erasure_fences
 BEGIN SELECT RAISE(ABORT,'IMPORT_ERASURE_FENCE_CHANGED'); END;
-- A committed checkpoint is audited in its transaction even if HTTP delivery
-- fails. The only entity reference is its opaque receipt, never source content.
CREATE TRIGGER porthole_migration_erasure_audit AFTER INSERT ON porthole_migration_erasure_fences
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.receipt_id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
-- Local concurrency control only; never portable permission or a source record.
CREATE TABLE porthole_migration_erasure_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=0)
);
INSERT INTO porthole_migration_erasure_state(singleton,revision) VALUES(1,0);
-- Local acknowledgement recovery binds a digest to the exact reviewed request.
-- It carries only hashes and an opaque receipt; source approval never transfers.
CREATE TABLE porthole_migration_erasure_replays (
 inventory_digest TEXT PRIMARY KEY CHECK(length(inventory_digest)=64 AND inventory_digest NOT GLOB '*[^a-f0-9]*'),
 selection_digest TEXT NOT NULL CHECK(length(selection_digest)=64 AND selection_digest NOT GLOB '*[^a-f0-9]*'),
 receipt_id TEXT NOT NULL REFERENCES porthole_migration_erasure_fences(receipt_id)
);
-- Every content and ownership change invalidates a reviewed inventory, including
-- same-revision native edits and concurrent uploads. Transaction-local guard
-- assertions and erasure tally rows contain no committed custody and are omitted.
CREATE TRIGGER import_erasure_epoch_ik_batches_insert AFTER INSERT ON ik_batches
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_batches_update AFTER UPDATE ON ik_batches
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_batches_delete AFTER DELETE ON ik_batches
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_creation_plans_insert AFTER INSERT ON ik_d1_creation_plans
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_creation_plans_update AFTER UPDATE ON ik_d1_creation_plans
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_creation_plans_delete AFTER DELETE ON ik_d1_creation_plans
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_custody_revisions_insert AFTER INSERT ON ik_d1_custody_revisions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_custody_revisions_update AFTER UPDATE ON ik_d1_custody_revisions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_custody_revisions_delete AFTER DELETE ON ik_d1_custody_revisions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_custody_states_insert AFTER INSERT ON ik_d1_custody_states
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_custody_states_update AFTER UPDATE ON ik_d1_custody_states
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_custody_states_delete AFTER DELETE ON ik_d1_custody_states
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_entries_insert AFTER INSERT ON ik_d1_entries
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_entries_update AFTER UPDATE ON ik_d1_entries
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_entries_delete AFTER DELETE ON ik_d1_entries
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erased_sources_insert AFTER INSERT ON ik_d1_erased_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erased_sources_update AFTER UPDATE ON ik_d1_erased_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erased_sources_delete AFTER DELETE ON ik_d1_erased_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erased_targets_insert AFTER INSERT ON ik_d1_erased_targets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erased_targets_update AFTER UPDATE ON ik_d1_erased_targets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erased_targets_delete AFTER DELETE ON ik_d1_erased_targets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erasure_journal_insert AFTER INSERT ON ik_d1_erasure_journal
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erasure_journal_update AFTER UPDATE ON ik_d1_erasure_journal
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erasure_journal_delete AFTER DELETE ON ik_d1_erasure_journal
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erasure_progress_insert AFTER INSERT ON ik_d1_erasure_progress
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erasure_progress_update AFTER UPDATE ON ik_d1_erasure_progress
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_erasure_progress_delete AFTER DELETE ON ik_d1_erasure_progress
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_history_insert AFTER INSERT ON ik_d1_history
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_history_update AFTER UPDATE ON ik_d1_history
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_history_delete AFTER DELETE ON ik_d1_history
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_indexed_jobs_insert AFTER INSERT ON ik_d1_indexed_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_indexed_jobs_update AFTER UPDATE ON ik_d1_indexed_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_indexed_jobs_delete AFTER DELETE ON ik_d1_indexed_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_insert AFTER INSERT ON ik_d1_native_staging
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_update AFTER UPDATE ON ik_d1_native_staging
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_delete AFTER DELETE ON ik_d1_native_staging
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_index_insert AFTER INSERT ON ik_d1_native_staging_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_index_update AFTER UPDATE ON ik_d1_native_staging_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_index_delete AFTER DELETE ON ik_d1_native_staging_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_values_insert AFTER INSERT ON ik_d1_native_staging_values
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_values_update AFTER UPDATE ON ik_d1_native_staging_values
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_native_staging_values_delete AFTER DELETE ON ik_d1_native_staging_values
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_original_chunks_insert AFTER INSERT ON ik_d1_original_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_original_chunks_update AFTER UPDATE ON ik_d1_original_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_original_chunks_delete AFTER DELETE ON ik_d1_original_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_plan_chunks_insert AFTER INSERT ON ik_d1_plan_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_plan_chunks_update AFTER UPDATE ON ik_d1_plan_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_plan_chunks_delete AFTER DELETE ON ik_d1_plan_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_plan_index_insert AFTER INSERT ON ik_d1_plan_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_plan_index_update AFTER UPDATE ON ik_d1_plan_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_plan_index_delete AFTER DELETE ON ik_d1_plan_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_policy_conversions_insert AFTER INSERT ON ik_d1_policy_conversions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_policy_conversions_update AFTER UPDATE ON ik_d1_policy_conversions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_policy_conversions_delete AFTER DELETE ON ik_d1_policy_conversions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_preparation_receipts_insert AFTER INSERT ON ik_d1_preparation_receipts
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_preparation_receipts_update AFTER UPDATE ON ik_d1_preparation_receipts
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_preparation_receipts_delete AFTER DELETE ON ik_d1_preparation_receipts
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_preparation_steps_insert AFTER INSERT ON ik_d1_preparation_steps
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_preparation_steps_update AFTER UPDATE ON ik_d1_preparation_steps
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_preparation_steps_delete AFTER DELETE ON ik_d1_preparation_steps
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_publication_fences_insert AFTER INSERT ON ik_d1_publication_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_publication_fences_update AFTER UPDATE ON ik_d1_publication_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_publication_fences_delete AFTER DELETE ON ik_d1_publication_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_retirements_insert AFTER INSERT ON ik_d1_retirements
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_retirements_update AFTER UPDATE ON ik_d1_retirements
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_retirements_delete AFTER DELETE ON ik_d1_retirements
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_reversal_fences_insert AFTER INSERT ON ik_d1_reversal_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_reversal_fences_update AFTER UPDATE ON ik_d1_reversal_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_reversal_fences_delete AFTER DELETE ON ik_d1_reversal_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_reversal_reports_insert AFTER INSERT ON ik_d1_reversal_reports
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_reversal_reports_update AFTER UPDATE ON ik_d1_reversal_reports
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_reversal_reports_delete AFTER DELETE ON ik_d1_reversal_reports
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_insert AFTER INSERT ON ik_d1_staging
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_update AFTER UPDATE ON ik_d1_staging
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_delete AFTER DELETE ON ik_d1_staging
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_chunks_insert AFTER INSERT ON ik_d1_staging_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_chunks_update AFTER UPDATE ON ik_d1_staging_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_chunks_delete AFTER DELETE ON ik_d1_staging_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_headers_insert AFTER INSERT ON ik_d1_staging_headers
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_headers_update AFTER UPDATE ON ik_d1_staging_headers
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_headers_delete AFTER DELETE ON ik_d1_staging_headers
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_index_insert AFTER INSERT ON ik_d1_staging_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_index_update AFTER UPDATE ON ik_d1_staging_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_index_delete AFTER DELETE ON ik_d1_staging_index
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_originals_insert AFTER INSERT ON ik_d1_staging_originals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_originals_update AFTER UPDATE ON ik_d1_staging_originals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_originals_delete AFTER DELETE ON ik_d1_staging_originals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_pages_insert AFTER INSERT ON ik_d1_staging_pages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_pages_update AFTER UPDATE ON ik_d1_staging_pages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_staging_pages_delete AFTER DELETE ON ik_d1_staging_pages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_origins_insert AFTER INSERT ON ik_d1_stream_origins
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_origins_update AFTER UPDATE ON ik_d1_stream_origins
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_origins_delete AFTER DELETE ON ik_d1_stream_origins
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_pages_insert AFTER INSERT ON ik_d1_stream_pages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_pages_update AFTER UPDATE ON ik_d1_stream_pages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_pages_delete AFTER DELETE ON ik_d1_stream_pages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_revisions_insert AFTER INSERT ON ik_d1_stream_revisions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_revisions_update AFTER UPDATE ON ik_d1_stream_revisions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_revisions_delete AFTER DELETE ON ik_d1_stream_revisions
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_sources_insert AFTER INSERT ON ik_d1_stream_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_sources_update AFTER UPDATE ON ik_d1_stream_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_stream_sources_delete AFTER DELETE ON ik_d1_stream_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_streams_insert AFTER INSERT ON ik_d1_streams
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_streams_update AFTER UPDATE ON ik_d1_streams
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_d1_streams_delete AFTER DELETE ON ik_d1_streams
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_apply_failures_insert AFTER INSERT ON ik_door_apply_failures
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_apply_failures_update AFTER UPDATE ON ik_door_apply_failures
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_apply_failures_delete AFTER DELETE ON ik_door_apply_failures
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_approvals_insert AFTER INSERT ON ik_door_approvals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_approvals_update AFTER UPDATE ON ik_door_approvals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_approvals_delete AFTER DELETE ON ik_door_approvals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_archive_chunks_insert AFTER INSERT ON ik_door_archive_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_archive_chunks_update AFTER UPDATE ON ik_door_archive_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_archive_chunks_delete AFTER DELETE ON ik_door_archive_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_archives_insert AFTER INSERT ON ik_door_archives
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_archives_update AFTER UPDATE ON ik_door_archives
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_archives_delete AFTER DELETE ON ik_door_archives
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_chunks_insert AFTER INSERT ON ik_door_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_chunks_update AFTER UPDATE ON ik_door_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_chunks_delete AFTER DELETE ON ik_door_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_grants_insert AFTER INSERT ON ik_door_grants
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_grants_update AFTER UPDATE ON ik_door_grants
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_grants_delete AFTER DELETE ON ik_door_grants
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_namespaces_insert AFTER INSERT ON ik_door_namespaces
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_namespaces_update AFTER UPDATE ON ik_door_namespaces
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_namespaces_delete AFTER DELETE ON ik_door_namespaces
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_plan_chunks_insert AFTER INSERT ON ik_door_plan_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_plan_chunks_update AFTER UPDATE ON ik_door_plan_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_plan_chunks_delete AFTER DELETE ON ik_door_plan_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_plans_insert AFTER INSERT ON ik_door_plans
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_plans_update AFTER UPDATE ON ik_door_plans
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_plans_delete AFTER DELETE ON ik_door_plans
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_revoked_keys_insert AFTER INSERT ON ik_door_revoked_keys
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_revoked_keys_update AFTER UPDATE ON ik_door_revoked_keys
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_revoked_keys_delete AFTER DELETE ON ik_door_revoked_keys
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_scopes_insert AFTER INSERT ON ik_door_scopes
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_scopes_update AFTER UPDATE ON ik_door_scopes
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_scopes_delete AFTER DELETE ON ik_door_scopes
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_settings_insert AFTER INSERT ON ik_door_settings
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_settings_update AFTER UPDATE ON ik_door_settings
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_settings_delete AFTER DELETE ON ik_door_settings
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_uploads_insert AFTER INSERT ON ik_door_uploads
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_uploads_update AFTER UPDATE ON ik_door_uploads
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_door_uploads_delete AFTER DELETE ON ik_door_uploads
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_jobs_insert AFTER INSERT ON ik_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_jobs_update AFTER UPDATE ON ik_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_jobs_delete AFTER DELETE ON ik_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_original_sets_insert AFTER INSERT ON ik_original_sets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_original_sets_update AFTER UPDATE ON ik_original_sets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_original_sets_delete AFTER DELETE ON ik_original_sets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_originals_insert AFTER INSERT ON ik_originals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_originals_update AFTER UPDATE ON ik_originals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_originals_delete AFTER DELETE ON ik_originals
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_provenance_insert AFTER INSERT ON ik_provenance
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_provenance_update AFTER UPDATE ON ik_provenance
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_provenance_delete AFTER DELETE ON ik_provenance
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_sources_insert AFTER INSERT ON ik_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_sources_update AFTER UPDATE ON ik_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_sources_delete AFTER DELETE ON ik_sources
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_stages_insert AFTER INSERT ON ik_stages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_stages_update AFTER UPDATE ON ik_stages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_stages_delete AFTER DELETE ON ik_stages
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_targets_insert AFTER INSERT ON ik_targets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_targets_update AFTER UPDATE ON ik_targets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_ik_targets_delete AFTER DELETE ON ik_targets
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_chunks_insert AFTER INSERT ON porthole_archive_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_chunks_update AFTER UPDATE ON porthole_archive_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_chunks_delete AFTER DELETE ON porthole_archive_chunks
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_jobs_insert AFTER INSERT ON porthole_archive_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_jobs_update AFTER UPDATE ON porthole_archive_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_jobs_delete AFTER DELETE ON porthole_archive_jobs
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_rows_insert AFTER INSERT ON porthole_archive_rows
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_rows_update AFTER UPDATE ON porthole_archive_rows
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_archive_rows_delete AFTER DELETE ON porthole_archive_rows
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_custody_insert AFTER INSERT ON porthole_migration_custody
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_custody_update AFTER UPDATE ON porthole_migration_custody
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_custody_delete AFTER DELETE ON porthole_migration_custody
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_erasure_fences_insert AFTER INSERT ON porthole_migration_erasure_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_erasure_fences_update AFTER UPDATE ON porthole_migration_erasure_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_erasure_fences_delete AFTER DELETE ON porthole_migration_erasure_fences
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_records_insert AFTER INSERT ON porthole_migration_records
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_records_update AFTER UPDATE ON porthole_migration_records
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER import_erasure_epoch_porthole_migration_records_delete AFTER DELETE ON porthole_migration_records
 BEGIN UPDATE porthole_migration_erasure_state SET revision=revision+1 WHERE singleton=1; END;
