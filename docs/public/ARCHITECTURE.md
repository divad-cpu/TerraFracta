# Architecture

TerraFracta uses a modular Next.js/TypeScript application, Python worker modules and PostgreSQL/Supabase schema
definitions. The source tree preserves the existing project; this repository adds a controlled public boundary.

- `app/` provides the reader, evidence and development editorial/diagnostic surfaces.
- `src/` supplies checked projections, strict contracts, bounded native readers, ownership/deadline controls
  and server-side access adapters. Operational providers remain unconfigured by default.
- `workers/` and `scripts/` implement structured processing and bounded fictional/offline paths. Historical
  machine-specific inspection/export scripts remain private. A script's presence is not authority to run it.
- `supabase/` contains schema definitions and tests; publishing code applies no migration.
- `fixtures/` contains selected fictional or explicitly redacted historical examples; three real SSB research
  data/metadata samples are intentionally absent.
- `research/pending/*.sql` contains original implementation/test SQL, not approval reports or raw source data.

Raw material, drafts, control/review records and published data are separate. Routine update jobs may change
qualified content, never code, schema, source approval, access rules or publication policy. Every entry point
must use the same bounded operation. Repeated runs preserve identity and deduplicate evidence.

The owner-selected storage direction remains NAS first, own cloud later. No PC operational substitute,
scheduled source request, provider configuration, public content release or correction intake is enabled here.
