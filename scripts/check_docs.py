"""Check authored Markdown links without opening named private material."""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

if __package__:
    from .private_material_names import PRIVATE_MATERIAL_NAMES
else:
    # Preserve the existing direct-script invocation without PYTHONPATH setup.
    from private_material_names import PRIVATE_MATERIAL_NAMES


ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".next", ".venv", "node_modules"} | PRIVATE_MATERIAL_NAMES
LINK = re.compile(r"!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+\"[^\"]*\")?\)")


def permitted_document(path: Path) -> bool:
    """Regular, unlinked authored source only; no private-body inspection."""
    try:
        relative = path.relative_to(ROOT)
    except ValueError:
        return False
    if any(part in SKIP_DIRS or part.startswith(".env")
           for part in relative.parts):
        return False
    if any(item.is_symlink() for item in (path, *path.parents)
           if item.is_relative_to(ROOT)):
        return False
    return path.is_file() and path.resolve().is_relative_to(ROOT.resolve())


def markdown_files() -> list[Path]:
    found: list[Path] = []
    for directory, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS
                   and not name.startswith(".env")
                   and not (Path(directory) / name).is_symlink()]
        found.extend(path for name in files if name.endswith(".md")
                     and permitted_document(path := Path(directory) / name))
    return sorted(found)


def main() -> int:
    checked = 0
    missing: list[str] = []
    for document in markdown_files():
        if not permitted_document(document):
            continue
        fence: str | None = None
        for line_number, line in enumerate(document.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.lstrip()
            if stripped.startswith(("```", "~~~")):
                marker = stripped[:3]
                fence = None if fence == marker else marker if fence is None else fence
                continue
            if fence:
                continue
            for match in LINK.finditer(line):
                raw = match.group(1).strip("<>")
                parsed = urlsplit(raw)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                checked += 1
                target = (document.parent / unquote(parsed.path)).resolve()
                if not target.is_relative_to(ROOT) or not target.exists():
                    missing.append(f"{document.relative_to(ROOT)}:{line_number}: {raw}")
    if missing:
        print("Missing local documentation links:", file=sys.stderr)
        print("\n".join(missing), file=sys.stderr)
        return 1
    print(f"Checked {checked} local Markdown file links; none missing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
