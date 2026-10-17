# Third-party and distribution scope

## Reuse in complete capture and restricted-result recovery — 2026-10-15T18:50:04.569084+00:00

The new invented custody/capture/recovery examples use existing Python standard-library and project ports, locked Zod/React/Next dependencies, and PostgreSQL native transactions, FKs, ACL/RLS and dump/restore facilities. No package or lockfile change, upstream implementation vendoring, action/image upgrade or alternate storage provider is introduced. Exact frozen local Zod runtime evidence retains its upstream license; neither dependency files nor native PostgreSQL binaries/images are added to the public source.


Restricted original-document read/recovery and retained-pair comparison reuse existing locked Python/feedparser and PostgreSQL17 SQL/ACL/RLS/pg_dump/psql facilities. No new package, tokenizer, provider SDK, image/action upgrade or vendored implementation is added. Source/data rights and any future binary/image distribution obligations remain separate.


The retained-original/recovery/metadata composition uses existing locked parser, Python standard library and PostgreSQL17 native tools through established bounded custodians. No new dependency, upstream source, SDK or orchestration package is added. Source/data rights and any native image/binary distribution obligations remain separate.


The invented collection-window/recovery composition reuses the established locked parser, Python standard library and PostgreSQL17 native facilities through existing bounded custodians. No new dependency, provider SDK, orchestrator or upstream source is added. Source/data rights and any native image/binary distribution obligations remain separate.


The original-document worker composition uses existing Python standard-library facilities, locked feedparser and PostgreSQL17 native SQL/ACL/RLS/dump/psql facilities in the existing pinned local image. No tokenizer/provider SDK, parser framework or new dependency is added or vendored. Local project-specific wrappers bind provenance, request identity and refusal behavior; source/data reuse rights and future binary/image distribution obligations remain independent.


The invented PostgreSQL feed trial reuses the existing locally installed pinned Supabase PostgreSQL17 image through native PostgreSQL SQL/psql. No image, PostgreSQL source/binary, SDK or new Python package is vendored in this repository. Native trial use and any future image/binary distribution have separate actual-artifact license/notice obligations. Dependency locks and public action pins are unchanged.


The isolated invented feed journal uses the existing Python standard-library sqlite3 interface and the installed system SQLite runtime; no SQLite source, native library or database file is vendored or selected for public distribution. Dependency locks and the selected operational PostgreSQL architecture are unchanged. Binary/package distribution still needs its own actual-artifact obligations review.

The MIT license applies to TerraFracta's original source and documentation. It does not relicense third-party
packages or source data. No dependency install tree, compiled Next.js output, native image, upstream archive
or private supplier/evidence packet is included in the public source tree.

Current direct dependencies: Next.js 16.3.6, React/React DOM 19.3.0, Zod 4.6.5 and pg 8.23.1 (MIT);
TypeScript 5.9.3 (Apache-2.0) and the declared @types packages remain locked in pnpm. Python's standard library
is used under its existing runtime terms. The package inventory records declaration and top-level notice
hashes; it is not a complete bundled-file or binary-distribution audit. Preserve upstream notices when
installing or distributing packages. Binary/native/container distribution still needs its existing review.

Publication preparation reuses installed Git/GitHub CLI, Gitleaks and actionlint, plus Python's standard
library. Code-only CI actions are pinned to upstream commit identities; they are fetched by GitHub, not
vendored or relicensed here. That original publication-preparation package introduced no new application
dependency or lockfile version; the later offline worker addition is recorded below.

## Offline feed discovery addition — 2026-10-14

The subsequent offline feed wrapper adds feedparser 6.0.14 (BSD-2-Clause) and its locked transitive
feedparser-sgmllib 2.1.0 (PSF-2.0) through `pyproject.toml` and `uv.lock`. No other package is upgraded.
The Node declaration inventory above retains its Node-only scope. Installed wheel notice evidence:

| Package | Installed notice | Bytes | SHA-256 |
| --- | --- | --- | --- |
| feedparser 6.0.14 | `feedparser-6.0.14.dist-info/licenses/LICENSE` | 3,146 | `9f5e92783fd9beb2a9de76acda32a8f96ee8552a2b566e3923f037f0d754222a` |
| feedparser-sgmllib 2.1.0 | `feedparser_sgmllib-2.1.0.dist-info/licenses/LICENSE` | 12,775 | `de4d1f2d2ad5ad0cfd1657a106476b31cb5db5ef9d1ff842b237c0c81f0c8a23` |

Retain those upstream notice files when installing or distributing the packages; the source repository does
not vendor the libraries. Library code is reused through its public in-memory parse API. Only the bounded
source/format/identity checks, exact lead projection and hold reasons are project-specific. No feed data is
licensed or approved by this software choice. Package retrieval is separate from any source collection.

Future public-code checks additionally pin MIT-licensed `astral-sh/setup-uv` v10.3.0 to commit
`1c37ad07a6a961277cf70c0d37d6f313000f5884`, install uv 0.12.7 and reuse the already selected Python setup action.
No action is vendored, no operational schedule or credential is added, and hosted execution remains unverified.

## Offline native PDF inspection addition — 2026-10-17

The opt-in, Linux-only native text worker adds [pypdf 6.21.0](https://pypi.org/project/pypdf/6.21.0/)
under BSD-3-Clause, exactly pinned in `pyproject.toml` and `uv.lock`. Existing feed package records remain
unchanged. No optional encryption/image extras are selected; Python3.12 needs no additional active
transitive package. No upstream parser, wheel, PDF source or font is vendored in this repository.

| Package material | Installed notice location | Bytes | SHA-256 |
| --- | --- | --- | --- |
| pypdf6.21.0 BSD-3-Clause license | `pypdf-6.21.0.dist-info/licenses/LICENSE` | 1,605 | `a97ac230e5f33ef10a5367a850eb01f91f1a0b064e34742c7794d2294557f524` |
| Bundled Adobe Glyph List data and its retained header | `pypdf/_codecs/adobe_glyphs.py` | 577,665 | `69ac4e46ea50409ee46cb0c76e35a280b67aa60f06f7fe5ea832a2349c72923e` |

Keep both the upstream package license and the Adobe copyright/permission/disclaimer header intact when
installing or redistributing that package. The Adobe table header has its own BSD-style terms; the package
license does not replace it. The existing declaration inventory and server notice-bundle command retain
their Node-only scope. Future binary, image or standalone Python distribution needs actual-artifact notice
review; this local addition does not qualify such a distribution.

Reuse is through the public `PdfReader` in-memory API and plain native page-text extraction. Project code
supplies fixed Linux worker ownership, input/output/resource limits, private receipt validation and hold
reasons. See the upstream [extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)
and Python [resource interface](https://docs.python.org/3.12/library/resource.html). Extracted text is not OCR,
visual or table qualification, original-file byte positions, factual support, reuse rights or publication
eligibility. Library retrieval grants no rights to later source documents.
