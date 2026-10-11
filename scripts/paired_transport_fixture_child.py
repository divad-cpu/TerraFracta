"""Closed credential-free worker with two actual bounded fictional children."""
import sys
from scripts.paired_channel_fixture_child import main
from workers.fixed_ssb_transport_broker import FixedSSBTransportBroker
from workers.ssb_14059_pair_transport import _run_child


class FixtureTransportBroker(FixedSSBTransportBroker):
    def __init__(self):
        super().__init__()
        self.fixture_reads = []

    def _capture(self, kind, *, deadline):
        capture = _run_child(kind, deadline=deadline, fixture=True)
        self.fixture_reads.append(kind)
        return capture


if __name__ == '__main__':
    try:
        raise SystemExit(main(fixed_fetcher=FixtureTransportBroker()))
    except Exception:
        print('Private fictional transport worker refused the operation', file=sys.stderr)
        raise SystemExit(1)
