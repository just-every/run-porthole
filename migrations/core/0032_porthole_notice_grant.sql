-- Private transport identity is operational custody, omitted from both archive
-- projections. Legacy work without a binding proof requires owner review.
ALTER TABLE porthole_health_notices ADD COLUMN transport_grant TEXT CHECK(transport_grant IS NULL OR (length(transport_grant)=64 AND transport_grant NOT GLOB '*[^0-9a-f]*'));
