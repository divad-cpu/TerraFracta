"""Fixed invented feed -> committed queue -> retry -> reopened report.

Use an existing empty owner-only directory passed explicitly by the developer.
No raw input, URLs, credentials, environment files or network ports are accepted.
The selected production storage/database is never opened. No automatic retry of
this command exists: a nonempty directory must be inspected, never overwritten.
"""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys

from workers.error_diagnostics import diagnostic_worker
from workers.feed_discovery import FeedReceipt
from workers.invented_feed_journal import FeedJournalError, InventedFeedJournal
from workers.invented_feed_processing import inspect_feed_work, record_feed_outcome
from workers.invented_feed_journal_report import invented_feed_journal_report


HELP = 'Usage: python -B -m scripts.rehearse_invented_feed_journal --directory /absolute/empty/private/directory\nFixed invented data only; no source collection, primary database or publication.\n'


def _rss(items, extra=''):
    return ('<rss version="2.0"><channel><title>Invented feed</title><link>https://example.org/</link>'
            '<description>Invented only</description>'+extra+items+'</channel></rss>').encode()


def _entry(key, url='https://example.org/invented'):
    return f'<item><guid isPermaLink="false">{key}</guid><title>Invented notice</title><link>{url}</link></item>'


def _id(number):
    return f'30000000-0000-4000-8000-{number:012d}'


def run(directory: Path):
    """One explicit development invocation. Errors preserve the owned journal."""
    now = datetime(2026,10,15,tzinfo=timezone.utc)  # Fixed invented clock.
    root_url, next_url = 'https://example.org/feed.xml','https://example.org/feed.xml?page=2'
    first = _rss(_entry('one')+_entry('held','http://127.0.0.1/private')+_entry('two'),
        f'<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="{next_url}"/>')
    second = _rss(_entry('three'))
    def source(raw, number, url):
        return FeedReceipt('fictional-feed',_id(number),url,sha256(raw).hexdigest(),now+timedelta(seconds=number))
    with InventedFeedJournal(directory,create=True,source_key='fictional-feed',feed_url=root_url) as store:
        store.capture(first,source(first,1,root_url),expected_format='rss20',operation_id=_id(11),
            expected_revision=0,stored_at=now+timedelta(seconds=2),allowed_next_url=next_url)
        store.capture(second,source(second,3,next_url),expected_format='rss20',operation_id=_id(12),
            expected_revision=1,stored_at=now+timedelta(seconds=4))
        work = inspect_feed_work(store)
        record_feed_outcome(store,operation_id=_id(21),item_id=work[0].item_id,
            expected_revision=0,state='failed',recorded_at=now+timedelta(seconds=5))
        record_feed_outcome(store,operation_id=_id(22),item_id=work[0].item_id,
            expected_revision=1,state='processed',recorded_at=now+timedelta(seconds=6))
        record_feed_outcome(store,operation_id=_id(23),item_id=work[2].item_id,
            expected_revision=0,state='failed',recorded_at=now+timedelta(seconds=7))
        # Acknowledged old failure cannot reopen the now processed first item.
        record_feed_outcome(store,operation_id=_id(21),item_id=work[0].item_id,
            expected_revision=0,state='failed',recorded_at=now+timedelta(seconds=8))
    with InventedFeedJournal(directory) as reopened:
        return invented_feed_journal_report(reopened)


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args == ['--help']:
        sys.stdout.write(HELP)
        return 0
    if len(args) != 2 or args[0] != '--directory':
        sys.stderr.write(HELP)
        return 2
    try:
        with diagnostic_worker('collector_worker'):
            try:
                result = run(Path(args[1]))
            except FeedJournalError:
                sys.stderr.write('Invented feed rehearsal unavailable; preserve and inspect the selected directory.\n')
                return 2
            output = json.dumps(result,sort_keys=True,separators=(',',':'))+'\n'
            if sys.stdout.write(output) != len(output):
                raise OSError('output_incomplete')
            sys.stdout.flush()
            return 0
    except Exception:
        try:
            sys.stderr.write('Invented feed rehearsal failed; preserve the selected directory for inspection.\n')
        except Exception:
            pass
        return 1



if __name__ == '__main__':
    raise SystemExit(main())
