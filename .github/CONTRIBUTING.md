# Contributing to TerraFracta

Inspect nearby code and the locked versions before editing. Keep changes small, preserve unrelated work and
use the existing architecture and package managers. Prefer suitable maintained open-source implementations
or existing dependencies, with exact license/provenance and notice review, before adding custom components.

Use English for code and durable technical documentation. Preserve the source → assertion → supporting
location chain and distinguish announced, adopted, funded, implemented and observed outcomes. Improvement
after a measure is not evidence of causation. Never add political endorsements or government rankings.

Run the affected tests and type/build checks. Code CI is a bounded smoke gate, not full-platform or operational
acceptance. Material changes to access, evidence semantics or publication need a separate independent review.
Read relevant installed `node_modules/next/dist/docs/` guidance for the locked Next.js version.

Before committing, run `python3 scripts/check_public_repository.py` and inspect the explicit staged paths.
Use a maintained secret scanner, such as Gitleaks with redacted output, on the exact candidate. Never stage
credentials, real source samples, raw evidence, private reports, local databases, logs or machine-specific
retained artifacts. Do not use broad staging or force-add an ignored path. Extend the public path policy only
after a disclosure review. Preserve excluded local work; do not delete it to make a check pass.

Submit a focused pull request describing the problem, behavior and actual checks. Source collection,
publication, deployment, credentials, database mutation and schedules retain separate owner authorization.
