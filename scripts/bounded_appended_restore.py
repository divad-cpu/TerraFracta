"""Opt-in exact administrator archive recovery with a separate 1 MiB budget.

This does not alter the existing 294912-byte decoder or any process channel.
Gzip integrity is not authority: caller must independently bind its exact bytes.
"""
from dataclasses import dataclass,field
from hashlib import sha256
import re,zlib
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN

MAX_GZIP=131072
MAX_CUSTOM=1048576
CHUNK=32768


@dataclass(frozen=True)
class BoundAppendedArchive:
    gzip_bytes: bytes=field(repr=False)
    gzip_size: int
    gzip_sha256: str
    custom_size: int
    custom_sha256: str
    maximum_output_chunk: int


def admit_appended_archive(archive,*,expected_gzip_size,expected_gzip_sha256):
    """Full CRC/EOF before resources, one member, bounded output chunks only."""
    try:
        if(type(archive)is not bytes or type(expected_gzip_size)is not int or not 18<=expected_gzip_size<=MAX_GZIP or len(archive)!=expected_gzip_size or type(expected_gzip_sha256)is not str or re.fullmatch('[0-9a-f]{64}',expected_gzip_sha256)is None or sha256(archive).hexdigest()!=expected_gzip_sha256 or not archive.startswith(b'\x1f\x8b')):raise ValueError
        decoder=zlib.decompressobj(wbits=31);pending=archive;size=0;digest=sha256();prefix=b'';largest=0
        while True:
            chunk=decoder.decompress(pending,min(CHUNK,MAX_CUSTOM-size+1));pending=decoder.unconsumed_tail
            size+=len(chunk);largest=max(largest,len(chunk));digest.update(chunk)
            if len(prefix)<5:prefix=(prefix+chunk)[:5]
            if size>MAX_CUSTOM:raise ValueError
            if decoder.eof:
                if decoder.unused_data or pending:raise ValueError
                break
            if not pending and not chunk:raise ValueError
        if not 5<=size<=MAX_CUSTOM or prefix!=b'PGDMP':raise ValueError
        return BoundAppendedArchive(archive,len(archive),expected_gzip_sha256,size,digest.hexdigest(),largest)
    except(ValueError,TypeError,zlib.error,OverflowError):raise FeedPgTrialError('Bounded appended administrator archive unavailable')from None


def _recheck(archive):
    if(type(archive)is not BoundAppendedArchive or type(archive.gzip_bytes)is not bytes or any(type(v)is not int for v in(archive.gzip_size,archive.custom_size,archive.maximum_output_chunk))or any(type(v)is not str for v in(archive.gzip_sha256,archive.custom_sha256))):raise FeedPgTrialError('Bound appended archive required')
    checked=admit_appended_archive(archive.gzip_bytes,expected_gzip_size=archive.gzip_size,expected_gzip_sha256=archive.gzip_sha256)
    if checked!=archive:raise FeedPgTrialError('Bound appended archive metadata changed')
    return checked


class OwnedBoundedAppendedRestore:
    """Exact staged files in one new custodian, exact new OID-bound database."""
    def __init__(self,trial,target,archive):
        self.trial=trial;self.target=target;self.archive=_recheck(archive);self.staged=False
        self.stage='/tmp/tf_appended_restore_'+trial.suffix.lower().replace('-','_')
        if re.fullmatch('/tmp/tf_appended_restore_[a-z0-9_]{1,64}',self.stage)is None:raise FeedPgTrialError('Bound restore file intent invalid')
        self.gzip=self.stage+'/archive.gz';self.custom=self.stage+'/archive.custom'
        self._scope()
        trial.record('APPENDED_RESTORE_STAGE_INTENT',dict(directory=self.stage,gzip=self.gzip,custom=self.custom,gzipBytes=archive.gzip_size,gzipSHA256=archive.gzip_sha256,customBytes=archive.custom_size,customSHA256=archive.custom_sha256,decodedBudget=MAX_CUSTOM,chunkBudget=CHUNK,oldCommandInputMaximum=294912))

    def _scope(self):
        if(type(self.trial)is not FreshFeedPostgres or type(self.target)is not OwnedRestoreDatabase or self.target.trial is not self.trial or type(self.target.oid)is not int or self.target.oid<=0 or self.trial.identity is None):raise FeedPgTrialError('Bound appended restore target unavailable')
        expected='/tmp/tf_appended_restore_'+self.trial.suffix.lower().replace('-','_')
        if(self.stage!=expected or self.gzip!=expected+'/archive.gz'or self.custom!=expected+'/archive.custom'):raise FeedPgTrialError('Bound appended restore file intent changed')
        if self.target.current()is None:raise FeedPgTrialError('Bound appended restore target disappeared')

    def _verification(self):
        a=_recheck(self.archive)
        # Fixed generated paths contain only ASCII identifier characters. The
        # expected counts/hashes were fully derived before resource creation.
        return ('test "$(/bin/stat -c%s -- '+self.gzip+')" = '+str(a.gzip_size)+';s=$(/usr/bin/sha256sum -- '+self.gzip+');test "${s%% *}" = '+a.gzip_sha256+';'
            'test "$(/bin/stat -c%s -- '+self.custom+')" = '+str(a.custom_size)+';s=$(/usr/bin/sha256sum -- '+self.custom+');test "${s%% *}" = '+a.custom_sha256+';')

    def stage_archive(self):
        self._scope();_recheck(self.archive)
        if self.staged:raise FeedPgTrialError('Archive stage already owned')
        # Exclusive directory/files, private permissions and defensive file
        # ceiling. Exact full decoded byte/hash checks are the admission guard;
        # ulimit units are not used as the sole archive-size control.
        script='set -euo pipefail;umask 077;for p in /bin/gzip /bin/cat /bin/stat /usr/bin/sha256sum;do test -x "$p" || { printf "appended_restore_required_tool_unavailable:%s\\n" "$p" >&2;exit 2; };done;mkdir -m700 -- '+self.stage+';set -o noclobber;/bin/cat > '+self.gzip+';test "$(/bin/stat -c%s -- '+self.gzip+')" = '+str(self.archive.gzip_size)+';s=$(/usr/bin/sha256sum -- '+self.gzip+');test "${s%% *}" = '+self.archive.gzip_sha256+';ulimit -f 1024;/bin/gzip -dc -- '+self.gzip+' > '+self.custom+';'+self._verification()
        try:
            result=self.trial.run(['docker','exec','-i',self.trial.identity,'/bin/bash','-c',script],payload=self.archive.gzip_bytes,timeout=25)
            if result.stdout or result.stderr:raise FeedPgTrialError('Complete appended archive staging unavailable')
            self.staged=True
            self.trial.record('APPENDED_RESTORE_COMPLETE_STAGED_ARCHIVE',dict(gzipBytes=self.archive.gzip_size,gzipSHA256=self.archive.gzip_sha256,customBytes=self.archive.custom_size,customSHA256=self.archive.custom_sha256,completeBeforeRestore=True))
        finally:self._scope()

    def restore(self,*,allowed=False):
        self._scope();_recheck(self.archive)
        if not self.staged:raise FeedPgTrialError('Complete appended archive was not staged')
        # There is no producer pipeline. The *complete*, exact staged archive
        # is checked again before starting pg_restore in the same fixed shell.
        script='set -euo pipefail;'+self._verification()+'exec '+BIN+'pg_restore -h /tmp -U postgres --dbname='+self.target.name+' --single-transaction --exit-on-error '+self.custom
        try:return self.trial.run(['docker','exec',self.trial.identity,'/bin/bash','-c',script],timeout=30,allowed=allowed)
        finally:self._scope()
