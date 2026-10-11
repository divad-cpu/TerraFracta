"""Two fixed fictional fault probes; no source or database transport."""
from dataclasses import replace
import sys
from scripts.paired_channel_fixture_child import main
from scripts.paired_transport_fixture_child import FixtureTransportBroker


class InvalidFixtureTransport(FixtureTransportBroker):
    def __init__(self, kind):
        super().__init__()
        self.invalid_kind = kind

    def _capture(self, kind, *, deadline):
        result = super()._capture(kind, deadline=deadline)
        return replace(result, body=b'{}') if kind == self.invalid_kind else result


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[2] not in ('invalid_metadata', 'invalid_data'):
            raise ValueError('Unknown fixed fictional fault')
        fault = sys.argv.pop()[8:]
        raise SystemExit(main(fixed_fetcher=InvalidFixtureTransport(fault)))
    except Exception:
        print('Private fictional transport worker refused the operation', file=sys.stderr)
        raise SystemExit(1)
