"""Two-phase snapshots before callback-capable UTC validation in offline plans.

Exact known dataclasses and immutable values only; no deepcopy/pickle/hooks.
This preserves caller assertions against synchronous timezone reentrancy, not
hostile same-process code, concurrent writes or source/actor authentication.
"""
from dataclasses import dataclass, fields
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from workers.update_request_identity import MAX_ITEMS
from workers.prose_passage_selection import MAX_PASSAGES

class DispatchSnapshotError(ValueError): pass

@dataclass(frozen=True)
class _Record:
    kind: type
    values: tuple

@dataclass(frozen=True)
class _Tuple:
    values: tuple

@dataclass(frozen=True)
class _Utc:
    components: tuple
    zone: object


def _namespace(value, kind):
    namespace = vars(value)
    if type(namespace) is not dict: raise DispatchSnapshotError('dispatch_input_unavailable')
    keys = tuple(namespace)
    names = tuple(f.name for f in fields(kind))
    if any(type(key) is not str for key in keys) or set(keys) != set(names):
        raise DispatchSnapshotError('dispatch_input_unavailable')
    return namespace, names


def scalar_record(value, kind):
    if type(value) is not kind: raise DispatchSnapshotError('dispatch_input_unavailable')
    namespace, names = _namespace(value, kind)
    values = {name: namespace[name] for name in names}
    if any(not any(type(v) is kind for kind in (type(None), str, bool, int, float, Decimal)) for v in values.values()):
        raise DispatchSnapshotError('dispatch_input_unavailable')
    return kind(**values)


def scalar_records(values, kind):
    if type(values) is not tuple or len(values) > MAX_ITEMS:
        raise DispatchSnapshotError('dispatch_input_unavailable')
    return tuple(scalar_record(value, kind) for value in values)


def freeze_input(value, record_kinds=()):
    """Capture every primitive before calling any supplied timezone method.

    The coordinator freezes every row before thawing any of them. Unsupported
    or cyclic row data can be refused independently without running a hook.
    """
    active = set(); count = 0
    def copy(item, depth):
        nonlocal count
        count += 1
        if count > 131072 or depth > 12: raise DispatchSnapshotError('dispatch_input_unavailable')
        kind = type(item)
        if any(kind is allowed for allowed in (type(None), str, bool, int, float, Decimal, bytes)): return item
        if kind is datetime:
            if item.tzinfo is None: raise DispatchSnapshotError('dispatch_input_unavailable')
            return _Utc((item.year, item.month, item.day, item.hour, item.minute, item.second, item.microsecond, item.fold), item.tzinfo)
        identity = id(item)
        if identity in active: raise DispatchSnapshotError('dispatch_input_unavailable')
        active.add(identity)
        try:
            if kind is tuple:
                if len(item) > MAX_PASSAGES: raise DispatchSnapshotError('dispatch_input_unavailable')
                return _Tuple(tuple(copy(part, depth + 1) for part in item))
            if any(kind is allowed for allowed in record_kinds):
                # Never execute namespace iteration/key hooks, or discard an
                # original unknown field before a downstream closed contract.
                namespace, names = _namespace(item, kind)
                return _Record(kind, tuple(copy(namespace[name], depth + 1) for name in names))
            raise DispatchSnapshotError('dispatch_input_unavailable')
        finally: active.remove(identity)
    return copy(value, 0)


def thaw_input(value):
    """Normalize captured UTC instants only after the entire batch is frozen."""
    if type(value) is _Utc:
        year, month, day, hour, minute, second, microsecond, fold = value.components
        original = datetime(year, month, day, hour, minute, second, microsecond, tzinfo=value.zone, fold=fold)
        if original.utcoffset() != timedelta(0): raise DispatchSnapshotError('dispatch_input_unavailable')
        return datetime(year, month, day, hour, minute, second, microsecond, tzinfo=timezone.utc, fold=fold)
    if type(value) is _Tuple: return tuple(thaw_input(part) for part in value.values)
    if type(value) is _Record: return value.kind(*(thaw_input(part) for part in value.values))
    return value
