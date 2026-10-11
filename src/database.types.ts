export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  terra_private: {
    Tables: {
      automatic_route_qualifications: {
        Row: {
          change_class: string
          created_at: string
          decided_at: string
          decided_by: string
          decision: string
          decision_reference: string
          exact_endpoint: string
          id: string
          parser_version: string
          policy_version: string
          public_citation_url: string | null
          qualification_expires_at: string | null
          registration_id: string
          reviewed_sample_count: number | null
          revision: number
          semantic_contract_sha256: string | null
          unresolved_sample_errors: number | null
        }
        Insert: {
          change_class: string
          created_at?: string
          decided_at: string
          decided_by: string
          decision: string
          decision_reference: string
          exact_endpoint: string
          id?: string
          parser_version: string
          policy_version: string
          public_citation_url?: string | null
          qualification_expires_at?: string | null
          registration_id: string
          reviewed_sample_count?: number | null
          revision: number
          semantic_contract_sha256?: string | null
          unresolved_sample_errors?: number | null
        }
        Update: {
          change_class?: string
          created_at?: string
          decided_at?: string
          decided_by?: string
          decision?: string
          decision_reference?: string
          exact_endpoint?: string
          id?: string
          parser_version?: string
          policy_version?: string
          public_citation_url?: string | null
          qualification_expires_at?: string | null
          registration_id?: string
          reviewed_sample_count?: number | null
          revision?: number
          semantic_contract_sha256?: string | null
          unresolved_sample_errors?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automatic_route_qualifications_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_assertion_reviews: {
        Row: {
          claim_id: string
          claim_type: string | null
          created_at: string
          decision: string
          display_assertion: string | null
          publication_id: string
          review_reference: string
          reviewed_at: string
          revision: number
        }
        Insert: {
          claim_id: string
          claim_type?: string | null
          created_at?: string
          decision: string
          display_assertion?: string | null
          publication_id: string
          review_reference: string
          reviewed_at: string
          revision: number
        }
        Update: {
          claim_id?: string
          claim_type?: string | null
          created_at?: string
          decision?: string
          display_assertion?: string | null
          publication_id?: string
          review_reference?: string
          reviewed_at?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "claim_assertion_reviews_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_assertion_reviews_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_evidence: {
        Row: {
          claim_id: string
          created_at: string
          id: string
          locator: string
          origin_group: string
          relation: string
          source_version_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          id?: string
          locator: string
          origin_group: string
          relation: string
          source_version_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          id?: string
          locator?: string
          origin_group?: string
          relation?: string
          source_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_evidence_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_evidence_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_period_reviews: {
        Row: {
          claim_id: string
          created_at: string
          decision: string
          period_label: string | null
          publication_id: string
          review_reference: string
          reviewed_at: string
          revision: number
        }
        Insert: {
          claim_id: string
          created_at?: string
          decision: string
          period_label?: string | null
          publication_id: string
          review_reference: string
          reviewed_at: string
          revision: number
        }
        Update: {
          claim_id?: string
          created_at?: string
          decision?: string
          period_label?: string | null
          publication_id?: string
          review_reference?: string
          reviewed_at?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "claim_period_reviews_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_period_reviews_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          assertion: string
          claim_type: string
          created_at: string
          evidence_state: string
          id: string
          issue_id: string
          period_end: string | null
          period_precision: string
          period_start: string | null
        }
        Insert: {
          assertion: string
          claim_type: string
          created_at?: string
          evidence_state?: string
          id?: string
          issue_id: string
          period_end?: string | null
          period_precision?: string
          period_start?: string | null
        }
        Update: {
          assertion?: string
          claim_type?: string
          created_at?: string
          evidence_state?: string
          id?: string
          issue_id?: string
          period_end?: string | null
          period_precision?: string
          period_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issue_dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_reports: {
        Row: {
          claim_id: string | null
          details: string
          id: string
          issue_id: string
          publication_id: string
          report_kind: string
          reported_at: string
          resolution_note: string | null
          review_state: string
          reviewed_at: string | null
          source_url: string | null
        }
        Insert: {
          claim_id?: string | null
          details: string
          id?: string
          issue_id: string
          publication_id: string
          report_kind: string
          reported_at?: string
          resolution_note?: string | null
          review_state?: string
          reviewed_at?: string | null
          source_url?: string | null
        }
        Update: {
          claim_id?: string | null
          details?: string
          id?: string
          issue_id?: string
          publication_id?: string
          report_kind?: string
          reported_at?: string
          resolution_note?: string | null
          review_state?: string
          reviewed_at?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "correction_reports_claim_id_issue_id_fkey"
            columns: ["claim_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id", "issue_id"]
          },
          {
            foreignKeyName: "correction_reports_publication_id_issue_id_fkey"
            columns: ["publication_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id", "issue_id"]
          },
        ]
      }
      issue_dossiers: {
        Row: {
          affected_population: string
          created_at: string
          editorial_state: string
          id: string
          issue_key: string
          jurisdiction_id: string
          public_slug: string | null
          selection_rationale: string
          title: string
        }
        Insert: {
          affected_population: string
          created_at?: string
          editorial_state?: string
          id?: string
          issue_key: string
          jurisdiction_id: string
          public_slug?: string | null
          selection_rationale: string
          title: string
        }
        Update: {
          affected_population?: string
          created_at?: string
          editorial_state?: string
          id?: string
          issue_key?: string
          jurisdiction_id?: string
          public_slug?: string | null
          selection_rationale?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_dossiers_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_heads: {
        Row: {
          changed_at: string | null
          current_publication_id: string | null
          issue_id: string
        }
        Insert: {
          changed_at?: string | null
          current_publication_id?: string | null
          issue_id: string
        }
        Update: {
          changed_at?: string | null
          current_publication_id?: string | null
          issue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_heads_current_publication_id_issue_id_fkey"
            columns: ["current_publication_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id", "issue_id"]
          },
          {
            foreignKeyName: "issue_heads_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: true
            referencedRelation: "issue_dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_publication_citations: {
        Row: {
          claim_id: string
          created_at: string
          issue_id: string
          locator: string
          publication_id: string
          relation: string
          source_version_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          issue_id: string
          locator: string
          publication_id: string
          relation: string
          source_version_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          issue_id?: string
          locator?: string
          publication_id?: string
          relation?: string
          source_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_publication_citations_claim_id_issue_id_fkey"
            columns: ["claim_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id", "issue_id"]
          },
          {
            foreignKeyName: "issue_publication_citations_claim_id_source_version_id_loc_fkey"
            columns: ["claim_id", "source_version_id", "locator", "relation"]
            isOneToOne: false
            referencedRelation: "claim_evidence"
            referencedColumns: [
              "claim_id",
              "source_version_id",
              "locator",
              "relation",
            ]
          },
          {
            foreignKeyName: "issue_publication_citations_publication_id_issue_id_fkey"
            columns: ["publication_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id", "issue_id"]
          },
        ]
      }
      issue_publication_machine_bindings: {
        Row: {
          claim_id: string
          decision_id: string
          linked_at: string
          publication_id: string
        }
        Insert: {
          claim_id: string
          decision_id: string
          linked_at?: string
          publication_id: string
        }
        Update: {
          claim_id?: string
          decision_id?: string
          linked_at?: string
          publication_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_publication_machine_bindings_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_publication_machine_bindings_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "machine_candidate_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_publication_machine_bindings_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_publications: {
        Row: {
          created_at: string
          dependency_manifest: Json
          id: string
          issue_id: string
          predecessor_id: string | null
          publication_kind: string
          revision: number
          snapshot: Json
        }
        Insert: {
          created_at?: string
          dependency_manifest: Json
          id?: string
          issue_id: string
          predecessor_id?: string | null
          publication_kind?: string
          revision: number
          snapshot: Json
        }
        Update: {
          created_at?: string
          dependency_manifest?: Json
          id?: string
          issue_id?: string
          predecessor_id?: string | null
          publication_kind?: string
          revision?: number
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "issue_publications_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issue_dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_publications_predecessor_id_issue_id_fkey"
            columns: ["predecessor_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id", "issue_id"]
          },
        ]
      }
      issue_text_reviews: {
        Row: {
          created_at: string
          decision: string
          display_summary: string | null
          display_title: string | null
          publication_id: string
          review_reference: string
          reviewed_at: string
          revision: number
        }
        Insert: {
          created_at?: string
          decision: string
          display_summary?: string | null
          display_title?: string | null
          publication_id: string
          review_reference: string
          reviewed_at: string
          revision: number
        }
        Update: {
          created_at?: string
          decision?: string
          display_summary?: string | null
          display_title?: string | null
          publication_id?: string
          review_reference?: string
          reviewed_at?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "issue_text_reviews_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdictions: {
        Row: {
          coverage_state: string
          created_at: string
          display_name: string
          id: string
          public_slug: string | null
        }
        Insert: {
          coverage_state?: string
          created_at?: string
          display_name: string
          id: string
          public_slug?: string | null
        }
        Update: {
          coverage_state?: string
          created_at?: string
          display_name?: string
          id?: string
          public_slug?: string | null
        }
        Relationships: []
      }
      machine_candidate_decisions: {
        Row: {
          candidate_key: string
          check_trace: Json
          content_sha256: string
          created_at: string
          decided_at: string
          disposition: string
          evidence_locator: string
          id: string
          machine_actor: string
          public_citation_url: string | null
          qualification_id: string
          reason_codes: string[]
          run_id: string
          semantic_contract_sha256: string | null
          source_version_id: string
        }
        Insert: {
          candidate_key: string
          check_trace: Json
          content_sha256: string
          created_at?: string
          decided_at: string
          disposition: string
          evidence_locator: string
          id?: string
          machine_actor: string
          public_citation_url?: string | null
          qualification_id: string
          reason_codes: string[]
          run_id: string
          semantic_contract_sha256?: string | null
          source_version_id: string
        }
        Update: {
          candidate_key?: string
          check_trace?: Json
          content_sha256?: string
          created_at?: string
          decided_at?: string
          disposition?: string
          evidence_locator?: string
          id?: string
          machine_actor?: string
          public_citation_url?: string | null
          qualification_id?: string
          reason_codes?: string[]
          run_id?: string
          semantic_contract_sha256?: string | null
          source_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_candidate_decisions_qualification_id_fkey"
            columns: ["qualification_id"]
            isOneToOne: false
            referencedRelation: "automatic_route_qualifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_candidate_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_candidate_decisions_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_publication_activations: {
        Row: {
          activated_at: string
          decision_id: string
          expected_head: string | null
          publication_id: string
          publication_sha256: string
          request_fingerprint: string
          run_id: string
          work_claim_id: string
        }
        Insert: {
          activated_at?: string
          decision_id: string
          expected_head?: string | null
          publication_id: string
          publication_sha256: string
          request_fingerprint: string
          run_id: string
          work_claim_id: string
        }
        Update: {
          activated_at?: string
          decision_id?: string
          expected_head?: string | null
          publication_id?: string
          publication_sha256?: string
          request_fingerprint?: string
          run_id?: string
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_publication_activations_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "machine_candidate_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_publication_activations_expected_head_fkey"
            columns: ["expected_head"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_publication_activations_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: true
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_publication_activations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_publication_activations_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      source_checkpoints: {
        Row: {
          last_attempted_at: string
          last_pair_state: string
          last_response_pair_id: string
          last_source_version_id: string
          last_successful_retrieved_at: string
          registration_id: string
          updated_at: string
        }
        Insert: {
          last_attempted_at: string
          last_pair_state?: string
          last_response_pair_id: string
          last_source_version_id: string
          last_successful_retrieved_at: string
          registration_id: string
          updated_at?: string
        }
        Update: {
          last_attempted_at?: string
          last_pair_state?: string
          last_response_pair_id?: string
          last_source_version_id?: string
          last_successful_retrieved_at?: string
          registration_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_checkpoints_last_source_version_id_registration_id_fkey"
            columns: ["last_source_version_id", "registration_id"]
            isOneToOne: false
            referencedRelation: "source_work_items"
            referencedColumns: ["source_version_id", "registration_id"]
          },
          {
            foreignKeyName: "source_checkpoints_pair_identity_fkey"
            columns: [
              "last_response_pair_id",
              "registration_id",
              "last_source_version_id",
              "last_successful_retrieved_at",
            ]
            isOneToOne: false
            referencedRelation: "source_response_pairs"
            referencedColumns: [
              "id",
              "registration_id",
              "data_version_id",
              "data_retrieved_at",
            ]
          },
          {
            foreignKeyName: "source_checkpoints_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: true
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_checkpoints_usable_pair_fkey"
            columns: [
              "last_response_pair_id",
              "registration_id",
              "last_pair_state",
            ]
            isOneToOne: false
            referencedRelation: "source_pair_validations"
            referencedColumns: [
              "pair_id",
              "registration_id",
              "validation_state",
            ]
          },
        ]
      }
      source_display_reviews: {
        Row: {
          created_at: string
          decision: string
          display_title: string | null
          review_reference: string
          reviewed_at: string
          revision: number
          source_version_id: string
          title_language: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          display_title?: string | null
          review_reference: string
          reviewed_at: string
          revision: number
          source_version_id: string
          title_language?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          display_title?: string | null
          review_reference?: string
          reviewed_at?: string
          revision?: number
          source_version_id?: string
          title_language?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_display_reviews_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      source_pair_run_bindings: {
        Row: {
          bound_at: string
          data_source_key: string
          metadata_source_key: string
          pair_id: string
          run_id: string
          work_claim_id: string
        }
        Insert: {
          bound_at?: string
          data_source_key: string
          metadata_source_key: string
          pair_id: string
          run_id: string
          work_claim_id: string
        }
        Update: {
          bound_at?: string
          data_source_key?: string
          metadata_source_key?: string
          pair_id?: string
          run_id?: string
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_pair_run_bindings_pair_id_fkey"
            columns: ["pair_id"]
            isOneToOne: true
            referencedRelation: "source_response_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_pair_run_bindings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_pair_run_bindings_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      source_pair_validations: {
        Row: {
          assessed_at: string | null
          created_at: string
          pair_id: string
          reason_code: string | null
          registration_id: string
          validation_state: string
        }
        Insert: {
          assessed_at?: string | null
          created_at?: string
          pair_id: string
          reason_code?: string | null
          registration_id: string
          validation_state?: string
        }
        Update: {
          assessed_at?: string | null
          created_at?: string
          pair_id?: string
          reason_code?: string | null
          registration_id?: string
          validation_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_pair_validations_pair_id_registration_id_fkey"
            columns: ["pair_id", "registration_id"]
            isOneToOne: false
            referencedRelation: "source_response_pairs"
            referencedColumns: ["id", "registration_id"]
          },
        ]
      }
      source_raw_pair_artifacts: {
        Row: {
          created_at: string
          data_retrieved_at: string
          data_sha256: string
          data_version_id: string
          expires_at: string
          metadata_retrieved_at: string
          metadata_sha256: string
          metadata_version_id: string
          pair_id: string
          raw_attempt_id: string
          stored_at: string
        }
        Insert: {
          created_at?: string
          data_retrieved_at: string
          data_sha256: string
          data_version_id: string
          expires_at: string
          metadata_retrieved_at: string
          metadata_sha256: string
          metadata_version_id: string
          pair_id: string
          raw_attempt_id: string
          stored_at: string
        }
        Update: {
          created_at?: string
          data_retrieved_at?: string
          data_sha256?: string
          data_version_id?: string
          expires_at?: string
          metadata_retrieved_at?: string
          metadata_sha256?: string
          metadata_version_id?: string
          pair_id?: string
          raw_attempt_id?: string
          stored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_artifact_data_hash_fkey"
            columns: ["data_version_id", "data_sha256"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "content_sha256"]
          },
          {
            foreignKeyName: "raw_artifact_metadata_hash_fkey"
            columns: ["metadata_version_id", "metadata_sha256"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "content_sha256"]
          },
          {
            foreignKeyName: "raw_artifact_pair_versions_fkey"
            columns: ["pair_id", "metadata_version_id", "data_version_id"]
            isOneToOne: false
            referencedRelation: "source_response_pairs"
            referencedColumns: ["id", "metadata_version_id", "data_version_id"]
          },
          {
            foreignKeyName: "source_raw_pair_artifacts_pair_id_metadata_retrieved_at_da_fkey"
            columns: ["pair_id", "metadata_retrieved_at", "data_retrieved_at"]
            isOneToOne: false
            referencedRelation: "source_response_pairs"
            referencedColumns: [
              "id",
              "metadata_retrieved_at",
              "data_retrieved_at",
            ]
          },
        ]
      }
      source_registrations: {
        Row: {
          allow_fetch: boolean
          allow_model_processing: boolean
          allow_public_derived: boolean
          allow_quote: boolean
          allow_retain: boolean
          created_at: string
          exact_endpoint: string
          fetch_enabled: boolean
          id: string
          publisher: string
          registration_state: string
          reviewed_at: string | null
          rights_basis_url: string | null
          source_key: string
        }
        Insert: {
          allow_fetch?: boolean
          allow_model_processing?: boolean
          allow_public_derived?: boolean
          allow_quote?: boolean
          allow_retain?: boolean
          created_at?: string
          exact_endpoint: string
          fetch_enabled?: boolean
          id?: string
          publisher: string
          registration_state?: string
          reviewed_at?: string | null
          rights_basis_url?: string | null
          source_key: string
        }
        Update: {
          allow_fetch?: boolean
          allow_model_processing?: boolean
          allow_public_derived?: boolean
          allow_quote?: boolean
          allow_retain?: boolean
          created_at?: string
          exact_endpoint?: string
          fetch_enabled?: boolean
          id?: string
          publisher?: string
          registration_state?: string
          reviewed_at?: string | null
          rights_basis_url?: string | null
          source_key?: string
        }
        Relationships: []
      }
      source_response_dispatches: {
        Row: {
          dispatched_at: string
          reservation_id: string
          work_claim_id: string
        }
        Insert: {
          dispatched_at?: string
          reservation_id: string
          work_claim_id: string
        }
        Update: {
          dispatched_at?: string
          reservation_id?: string
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_response_dispatches_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: true
            referencedRelation: "source_response_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_response_dispatches_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      source_response_pairs: {
        Row: {
          attempt_key: string
          created_at: string
          data_retrieved_at: string
          data_version_id: string
          id: string
          metadata_registration_id: string
          metadata_retrieved_at: string
          metadata_version_id: string
          registration_id: string
        }
        Insert: {
          attempt_key: string
          created_at?: string
          data_retrieved_at: string
          data_version_id: string
          id?: string
          metadata_registration_id: string
          metadata_retrieved_at: string
          metadata_version_id: string
          registration_id: string
        }
        Update: {
          attempt_key?: string
          created_at?: string
          data_retrieved_at?: string
          data_version_id?: string
          id?: string
          metadata_registration_id?: string
          metadata_retrieved_at?: string
          metadata_version_id?: string
          registration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_pair_metadata_context_version_fkey"
            columns: ["metadata_version_id", "metadata_registration_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "registration_id"]
          },
          {
            foreignKeyName: "source_response_pairs_data_version_id_registration_id_fkey"
            columns: ["data_version_id", "registration_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "registration_id"]
          },
          {
            foreignKeyName: "source_response_pairs_metadata_registration_id_fkey"
            columns: ["metadata_registration_id"]
            isOneToOne: false
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_response_pairs_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      source_response_reservations: {
        Row: {
          endpoint_sha256: string
          id: string
          max_body_bytes: number
          registration_id: string
          request_key: string
          reserved_at: string
          run_id: string
          work_claim_id: string
        }
        Insert: {
          endpoint_sha256: string
          id?: string
          max_body_bytes: number
          registration_id: string
          request_key: string
          reserved_at?: string
          run_id: string
          work_claim_id: string
        }
        Update: {
          endpoint_sha256?: string
          id?: string
          max_body_bytes?: number
          registration_id?: string
          request_key?: string
          reserved_at?: string
          run_id?: string
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_response_reservations_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_response_reservations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_response_reservations_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      source_response_settlements: {
        Row: {
          body_bytes: number
          content_sha256: string | null
          outcome: string
          reservation_id: string
          settled_at: string
          work_claim_id: string
        }
        Insert: {
          body_bytes: number
          content_sha256?: string | null
          outcome: string
          reservation_id: string
          settled_at?: string
          work_claim_id: string
        }
        Update: {
          body_bytes?: number
          content_sha256?: string | null
          outcome?: string
          reservation_id?: string
          settled_at?: string
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_response_settlements_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: true
            referencedRelation: "source_response_dispatches"
            referencedColumns: ["reservation_id"]
          },
          {
            foreignKeyName: "source_response_settlements_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      source_versions: {
        Row: {
          content_sha256: string
          created_at: string
          id: string
          item_key: string
          language_code: string | null
          published_at: string | null
          registration_id: string
          retained_kind: string
          retained_reference: string | null
          retrieved_at: string
          source_updated_at: string | null
          source_url: string
        }
        Insert: {
          content_sha256: string
          created_at?: string
          id?: string
          item_key: string
          language_code?: string | null
          published_at?: string | null
          registration_id: string
          retained_kind?: string
          retained_reference?: string | null
          retrieved_at: string
          source_updated_at?: string | null
          source_url: string
        }
        Update: {
          content_sha256?: string
          created_at?: string
          id?: string
          item_key?: string
          language_code?: string | null
          published_at?: string | null
          registration_id?: string
          retained_kind?: string
          retained_reference?: string | null
          retrieved_at?: string
          source_updated_at?: string | null
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_versions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      source_work_items: {
        Row: {
          first_seen_at: string
          last_error_code: string | null
          processed_at: string | null
          processing_state: string
          registration_id: string
          source_version_id: string
        }
        Insert: {
          first_seen_at?: string
          last_error_code?: string | null
          processed_at?: string | null
          processing_state?: string
          registration_id: string
          source_version_id: string
        }
        Update: {
          first_seen_at?: string
          last_error_code?: string | null
          processed_at?: string | null
          processing_state?: string
          registration_id?: string
          source_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_work_items_source_version_id_registration_id_fkey"
            columns: ["source_version_id", "registration_id"]
            isOneToOne: true
            referencedRelation: "source_versions"
            referencedColumns: ["id", "registration_id"]
          },
        ]
      }
      synthetic_visibility_attempts: {
        Row: {
          attempt_key: string
          canonical_observations: string
          id: string
          observations_sha256: string
          publication_id: string
          publication_sha256: string
          recorded_at: string
          run_id: string
        }
        Insert: {
          attempt_key: string
          canonical_observations: string
          id?: string
          observations_sha256: string
          publication_id: string
          publication_sha256: string
          recorded_at?: string
          run_id: string
        }
        Update: {
          attempt_key?: string
          canonical_observations?: string
          id?: string
          observations_sha256?: string
          publication_id?: string
          publication_sha256?: string
          recorded_at?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "synthetic_visibility_attempts_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "issue_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synthetic_visibility_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_run_closeouts"
            referencedColumns: ["run_id"]
          },
        ]
      }
      update_run_closeouts: {
        Row: {
          finished_at: string
          manifest_sha256: string
          run_id: string
          summary: Json
          work_claim_id: string
        }
        Insert: {
          finished_at?: string
          manifest_sha256: string
          run_id: string
          summary: Json
          work_claim_id: string
        }
        Update: {
          finished_at?: string
          manifest_sha256?: string
          run_id?: string
          summary?: Json
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_run_closeouts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_run_closeouts_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      update_run_manifests: {
        Row: {
          canonical_manifest: string
          captured_at: string
          manifest_sha256: string
          run_id: string
          work_claim_id: string
        }
        Insert: {
          canonical_manifest: string
          captured_at?: string
          manifest_sha256: string
          run_id: string
          work_claim_id: string
        }
        Update: {
          canonical_manifest?: string
          captured_at?: string
          manifest_sha256?: string
          run_id?: string
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_run_manifests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_run_manifests_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      update_run_requests: {
        Row: {
          admitted_at: string
          canonical_request: string
          run_id: string
        }
        Insert: {
          admitted_at?: string
          canonical_request: string
          run_id: string
        }
        Update: {
          admitted_at?: string
          canonical_request?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_run_requests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      update_run_source_checks: {
        Row: {
          checked_at: string
          content_sha256: string | null
          outcome: string
          registration_id: string
          run_id: string
          source_key: string
          source_version_id: string | null
          total_response_bytes: number
          work_claim_id: string
        }
        Insert: {
          checked_at?: string
          content_sha256?: string | null
          outcome: string
          registration_id: string
          run_id: string
          source_key: string
          source_version_id?: string | null
          total_response_bytes: number
          work_claim_id: string
        }
        Update: {
          checked_at?: string
          content_sha256?: string | null
          outcome?: string
          registration_id?: string
          run_id?: string
          source_key?: string
          source_version_id?: string | null
          total_response_bytes?: number
          work_claim_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_run_source_checks_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "source_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_run_source_checks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_run_source_checks_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_run_source_checks_work_claim_id_fkey"
            columns: ["work_claim_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      update_run_work_claims: {
        Row: {
          attempt_key: string
          attempt_no: number
          claimed_at: string
          id: string
          initial_expires_at: string
          run_id: string
        }
        Insert: {
          attempt_key: string
          attempt_no: number
          claimed_at: string
          id?: string
          initial_expires_at: string
          run_id: string
        }
        Update: {
          attempt_key?: string
          attempt_no?: number
          claimed_at?: string
          id?: string
          initial_expires_at?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_run_work_claims_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      update_run_work_state: {
        Row: {
          claim_id: string
          deadline_at: string
          lease_expires_at: string
          run_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          claim_id: string
          deadline_at: string
          lease_expires_at: string
          run_id: string
          started_at: string
          updated_at: string
        }
        Update: {
          claim_id?: string
          deadline_at?: string
          lease_expires_at?: string
          run_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_run_work_state_claim_id_run_id_fkey"
            columns: ["claim_id", "run_id"]
            isOneToOne: false
            referencedRelation: "update_run_work_claims"
            referencedColumns: ["id", "run_id"]
          },
          {
            foreignKeyName: "update_run_work_state_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "update_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      update_runs: {
        Row: {
          code_version: string | null
          commit_state: string
          created_at: string
          finished_at: string | null
          id: string
          jurisdiction_id: string
          limits: Json
          mode: string
          policy_version: string | null
          request_fingerprint: string
          request_key: string
          requested_by: string
          run_state: string
          visibility_state: string
        }
        Insert: {
          code_version?: string | null
          commit_state?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          jurisdiction_id: string
          limits?: Json
          mode: string
          policy_version?: string | null
          request_fingerprint: string
          request_key: string
          requested_by: string
          run_state?: string
          visibility_state?: string
        }
        Update: {
          code_version?: string | null
          commit_state?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          jurisdiction_id?: string
          limits?: Json
          mode?: string
          policy_version?: string | null
          request_fingerprint?: string
          request_key?: string
          requested_by?: string
          run_state?: string
          visibility_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_runs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_machine_publication: {
        Args: {
          p_decision: string
          p_expected_head: string
          p_fingerprint: string
          p_lease: string
          p_publication: string
          p_publication_sha256: string
        }
        Returns: Json
      }
      admit_update_run: {
        Args: { p_canonical: string; p_key: string }
        Returns: Json
      }
      assert_response_capture: {
        Args: {
          p_claim: string
          p_endpoint_sha256: string
          p_fingerprint: string
          p_registration: string
          p_run: string
        }
        Returns: undefined
      }
      assert_update_run_work: {
        Args: { p_fingerprint: string; p_lease: string; p_run: string }
        Returns: undefined
      }
      claim_update_run_work: {
        Args: { p_attempt: string; p_fingerprint: string; p_run: string }
        Returns: Json
      }
      close_update_run_processing: {
        Args: {
          p_fingerprint: string
          p_lease: string
          p_manifest_sha256: string
          p_run: string
        }
        Returns: Json
      }
      dispatch_source_response: {
        Args: {
          p_claim: string
          p_fingerprint: string
          p_reservation: string
          p_run: string
        }
        Returns: Json
      }
      has_exact_json_keys: {
        Args: { expected: string[]; value: Json }
        Returns: boolean
      }
      is_bounded_reader_candidate: { Args: { value: Json }; Returns: boolean }
      is_closed_public_issue_payload: {
        Args: { issue_snapshot: Json; source_manifest: Json }
        Returns: boolean
      }
      machine_publication_hash: {
        Args: {
          p: Database["terra_private"]["Tables"]["issue_publications"]["Row"]
        }
        Returns: string
      }
      read_latest_synthetic_visibility: {
        Args: { p_publication: string; p_run: string }
        Returns: Json
      }
      record_synthetic_visibility_attempt: {
        Args: {
          p_canonical: string
          p_fingerprint: string
          p_key: string
          p_publication: string
          p_publication_hash: string
          p_run: string
        }
        Returns: Json
      }
      renew_update_run_work: {
        Args: { p_fingerprint: string; p_lease: string; p_run: string }
        Returns: Json
      }
      reserve_source_response: {
        Args: {
          p_claim: string
          p_fingerprint: string
          p_key: string
          p_max_body: number
          p_registration: string
          p_run: string
        }
        Returns: Json
      }
      response_reservation_receipt: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      response_reserved_charge: { Args: { p_run: string }; Returns: number }
      settle_source_response: {
        Args: {
          p_body_bytes: number
          p_claim: string
          p_content_sha256: string
          p_fingerprint: string
          p_outcome: string
          p_reservation: string
          p_run: string
        }
        Returns: Json
      }
      summarize_run_processing: { Args: { p_run: string }; Returns: Json }
      summarize_synthetic_visibility: {
        Args: { p: Json; p_current_publication: string }
        Returns: Json
      }
      synthetic_visibility_receipt: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      validate_run_manifest: { Args: { p_canonical: string }; Returns: Json }
      validate_synthetic_visibility_attempt: {
        Args: { p_canonical: string }
        Returns: Json
      }
      validate_update_request: {
        Args: { p_canonical: string; p_key: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  terra_private: {
    Enums: {},
  },
} as const

