"""Validate exact offline package bytes before executing its runtime. Standard library only."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
manifest=json.loads((root/'PACKAGE_MANIFEST.json').read_text(encoding='utf-8'))
for name,expected in manifest['files'].items():
    p=(root/name).resolve()
    if root not in p.parents:raise RuntimeError('unsafe_manifest_path')
    if hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise RuntimeError('checksum_mismatch:'+name)
print('PASS: exact package bytes',manifest['commit'],len(manifest['files']))
