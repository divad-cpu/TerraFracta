"""Omit all Docker environment values before persisting valid JSON metadata.

The command result remains private in memory; logs keep field names and
non-sensitive structure. This does not redact physical PostgreSQL archives.
"""
import json
import re


def closed_native_refusal_record(operation, response):
    """Omit SQL/native output entirely: errors may echo raw body literals.

    No stderr/stdout field is inspected, copied, hashed or decoded. Historical
    fictional diagnostics remain untouched; new closed-worker failures retain
    only operation and exit status. This does not sanitize database archives.
    """
    from workers.closed_pair_channel import FIELDS
    if type(operation) is not str or operation not in FIELDS:
        raise ValueError('Invalid closed operation')
    code = response.returncode
    if type(code) is not int or code == 0 or not -256 <= code <= 255:
        raise ValueError('Invalid closed operation failure status')
    return json.dumps({'state': 'refused', 'operation': operation, 'exitCode': code,
                       'nativeOutputRetained': False}, separators=(',', ':')) + '\n'


def sanitize_docker_metadata(text:str)->str:
    """Omit every Env-list value without guessing which names hold secrets.

    Preserve only portable assignment names; malformed/non-string rows become
    a fixed marker. This does not sanitize malformed JSON, other metadata
    fields, trailing command text or separately captured stderr.
    """
    duplicate_keys=False
    def unique_values(pairs):
        nonlocal duplicate_keys
        value={}
        for key,item in pairs:
            if key in value:duplicate_keys=True
            value[key]=item
        return value
    try:
        leading=len(text)-len(text.lstrip())
        value,end=json.JSONDecoder(object_pairs_hook=unique_values).raw_decode(text.lstrip())
    except (ValueError,TypeError):return text
    changed=False
    def sanitize(obj):
        nonlocal changed
        if isinstance(obj,dict):
            for name,item in obj.items():
                if name=='Env' and isinstance(item,list):
                    for i,row in enumerate(item):
                        omitted='<omitted>'
                        if isinstance(row,str):
                            key,separator,_=row.partition('=')
                            if separator and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',key):
                                omitted=key+'=<omitted>'
                        if row!=omitted:
                            item[i]=omitted;changed=True
                sanitize(item)
        elif isinstance(obj,list):
            for item in obj:sanitize(item)
    sanitize(value)
    # Shadowed duplicate fields may contain Env values even when the surviving
    # object needed no replacement. Never return those original hidden bytes.
    return (json.dumps(value,indent=2)+text[leading+end:]) if changed or duplicate_keys else text
