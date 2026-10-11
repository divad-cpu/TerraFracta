"""Emit only the fixed distinct-public-target input for the draft reader test."""
import json
from scripts.fictional_activation_payload import fictional_activation_payload

if __name__ == "__main__":
    print(json.dumps(fictional_activation_payload(distinct_public_target=True), sort_keys=True))
