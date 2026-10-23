-- Retain earlier unknown submissions independently of the deduplication clock.
ALTER TABLE porthole_health_notices ADD COLUMN had_uncertain INTEGER NOT NULL DEFAULT 0 CHECK(had_uncertain IN (0,1));
-- Older pending attempts do not carry sufficient outcome history to disprove
-- acceptance. Preserve that uncertainty when a later attempt is refused.
UPDATE porthole_health_notices SET had_uncertain=1 WHERE state IN ('sending','uncertain') OR (state='pending' AND first_attempt_at IS NOT NULL);
