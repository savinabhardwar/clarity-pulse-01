"""Frozen outputs captured from the original backend before its removal.

The fixtures include their inputs for auditability. Tests select by canonical
input hash and fail if a new case has no independently captured expectation.
"""

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace


def reference_run(name, *, input, **unused):
    value = json.loads(input)
    key = hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).hexdigest()
    records = json.loads((Path(__file__).parent / "fixtures" / f"legacy_{name}.json").read_text(encoding="utf-8"))
    return SimpleNamespace(stdout=json.dumps(records[key]["output"]))
