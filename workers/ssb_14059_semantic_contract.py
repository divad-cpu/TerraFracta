"""Deterministic selected-definition witness, never public qualification.

Formatting, source-update time and unrelated years are outside this selected
meaning fingerprint. Their raw evidence remains distinct and existing metadata
change/hold rules still apply. Changed selected meanings are refused by the
existing parser. The owner's three unresolved public-meaning holds are included.
"""
from hashlib import sha256
import json
from workers.ssb_14059_capture import METADATA_URL, _read_captured_json, parse_captured_ssb_14059_metadata

HELD_MEANINGS = ('respondent_count_unit', 'fieldwork_period', 'upper_band_boundary')
FIELDS = ('Boutg4', 'Boutg5', 'AntHushSvar')


def canonical_selected_definition(capture):
    parse_captured_ssb_14059_metadata(capture)
    value = _read_captured_json(capture, METADATA_URL)
    dimension = value['dimension']['ContentsCode']; category = dimension['category']
    extension = dimension['extension']
    selected = {code: {'label': category['label'][code], 'unit': category['unit'][code],
        **{name: extension[name][code] for name in ('refperiod', 'measuringType',
            'priceType', 'adjustment', 'alternativeText')}} for code in FIELDS}
    witness = {'schemaVersion': 1, 'purpose': 'private_selected_definition_witness',
        'publisher': value['source'], 'table': value['extension']['px']['tableid'],
        'language': value['extension']['px']['language'], 'tenure': {'0': value['dimension']['EierStatus']['category']['label']['0']},
        'years': {year: value['dimension']['Tid']['category']['label'][year] for year in ('2024', '2025')},
        'periodPrecision': 'year', 'fields': selected, 'comparabilityNotes': value['note'],
        'heldPublicMeanings': list(HELD_MEANINGS), 'publicQualificationIssued': False}
    return json.dumps(witness, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def selected_definition_sha256(capture):
    return sha256(canonical_selected_definition(capture)).hexdigest()
