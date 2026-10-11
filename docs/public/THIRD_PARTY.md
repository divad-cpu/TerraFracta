# Third-party and distribution scope

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
vendored or relicensed here. No new application dependency or lockfile version is introduced.
