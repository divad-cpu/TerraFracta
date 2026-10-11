"""Closed invented canonical-manifest cases for the independent SQL validator."""

from dataclasses import replace
import json

from scripts.fictional_run_completion import fictional_completion_manifest
from workers.update_run_completion import PlannedItem, PlannedSource, canonical_run_manifest


def manifest_cases() -> list[tuple[str, str, bool]]:
    plan = fictional_completion_manifest()
    canonical = canonical_run_manifest(plan)
    cases = [("one-source-one-item", canonical, True),
             ("checked-empty-capture", canonical_run_manifest(replace(plan, items=())), True),
             ("missing-capture", canonical_run_manifest(replace(plan, sources=(replace(
                 plan.sources[0], source_version_id=None, content_sha256=None),), items=())), True)]
    second = PlannedSource("other-source", "66666666-6666-4666-8666-666666666666", None)
    cases.append(("two-sources", canonical_run_manifest(replace(plan, sources=(second, *plan.sources))), True))

    def changed(name, path, value):
        data = json.loads(canonical)
        parent = data
        for key in path[:-1]:
            parent = parent[key]
        parent[path[-1]] = value
        cases.append((name, json.dumps(data, sort_keys=True, separators=(",", ":")), False))

    for field, value in (("schemaVersion", True), ("schemaVersion", 1.0), ("mode", "publish"),
                         ("mode", False), ("runId", "11111111-1111-6111-8111-111111111111"),
                         ("requestFingerprint", "z" * 64), ("sources", []), ("sources", {}),
                         ("items", {})):
        changed("invalid-" + field + "-" + str(value)[:12], (field,), value)
    for field, value in (("sourceKey", "unknown/route"), ("registrationId", None),
                         ("sourceVersionId", None), ("contentSha256", None),
                         ("contentSha256", "a" * 63)):
        changed("invalid-source-" + field, ("sources", 0, field), value)
    for field, value in (("itemKey", ""), ("itemKey", "x" * 121), ("sourceKey", "other-source"),
                         ("sourceVersionId", "66666666-6666-4666-8666-666666666666")):
        changed("invalid-item-" + field, ("items", 0, field), value)
    data = json.loads(canonical)
    for level in ((), ("sources", 0), ("items", 0)):
        copy = json.loads(canonical); parent = copy
        for key in level:
            parent = parent[key]
        parent["privateField"] = "fictional-placeholder"
        cases.append(("extra-field-" + str(level), json.dumps(copy, sort_keys=True, separators=(",", ":")), False))
    for name in ("sources", "items"):
        copy = json.loads(canonical); copy[name] *= 2
        cases.append(("duplicate-" + name, json.dumps(copy, sort_keys=True, separators=(",", ":")), False))
    copy = json.loads(canonical); copy["sources"].append({**copy["sources"][0], "sourceKey": "other-source"})
    cases.append(("same-registration-different-key", json.dumps(copy, sort_keys=True, separators=(",", ":")), False))
    maximum = replace(plan, items=tuple(PlannedItem(f"item-{index:02}", plan.sources[0].source_key,
        plan.sources[0].source_version_id) for index in range(50)))
    cases.append(("fifty-items", canonical_run_manifest(maximum), True))
    copy = json.loads(canonical_run_manifest(maximum)); copy["items"].append({**copy["items"][0], "itemKey": "item-50"})
    cases.append(("fifty-one-items", json.dumps(copy, sort_keys=True, separators=(",", ":")), False))
    cases += [("duplicate-json-key", '{"mode":"shadow",' + canonical[1:], False),
              ("alternate-whitespace", json.dumps(data, sort_keys=True), False),
              ("array-root", "[]", False), ("invalid-json", "{", False),
              ("byte-limit", " " * 40961, False)]
    two = json.loads(cases[3][1]); two["sources"].reverse()
    cases.append(("unsorted-source-array", json.dumps(two, sort_keys=True, separators=(",", ":")), False))
    return cases
