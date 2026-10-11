"""Fixed native compatibility/access gate; no primary or live activation."""
from scripts.build_private_ssb_capture_api import build_private_ssb_capture_api,PRIVATE_SCHEMA
from scripts.captured_fictional_pipeline import ROOT
from scripts.check_raw_unknown_pair_native import run_fixed_native_gate


def main():
    return run_fixed_native_gate(build_private_ssb_capture_api,
        ROOT/'research/pending/TF009_private_ssb_capture_api_v2.sql',
        'fresh_private_pending_capture_native_compatibility','private-capture-native-',
        api_schema=PRIVATE_SCHEMA,expected_functions=20)


if __name__=='__main__':raise SystemExit(main())
