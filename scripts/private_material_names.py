"""Named private material excluded from developer evidence readers.

This namespace rule does not establish provenance of anonymously renamed,
copied or hardlinked bytes, or seal a hostile filesystem.
"""

PRIVATE_MATERIAL_NAMES = frozenset({
    ".local-connected-reader", ".local-fictional-runs", ".local-connected-trial",
    ".local-error-log", "ssb-14059-raw", "TerraFracta-private-trials",
    ".git", ".ssh", ".aws", ".codex",
})
