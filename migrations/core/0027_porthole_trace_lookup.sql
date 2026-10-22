CREATE INDEX IF NOT EXISTS porthole_trace_lookup ON porthole_telemetry_records(trace_id,signal,event_time_ns,id);
