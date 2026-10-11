"""Create a runnable exact-commit offline package, including source bytes needed by integrity gates."""
import hashlib,json,re,subprocess,zipfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
if subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=repo,text=True).strip():
    raise RuntimeError('commit tracked inputs before packaging')
kb=repo/'knowledge/indonesia_tax_kb'
paths=[]
for folder in ['server/lib','tests','tools/indonesia_tax_kb']:
    for p in (repo/folder).iterdir():
        if p.is_file() and (folder=='tools/indonesia_tax_kb' and p.suffix in ['.py','.cjs'] or p.name.startswith('indonesiaTaxKnowledge') or p.name=='indonesia_tax_ingestion_test.py'):paths.append(p)
for p in kb.rglob('*'):
    if p.is_file() and '__pycache__' not in p.parts and p.suffix in ['.json','.md','.csv','.log','.txt','.pdf']:
        paths.append(p)
payload={str(p.relative_to(repo)).replace('\\','/'):p.read_bytes() for p in paths}
patterns=[rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',rb'gh[pousr]_[A-Za-z0-9]{30,}',rb'github_pat_[A-Za-z0-9_]{30,}',rb'\bsk-[A-Za-z0-9_-]{20,}']
for name,data in payload.items():
    if not name.endswith('.pdf') and any(re.search(rx,data) for rx in patterns):raise RuntimeError('potential_secret:'+name)
payload['requirements.txt']=b'pdfplumber==0.11.9\npypdf==6.10.0\n'
payload['REPRODUCE.md']=f'''# Reproduce draft PR133 — {commit}

Includes the actual runtime, vocabulary/card dependency, all Node/Python tests, exact index/claim/extraction data and original PDF bytes. No network is needed for Node checks. Installation of Python dependencies requires access to PyPI or an equivalent local wheel cache; dependencies are not bundled. Tested with Node24.16.0 and Python3.12.14; Python3.12+ and Node24 are recommended. npm install is unnecessary (Node standard library only).

Extract into a new empty directory and run from its root. Commands are cross-platform except activation, which is deliberately unnecessary:

```
python -m venv .venv
# Windows:
.venv\\Scripts\\python.exe -m pip install -r requirements.txt
.venv\\Scripts\\python.exe tools/indonesia_tax_kb/verify_package.py
node --test tests/indonesiaTaxKnowledge.test.cjs tests/indonesiaTaxKnowledgeCards.test.cjs
.venv\\Scripts\\python.exe -m unittest discover -s tests -p indonesia_tax_ingestion_test.py
node tools/indonesia_tax_kb/evaluate.cjs
node tools/indonesia_tax_kb/export_cards.cjs
# macOS/Linux: use .venv/bin/python instead of .venv\\Scripts\\python.exe above.
```

Verify the manifest BEFORE executing any code or regeneration. The evaluator calls retrieve anew; saved answers are output/baseline data, never used as runtime search results. Tests call the same runtime. Evaluation writes fresh results into knowledge/indonesia_tax_kb/quality. Card export calls getCard anew. Read ANTIGRAVITY_HANDOFF.md for the exact data contract and display restrictions.

Included regression tests: empty index, deleted supporting fragments, source SHA change, no text anchor, unsuitable period, amendment gap, unverified TER, multilingual paraphrases and live card/chat parity. Python ingestion tests mock network/version extraction to exercise idempotence and failures; the blank PDF extraction and archived TER candidate inspection are real. TER inspection tests structural preservation/review flags, NOT correctness of numeric rows. No real model is called. Technical tests do not certify translation interpretation, tax applicability or current law.

PDF and extraction bytes are included because loadCheckedIndex verifies them. You may not replace them with a newly downloaded edition or regenerated extraction and retain old claim approval. All paths are relative to the extracted root. No Git checkout, production service, environment secrets or database is needed to run checks. Packaging scripts themselves require Git and are not part of the verification commands.

The manifest binds every file except itself, including original PDFs; archive SHA is supplied separately. Source URLs/dates/legal review statuses remain in sources.json. Download dates are not currency-review dates.
'''.encode('utf-8')
manifest={'commit':commit,'baseline_sha':'1a017a63eede6e836d1dc7a1aeda25356c5ead3d','files':{n:hashlib.sha256(b).hexdigest() for n,b in sorted(payload.items())},'model_calls':0,'professional_review':None,'PDFs_included':True}
payload['PACKAGE_MANIFEST.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
out=repo/'output/acceptance';out.mkdir(parents=True,exist_ok=True)
archive=out/('PR133_Reproducible_'+commit[:8]+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in sorted(payload.items()):z.writestr(name,data)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name,digest in manifest['files'].items():assert hashlib.sha256(z.read(name)).hexdigest()==digest
digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_suffix('.sha256.txt').write_text(digest+'\n',encoding='ascii')
print(json.dumps({'archive':str(archive),'commit':commit,'files':len(payload),'bytes':archive.stat().st_size,'sha256':digest}))
