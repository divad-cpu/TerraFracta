"""New invented one-decimal cells; no source or database contact."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import re
from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL
from workers.ssb_14059_recovery import ExpectedRawPair
from workers.ssb_14059_private_assessment import build_first_private_ssb_assessment
from workers.ssb_14059_private_proposal import SourceVersionWitness, PairVersionWitness, HeldSSBDecisionWitness, IssueHeadWitness

ROOT = Path(__file__).resolve().parents[2]
def ident(n):
    return f'88220000-0000-4000-8000-{n:012d}'

def fixture(year=2024):
    meta_at = datetime(2026, 10, 6, 10, 0, 0, 1, tzinfo=timezone.utc)
    data_at = meta_at + timedelta(microseconds=1)
    stored = data_at + timedelta(seconds=1)
    decided = stored + timedelta(seconds=1)
    observed = decided + timedelta(seconds=1)
    now = observed + timedelta(days=1)
    meta_body = (ROOT/'fixtures/ssb_14059_metadata_minimal_2024_2025.json').read_bytes()
    data_body = re.sub(r'"value":\s*\[[^\]]*\]', '"value": [30.1,29.3,12.8,11.6,733,744]',
        (ROOT/'fixtures/ssb_14059_jsonstat_minimal_2024_2025.json').read_text()).encode()
    metadata = CapturedResponse(METADATA_URL, METADATA_URL, 0, 200, 'application/json', meta_body, meta_at)
    data = CapturedResponse(DATA_URL, DATA_URL, 0, 200, 'application/json', data_body, data_at)
    binding = ExpectedRawPair('d'*32, sha256(meta_body).hexdigest(), sha256(data_body).hexdigest(),
        meta_at+timedelta(days=30), meta_at, data_at, stored)
    versions = {'metadata': ident(4), 'data': ident(5)}
    assessment = build_first_private_ssb_assessment(metadata, data, binding, pair_id=ident(3), versions=versions, now=now)
    held = next(c for c in assessment['candidates'] if c['surveyYear'] == year)
    sources = (SourceVersionWitness(ident(1), ident(3), 'ssb-14059-metadata', ident(4), METADATA_URL, binding.metadata_sha256, meta_at),
        SourceVersionWitness(ident(1), ident(3), 'ssb-14059-data', ident(5), DATA_URL, binding.data_sha256, data_at))
    decision = HeldSSBDecisionWitness(ident(1), ident(3), ident(year), 'norway', held['itemKey'], 'held',
        ident(5), binding.data_sha256, assessment['semanticContractSha256'], ';'.join(held['evidenceLocators'].values()),
        tuple(held['reasonCodes']), decided)
    target = IssueHeadWitness(ident(7), 'norway', 'norway', 'housing-cost-burden', meta_at-timedelta(days=1), observed, None, None, None)
    return dict(metadata_response=metadata, data_response=data, raw_binding=binding, run_id=ident(1), pair_id=ident(3),
        pair=PairVersionWitness(ident(1), ident(3), ident(4), ident(5)),
        sources=sources, decision=decision, target=target, claim_id=ident(year+100), now=now)
