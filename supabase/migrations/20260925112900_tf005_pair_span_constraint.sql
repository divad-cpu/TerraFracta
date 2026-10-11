-- TF-005: align the private pair table with the offline five-minute limit.
-- Existing metadata-first order constraint remains. No role grants or runtime.

alter table terra_private.source_response_pairs
  add constraint source_response_pairs_max_five_minute_span
  check (data_retrieved_at <= metadata_retrieved_at + interval '5 minutes');
