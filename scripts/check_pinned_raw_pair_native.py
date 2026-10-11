"""Fixed isolated compatibility gate for exact-source native scopes.

No argument, SQL, target or builder is selected by the caller. Uses a fresh
fictional database on the same exact owned clone as the earlier raw gate.
"""
from scripts.build_pinned_raw_ssb_pair_api import build_pinned_raw_ssb_pair_api
from scripts.captured_fictional_pipeline import ROOT
from scripts.check_raw_unknown_pair_native import run_fixed_native_gate


def main():
    return run_fixed_native_gate(build_pinned_raw_ssb_pair_api,
        ROOT/'research/pending/TF009_pinned_raw_ssb_pair_api_v1.sql',
        'fresh_pinned_raw_candidate_native_compatibility', 'pinned-raw-pair-native-')


if __name__ == '__main__': raise SystemExit(main())
