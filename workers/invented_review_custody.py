"""Fixed private ownership handshake for a supervised invented review child.

No target, role, SQL, URL or raw root can be selected by the packet. The alive
custodian records the generated owned suffix before acknowledging any start.
This supplies no guardian-death/power-loss recovery or live review authority.
"""
from contextlib import contextmanager
from datetime import datetime
from fractions import Fraction
import fcntl
from hashlib import sha256
import json
from math import isfinite,nextafter
import os
from pathlib import Path
import re
import socket
import stat
import time

from scripts.check_private_attempt_readiness import private_directory, private_read
from scripts.fictional_trial_guard import DIRECTORY, cooperative_trial_interrupt
from workers.closed_pair_channel import _json
from workers.invented_operation_journal import _root, _write
from workers.linux_parent_lifetime import arm_parent_lifetime

ROLE_PREFIXES=('terra_successor_first_','terra_successor_successor_',
    'terra_correction_first_','terra_correction_successor_','terra_correction_review_')
OWNERSHIP='OWNED_REVIEW_START.json'


def owned_names(suffix):
    if type(suffix) is not str or re.fullmatch(r'[0-9]{14}_[0-9a-f]{6}',suffix) is None:
        raise ValueError('Invalid fixed invented review identity')
    datetime.strptime(suffix[:14],'%Y%m%d%H%M%S')
    return 'terra_successor_'+suffix,tuple(prefix+suffix for prefix in ROLE_PREFIXES)


def checked_start(value,pins):
    if type(value) is not dict or set(value)!={'schemaVersion','evidenceKind','suffix','candidateSha256'} \
            or type(value['schemaVersion']) is not int or value['schemaVersion']!=1 \
            or value['evidenceKind']!='invented_review_owned_start' \
            or type(value['candidateSha256']) is not dict or value['candidateSha256']!=pins:
        raise ValueError('Fixed invented ownership differs')
    if type(pins) is not dict or len(pins)!=3 \
            or any(type(key) is not str or type(pin) is not str or re.fullmatch('[0-9a-f]{64}',pin) is None for key,pin in pins.items()):
        raise ValueError('Fixed invented candidates differ')
    owned_names(value['suffix'])
    return value


def record_owned_start(directory,value,pins):
    checked_start(value,pins)
    identity=_root(directory)
    return _write(directory,identity,OWNERSHIP,value)


def send_packet(channel,value):
    if type(value) is not dict:raise ValueError('Fixed custody packet differs')
    raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode('utf-8')
    if len(raw)>4096:raise ValueError('Fixed custody packet is too large')
    channel.sendall(len(raw).to_bytes(4,'big')+raw)


def exact_packet(value,expected):
    if type(value) is not dict or set(value)!=set(expected) \
            or any(type(value[key]) is not type(wanted) or value[key]!=wanted for key,wanted in expected.items()):
        raise ValueError('Fixed custody packet differs')
    return value


def receive_packet(channel,*,timeout=10):
    if type(timeout) not in (int,float) or not 0<timeout<=30:raise ValueError('Invalid custody deadline')
    previous=channel.gettimeout();previous_tick=None
    def tick():
        nonlocal previous_tick
        try:
            value=time.monotonic()
            valid=type(value) in (int,float) and isfinite(value)
        except Exception:
            raise ValueError('Fixed custody monotonic clock refused') from None
        if not valid:raise ValueError('Fixed custody monotonic clock refused')
        current=Fraction(value)
        if previous_tick is not None and current<previous_tick:
            raise ValueError('Fixed custody monotonic clock moved backward')
        previous_tick=current
        return current
    def remaining():
        value=deadline-tick()
        if not 0<value<=Fraction(timeout):raise ValueError('Fixed custody packet deadline reached')
        bounded=float(value)
        if Fraction(bounded)>value:bounded=nextafter(bounded,0)
        if bounded<=0:raise ValueError('Fixed custody packet deadline reached')
        return bounded
    def exact(size):
        value=b''
        while len(value)<size:
            channel.settimeout(remaining())
            part=channel.recv(size-len(value))
            remaining()
            if not part:raise ValueError('Fixed custody channel closed')
            value+=part
        return value
    try:
        deadline=tick()+Fraction(timeout)
        size=int.from_bytes(exact(4),'big')
        if not 1<=size<=4096:raise ValueError('Fixed custody packet is too large')
        value=_json(exact(size))
        if type(value) is not dict:raise ValueError('Fixed custody packet differs')
        # A complete final recv (or parsing) can resume after the deadline.
        # The socket timeout alone does not establish elapsed acceptance time.
        remaining()
        return value
    finally:channel.settimeout(previous)


@contextmanager
def borrowed_trial_guard(descriptor,parent_pid,*,directory=DIRECTORY):
    """Validate an inherited shared flock; never unlock the parent's custody."""
    if type(descriptor) is not int or descriptor<3 or type(parent_pid) is not int \
            or parent_pid<=1 or os.getppid()!=parent_pid:raise ValueError('Fixed custody parent differs')
    directory=Path(directory);private_directory(directory)
    path=directory/'process.lock';reference=path.lstat();actual=os.fstat(descriptor)
    if not stat.S_ISREG(reference.st_mode) or not stat.S_ISREG(actual.st_mode) \
            or reference.st_nlink!=1 or actual.st_nlink!=1 or actual.st_size!=0 \
            or actual.st_uid!=os.geteuid() or stat.S_IMODE(actual.st_mode)!=0o600 \
            or (reference.st_dev,reference.st_ino)!=(actual.st_dev,actual.st_ino):
        raise ValueError('Fixed custody lock differs')
    # A separate open must be excluded; the inherited open file description
    # must share the existing lock. Closing this probe cannot release custody.
    probe=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
    try:
        try:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:pass
        else:raise ValueError('Fixed custody lock was not held')
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally:os.close(probe)
    with cooperative_trial_interrupt():yield


class ReviewWorkerCustody:
    def __init__(self,packet,pins):
        if type(packet) is not dict or set(packet)!={'schemaVersion','parentPid','guardFd','channelFd'} \
                or type(packet['schemaVersion']) is not int or packet['schemaVersion']!=1 \
                or any(type(packet[key]) is not int or packet[key]<3 for key in ('guardFd','channelFd')) \
                or packet['guardFd']==packet['channelFd']:
            raise ValueError('Fixed custody startup differs')
        arm_parent_lifetime(packet['parentPid'])
        self.parent_pid=packet['parentPid'];self.guard_fd=packet['guardFd'];self.pins=pins
        self.channel=socket.socket(fileno=packet['channelFd'])
        if self.channel.family!=socket.AF_UNIX or self.channel.type!=socket.SOCK_STREAM:
            raise ValueError('Fixed custody channel differs')
        self.channel.settimeout(10)
        self.started=False;self.staged=False

    def guard(self):return borrowed_trial_guard(self.guard_fd,self.parent_pid)

    def before_start(self,suffix):
        if self.started:raise ValueError('Fixed custody start already consumed')
        packet={'schemaVersion':1,'evidenceKind':'invented_review_owned_start','suffix':suffix,'candidateSha256':self.pins}
        checked_start(packet,self.pins);send_packet(self.channel,packet)
        expected={'schemaVersion':1,'status':'owned_start_recorded','packetSha256':sha256(json.dumps(packet,sort_keys=True,separators=(',',':')).encode()+b'\n').hexdigest()}
        exact_packet(receive_packet(self.channel),expected)
        self.started=True

    def first_reports(self):
        if not self.started or self.staged:raise ValueError('Fixed custody stage differs')
        send_packet(self.channel,{'schemaVersion':1,'status':'first_invented_reports_committed'})
        exact_packet(receive_packet(self.channel),{'schemaVersion':1,'status':'continue_invented_review'})
        self.staged=True

    def close(self):self.channel.close()
