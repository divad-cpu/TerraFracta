"""Remove credential environment values before persisting Docker metadata.

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
    try:
        leading=len(text)-len(text.lstrip())
        value,end=json.JSONDecoder().raw_decode(text.lstrip())
    except (ValueError,TypeError):return text
    changed=False
    def sanitize(obj):
        nonlocal changed
        if isinstance(obj,dict):
            for name,item in obj.items():
                if name=='Env' and isinstance(item,list):
                    for i,row in enumerate(item):
                        if isinstance(row,str) and '=' in row:
                            key,_,val=row.partition('=')
                            if re.search(r'(PASSWORD|SECRET|TOKEN|KEY)$',key) and val!='<omitted>':
                                item[i]=key+'=<omitted>';changed=True
                sanitize(item)
        elif isinstance(obj,list):
            for item in obj:sanitize(item)
    sanitize(value)
    return (json.dumps(value,indent=2)+text[leading+end:]) if changed else text
