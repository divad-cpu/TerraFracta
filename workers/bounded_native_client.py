"""Owned process transport for fixed parent-generated private native statements.

The trusted caller selects an already authorized exact command and, if needed,
one credential line passed only through stdin. The collector inherits neither.
The child has an empty environment, bounded streams and no automatic retries.
Cancellation retains the owned handle until local exit and stream cleanup are
confirmed; a remote COMMIT may still require native readback/recovery. No
account or database target is provisioned.
"""
from dataclasses import dataclass
import subprocess
import threading

from workers.bounded_worker_process import communicate_bounded
from workers.private_pair_native_sql import HEAD, PRIVATE_SCHEMA
from workers.closed_pair_channel import FIELDS
from workers.native_parent_guard import native_parent_command

MAX_SQL_BYTES=278528


@dataclass(frozen=True)
class NativeClientReply:
    returncode: int
    stdout: str
    # Native diagnostics are deliberately not returned. They can echo source
    # body literals or credentials in a SQL failure.
    stderr: str=''


class BoundedNativeClient:
    """Sequential parent transport with an owned cancellation handle.

    The fixed command is trusted configuration, never a worker argument. This
    boundary does not prove the command's target rights or source authorization.
    The SQL builders and native fixed API provide those separate restrictions.
    """
    def __init__(self, command, *, stdin_prefix=b'', timeout=15, parent_lifetime=False):
        if type(command) is not tuple or not 1<=len(command)<=24 \
                or any(type(arg) is not str or not 1<=len(arg)<=4096 or '\0' in arg for arg in command) \
                or not command[0].startswith('/') \
                or type(stdin_prefix) is not bytes or len(stdin_prefix)>192 \
                or (stdin_prefix and (not stdin_prefix.endswith(b'\n') or b'\n' in stdin_prefix[:-1]
                    or any(byte<32 or byte>126 for byte in stdin_prefix[:-1]))) \
                or type(timeout) not in (int,float) or not 0<timeout<=15 \
                or type(parent_lifetime) is not bool:
            raise ValueError('Invalid bounded native client configuration')
        self._command=command;self._prefix=stdin_prefix;self._timeout=timeout
        self._parent_lifetime=parent_lifetime
        self._lock=threading.Lock();self._active=None;self._closed=False;self._calls=0;self._inflight=False

    @property
    def closed(self):
        with self._lock:return self._closed

    @property
    def active(self):
        """An owned handle remains; this is not proof the OS child is alive."""
        with self._lock:return self._active is not None

    @property
    def calls(self):
        with self._lock:return self._calls

    @property
    def cleanup_confirmed(self):
        with self._lock:return self._closed and not self._inflight and self._active is None

    @property
    def parent_lifetime_requested(self):
        """Requested launch mode, not an attestation that a command preserves it."""
        return self._parent_lifetime

    def _launch_command(self):
        return native_parent_command(self._command) if self._parent_lifetime else self._command

    @staticmethod
    def _terminal(process):
        try:return type(process.poll()) is int
        except Exception:return False

    def _finish_owned_process(self,process):
        if process is None:return True
        terminal=self._terminal(process);streams_closed=True
        for name in ('stdin','stdout','stderr'):
            try:
                stream=getattr(process,name,None)
                if stream is not None and not stream.closed:stream.close()
                if stream is not None and not stream.closed:streams_closed=False
            except Exception:streams_closed=False
        with self._lock:
            if self._active is process:
                self._inflight=False
                if terminal and streams_closed:self._active=None
        return terminal and streams_closed

    def confirm_cleanup(self):
        """Observe the retained owned handle after I/O ends; never retry SQL.

        Acknowledged local exit does not establish a remote COMMIT/rollback.
        Unknown exit or stream cleanup stays held; no PID lookup or takeover.
        """
        with self._lock:
            if not self._closed or self._inflight:return False
            process=self._active
        return self._finish_owned_process(process)

    def cancel(self):
        """Prevent new operations and kill only the process owned by this client.

        Its serving thread must finish/reap before raw custody can be released.
        This is cancellation, never evidence that a remote write rolled back.
        """
        with self._lock:
            self._closed=True;self._prefix=b''
            if self._active is not None and not self._terminal(self._active):
                try:self._active.kill()
                except Exception:pass
            # An acknowledgement of kill is not exit. The serving operation or
            # explicit read-only confirmation retains and checks this handle.

    def __call__(self, sql):
        process=None
        try:
            if type(sql) is not str:raise ValueError
            raw=sql.encode('utf-8')
            names=tuple(FIELDS)+('read_admitted_context','read_retention_context','read_raw_pair_binding')
            if not 2<=len(raw)<=MAX_SQL_BYTES or '\0' in sql \
                    or not any(sql.startswith(HEAD+PRIVATE_SCHEMA+'.'+name+'(') for name in names) \
                    or not sql.endswith(');'):
                raise ValueError
            with self._lock:
                if self._closed or self._active is not None:raise ValueError
                payload=self._prefix+raw
                process=subprocess.Popen(self._launch_command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,env={},close_fds=True)
                self._active=process;self._calls+=1;self._inflight=True
            output=communicate_bounded(process,payload,timeout=self._timeout,max_input=294912,
                max_stdout=32768,max_stderr=1024)
            if output.returncode or output.stderr or not 2<=len(output.stdout)<=32768:
                raise ValueError
            text=output.stdout.decode('utf-8')
            with self._lock:
                if self._closed:raise ValueError
            if not self._finish_owned_process(process):raise ValueError
            return NativeClientReply(0,text)
        except BaseException as error:
            self.cancel()
            if isinstance(error,Exception):raise ValueError('Bounded native operation unavailable; outcome requires recovery') from None
            raise
        finally:
            # A helper failure can leave exit unconfirmed. Keep the exact owned
            # handle and closed/no-retry state; do not report it inactive.
            self._finish_owned_process(process)

    def store_pair_transaction(self, prepare_store):
        """Opt-in parent-held fixed retention/store transaction; never retry.

        Existing single-statement calls remain available. The trusted backend
        owns the filesystem callback and exact store data, not the collector.
        """
        from workers.retained_native_transaction import retained_pair_store
        process = None
        try:
            if not callable(prepare_store): raise ValueError
            with self._lock:
                if self._closed or self._active is not None: raise ValueError
                prefix = self._prefix
                process = subprocess.Popen(self._launch_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, env={}, close_fds=True)
                self._active = process; self._calls += 1; self._inflight = True
            text = retained_pair_store(process, prefix, prepare_store, timeout=min(self._timeout, 8))
            with self._lock:
                if self._closed: raise ValueError
            if not self._finish_owned_process(process): raise ValueError
            return NativeClientReply(0, text)
        except BaseException as error:
            self.cancel()
            if isinstance(error, Exception):
                raise ValueError('Bounded retained store unavailable; outcome requires recovery') from None
            raise
        finally:
            self._finish_owned_process(process)
