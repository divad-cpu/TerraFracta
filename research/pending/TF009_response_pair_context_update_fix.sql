-- Isolated additive correction only. Preserve pre-fix databases and findings.
-- Closed owner-only schema; no runtime or primary migration is authorized.
drop trigger response_pair_context_binding_commit on terra_private.source_response_pairs;
create constraint trigger response_pair_context_binding_commit after insert or update on terra_private.source_response_pairs
 deferrable initially deferred for each row execute function terra_private.require_response_pair_context_binding();
