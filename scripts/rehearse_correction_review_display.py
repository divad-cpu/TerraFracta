"""A fixed manual invented review; exposes only validated dated counts.

Reuse the existing ordinary-principal trial and full private-history validator.
Neither a saved fixture nor an earlier operation is a fresh execution witness.
This function is not connected to an HTTP start endpoint. Cooperative TERM
cleanup does not establish SIGKILL or parent-loss containment.
"""
from contextlib import redirect_stdout
from hashlib import sha256
from io import StringIO

from scripts.captured_fictional_pipeline import ROOT
from scripts.export_invented_correction_review_snapshot import CANDIDATES, build_snapshot
from workers.closed_pair_channel import _json
from workers.invented_operation_journal import CORRECTION_REVIEW_EXPECTED, CORRECTION_REVIEW_KIND, checked_execution


def current_candidate_pins():
    return {name:sha256((ROOT/'research/pending'/name).read_bytes()).hexdigest() for name in CANDIDATES}


def build_execution_result(receipt, candidate_pins):
    snapshot=build_snapshot(receipt,candidate_pins,require_current_denials=True)
    # The reused validator checks distinct report identities, publication
    # membership, exact event histories/times, denials and native cleanup.
    result={**CORRECTION_REVIEW_EXPECTED,'recordedAt':snapshot['recordedAt']}
    return checked_execution(result,expected_kind=CORRECTION_REVIEW_KIND)


def run_fixed_review_result():
    # Deferred import keeps a read-only inspector free of native launch code.
    from scripts.check_invented_correction_review import main
    pins=current_candidate_pins()
    output=StringIO()
    with redirect_stdout(output):code=main()
    raw=output.getvalue().encode('utf-8')
    if type(code) is not int or code!=0 or len(raw)>65536:
        raise ValueError('Fixed invented review completion is unavailable')
    return build_execution_result(_json(raw),pins)
