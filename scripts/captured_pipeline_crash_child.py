"""Deliberately exit only this isolated fictional update child at a saved stage."""
import argparse
from scripts.captured_pipeline_recovery_fixture import RecoveryFixtureBackend, RECOVERY_DATABASES
from workers.captured_update_pipeline import execute_captured_update


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',required=True,choices=tuple(RECOVERY_DATABASES))
    args=p.parse_args()
    backend=RecoveryFixtureBackend(args.mode,crashing=True)
    plan=backend.seed_and_claim()
    execute_captured_update((plan,),backend)
    raise AssertionError('Deliberate crash did not occur')

if __name__=='__main__':main()
