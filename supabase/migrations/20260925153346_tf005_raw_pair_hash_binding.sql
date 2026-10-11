-- TF-005 private integrity: a raw folder's hashes must name the exact source
-- versions selected by its response pair. All parts remain private.
-- No collector writer, live source, retention timer or publication grant.
begin;

alter table terra_private.source_versions
  add constraint source_versions_id_content_hash_key
  unique (id, content_sha256);

alter table terra_private.source_response_pairs
  add constraint source_response_pairs_id_versions_key
  unique (id, metadata_version_id, data_version_id);

alter table terra_private.source_raw_pair_artifacts
  add column metadata_version_id uuid not null,
  add column data_version_id uuid not null,
  add constraint raw_artifact_pair_versions_fkey
    foreign key (pair_id, metadata_version_id, data_version_id)
    references terra_private.source_response_pairs
      (id, metadata_version_id, data_version_id),
  add constraint raw_artifact_metadata_hash_fkey
    foreign key (metadata_version_id, metadata_sha256)
    references terra_private.source_versions (id, content_sha256),
  add constraint raw_artifact_data_hash_fkey
    foreign key (data_version_id, data_sha256)
    references terra_private.source_versions (id, content_sha256);

create index raw_artifact_metadata_version_hash_idx
  on terra_private.source_raw_pair_artifacts (metadata_version_id, metadata_sha256);
create index raw_artifact_data_version_hash_idx
  on terra_private.source_raw_pair_artifacts (data_version_id, data_sha256);

commit;
