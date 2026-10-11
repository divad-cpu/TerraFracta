# TerraFracta

TerraFracta is a source-based platform for understanding significant domestic problems, documented government
measures, implementation, results and uncertainty. Its intended reader journey is country → problem →
measure → implementation → results and uncertainty. It avoids political endorsements and government rankings.

This repository continues an existing local project. The current interface is English-first; original-language
evidence and exact supporting locations remain part of the design. Public source code does not mean that the
illustrative content, candidate sources, collection jobs or publication workflow are operationally approved.

## Current development scope

The code includes reader/navigation and evidence presentation, an editorial workspace, bounded fictional update
rehearsals, private evidence/publication contracts, diagnostics and contact-free correction development flows.
The default operational providers are unconfigured. Development previews use explicitly fictional or redacted
historical examples. Browser interaction, actual source qualification, host acceptance, rights, restoration and
unattended operation still have separate gates. NAS operation and the private SSB attempt remain deferred.

## Local development

Use Node 24.18.0 and pnpm 11.13.1, matching the current locked environment, and Python 3.12 for worker code.
Run commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
python3 -m unittest tests.test_public_repository
node --experimental-strip-types --test --test-isolation=none --test-concurrency=1 tests/fictional_saved_run_import.test.mjs tests/saved_comparison_validation_refusal.test.mjs
pnpm build
pnpm dev
```

`pnpm dev` binds to localhost. It starts no source collector, database migration or publication job. Do not run
operational/native database scripts against a primary database. Some historical research and operator tests
require intentionally private inputs and retained local evidence; they are not part of this public smoke suite.
The full local `check:local` command has additional private document/source-copy dependencies.

## Public and private material

The public tree contains reviewed original code, schema definitions, selected tests and fictional/redacted
fixtures. Real SSB samples, raw material, credentials, local logs, machine-specific evidence tools and internal
history/review reports stay outside Git. The full local project and its append-only records remain intact.
GitHub displays this README from `.github/`; the owner's detailed root README remains private.

Read [development and publication boundaries](../docs/public/DEVELOPMENT.md),
[architecture](../docs/public/ARCHITECTURE.md), and [contribution guidance](CONTRIBUTING.md).

## License

TerraFracta's original code is licensed under [MIT](../LICENSE). Third-party dependencies retain their own
licenses; lockfiles and the [package declaration inventory](../docs/OSS_PACKAGE_INVENTORY.json) record versions.
Dependency packages, build artifacts and native tool images are not vendored in this repository. See
[third-party scope](../docs/public/THIRD_PARTY.md). Code licensing does not grant rights to source data.
