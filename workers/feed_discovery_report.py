"""JSON-safe private discovery metadata, retaining both source vintages.

The report is an unverified assertion from already supplied windows. It is not
an origin receipt, historical archive, document fetch, checkpoint or approval.
"""

from dataclasses import asdict
from datetime import datetime

from workers.feed_window_comparison import compare_feed_windows


def feed_discovery_report(*args, **kwargs) -> dict:
    """Run the actual bounded parser/comparer; never relabel caller-made rows."""
    comparison = compare_feed_windows(*args, **kwargs)

    def json_value(value):
        if isinstance(value, datetime):
            return value.isoformat(timespec="microseconds").replace("+00:00", "Z")
        if isinstance(value, dict):
            return {key: json_value(item) for key, item in value.items()}
        if isinstance(value, (tuple, list)):
            return [json_value(item) for item in value]
        return value

    return {"schema_version": 1, "kind": "private_feed_discovery_report",
            **json_value(asdict(comparison))}
