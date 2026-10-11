"""Reuse the established synthetic cleanup boundary against the native Node composition runner."""
from pathlib import Path
import importlib.util
import unittest

TESTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("retained_cleanup_controls", TESTS / "test_contact_free_native_cleanup.py")
controls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)
controls.SOURCE = Path(__file__).resolve().parents[1] / "scripts/check_contact_free_body_ownership_native.py"
NativeClosureBoundary = controls.NativeClosureBoundary
if __name__ == "__main__":
    unittest.main()
