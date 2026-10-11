"""Package an exact committed repair SHA; explicit whitelist, no PDFs/env/credentials/model calls."""
import csv
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

repo=Path(__file__).resolve().parents[2];kb=repo/'knowledge/indonesia_tax_kb'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
if subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=repo,text=True).strip():
    raise RuntimeError('Commit reviewed artifacts first; archive must match exact SHA')
base=repo/'output/acceptance';stage=base/('package-'+sha[:8]);stage.mkdir(parents=True,exist_ok=True)
def write(name,body):
    p=stage/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(body,encoding='utf-8',newline='\n')
def js(name,data):write(name,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def copy(source,name):
    p=stage/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,p)
def load(p):return json.loads(p.read_text(encoding='utf-8'))
whitelist=['README.md','INTEGRATION.md','REPAIR_REVIEW.md','REVIEW_GAPS.md','INVENTORY.md','sources.json','cards.json',
 'CARDS.md','claims.json','claim_definitions.json','clarifications.json','reviewed_versions.json',
 'quality/RESULTS.md','quality/results_78.csv','quality/results.json','quality/comparison_summary.json',
 'quality/EXAMPLE_ANSWERS.md','quality/questions.json','quality/provision_expectations.json','quality/EXPECTATION_CHANGES.md',
 'quality/FAIL_GROUPS.json','quality/VALIDATION.md','quality/node-tests-v2.log','quality/python-tests-v2.log']
for name in whitelist:copy(kb/name,'current/'+name)
for name in ['results_78.csv','runtime_results_78.json','cards_unbound.json','node_tests_original.txt','node-tests.log']:
    copy(kb/'quality/baseline_749937d'/name,'baseline_749937d/'+name)
registry=load(kb/'sources.json')['sources'];manifest=load(kb/'store/manifest.json');downloaded=[]
for source in registry:
    if not source['sha256']:continue
    record=manifest['sources'][source['id']];version=next(v for v in record['versions'] if v['sha256']==source['sha256'])
    assert hashlib.sha256((kb/'store'/version['blob']).read_bytes()).hexdigest()==source['sha256']
    downloaded.append({**source,'sha_check':'PASS','PDF_in_PR':'https://github.com/andreycesnokov-web/helm-finance-web/blob/'+sha+'/knowledge/indonesia_tax_kb/store/'+version['blob']})
assert len(downloaded)==13;js('sources/registry13_checked.json',downloaded)
with (stage/'sources/registry13.csv').open('w',encoding='utf-8-sig',newline='') as f:
    cols=['id','title','document_number','download_url','downloaded_at','sha256','effective_from','effective_to','verification_status','PDF_in_PR'];w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
    for s in downloaded:w.writerow({k:s.get(k) for k in cols})
# Separate nine readable examples selected from actual outputs, not newly generated tax advice.
records=load(kb/'quality/results.json');examples=[];doc=('# RU / EN / ID: grounded explanation, partial answer, blocked determination\n\n'
 'All examples are actual outputs of retrieve(), without a model. The grounded example selects one returned '
 'documentary statement within a generally partial response; it does not claim current legal validity.\n')
for kind,case,claim in [('text_grounded_general','Q03','RENT_SCOPE'),('partial_with_deadline_blockers','Q23','DEADLINE_SEPARATION'),('blocked_historical_determination','Q07',None)]:
    for language in ['ru','en','id']:
        r=next(r for r in records if r['case_id']==case and r['language']==language);out=r['actual'];c=next((c for c in out['claims'] if c['id']==claim),None)
        examples.append({'example_kind':kind,'case':case,'language':language,'question':r['question'],'actual_output':out})
        doc+='\n## '+kind+' / '+language.upper()+'\n\n'+r['question']+'\n\n'+out['notice']+'\n\n'
        if c:
            doc+=c['text']+'\n\n'
            for eid in c['evidence_ids']:
                e=next(e for e in out['claim_evidence'] if e['provision_id']==eid)
                doc+='- ['+e['source_id']+' article'+e['article']+' / '+e['paragraphs']+' / pages'+','.join(map(str,e['pages']))+']('+e['links'][0]+'), SHA '+e['sha256']+'; fragments '+','.join(e['fragment_ids'])+'.\n'
        doc+='\nAnswer='+out['answer_status']+'; company applicability='+out['applicability']['status']+'; numerical use='+out['numerical_use']['status']+'.\n\nBlocked:'+ '; '.join(sorted(set(b['code'] for b in out['blockers'])))+'.\n\n'
        doc+='\n'.join('- '+q['text'] for q in out['clarifying_questions'])+'\n'
write('examples/RU_EN_ID.md',doc);js('examples/actual_nine_outputs.json',examples)
summary=load(kb/'quality/comparison_summary.json')
js('PACKAGE_IDENTITY.json',{'PR':'https://github.com/andreycesnokov-web/helm-finance-web/pull/133','sha':sha,
 'baseline_sha':'749937d1df368302e4f05480504445db0eea08d1','date_Asia_Shanghai':'2026-10-06',
 'comparison':summary,'node_tests':41,'python_tests':7,'model_calls':0,'professional_review':None,'PDFs_included':False})
write('README_RU.md',f'''# Приёмка исправлений draft PR #133

SHA:`{sha}`. База сравнения:`749937d1df368302e4f05480504445db0eea08d1`. Код/снимки пакета соответствуют этому commit.

Сначала прочитайте current/REPAIR_REVIEW.md и current/quality/RESULTS.md. Исходные26×3 вопросы и результаты
сохранены, а runtime не читает эталон или номера тестов. До:38 PASS/40 FAIL постраничной приёмки. После:
75 PASS/3 FAIL при буквальном старом эталоне;3 ошибочно требуют страницу подписей8 для Q07. Исправленный
эталон проверяет Pasal7/page7 и исторический статус. По положениям/тексту/привязке/ограничениям78 технических PASS.
75 запусков находятся в охвате,72 сохраняют содержательные доказанные по архивному тексту пояснения;3
запроса аренды2017 блокируются с историческими материалами, ещё3 — вне охвата. Это не отказ от всех ответов.

В пакете:сравнение78 строк и полные JSON-ответы,41 Node/7 Python тестов с журналами,9 примеров RU/EN/ID,
обновлённый контракт v2, все8 карточек с33 атомарными утверждениями, точные fragment/документ/SHA/статья/
пункт/страницы/период, реестр13 PDF и списки пробелов. PDF не повторяются:ссылки на файлы PR по SHA в sources/.

Техническое подтверждение относится к поиску, byte/text-привязке и блокировкам. Оно не подтверждает
юридическую актуальность, правильность каждой интерпретации/перевода или лицензированную проверку.
Точная ставка/расчёт TER, текущие ставки/сроки и налоговый вывод о компании остаются заблокированными.
PMK1/2026, полнота поправок, исторические акты, OCR пунктов/сносок, таблицы TER и проверка специалистом — пробелы.

Реальная модель, server/index.js, финансовые расчёты, интерфейс Accountant, PR129–132, flags/env,
миграции/production/активации не затронуты. Merge и deploy не выполнялись. Пакет:явный whitelist без PDF,
секретов и клиентских данных; эвристическая проверка токенов не является security-сертификацией.
SHA256SUMS.json проверяет каждый файл кроме себя; zip-checksum выдаётся отдельно.
''')
patterns=[r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'gh[pousr]_[A-Za-z0-9]{30,}',r'github_pat_[A-Za-z0-9_]{30,}',r'\bsk-[A-Za-z0-9_-]{20,}']
files=[p for p in stage.rglob('*') if p.is_file() and p.name!='SHA256SUMS.json']
for p in files:
    assert p.suffix.lower() not in ('.pdf','.pem','.key') and p.name!='.env'
    text=p.read_text(encoding='utf-8-sig');assert not any(re.search(rx,text) for rx in patterns),p
sums={str(p.relative_to(stage)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files};js('SHA256SUMS.json',sums)
archive=base/('PR133_Indonesia_Tax_KB_Repair_'+sha[:8]+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(stage.rglob('*')):
        if p.is_file():z.write(p,str(p.relative_to(stage)).replace('\\','/'))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name,digest in sums.items():assert hashlib.sha256(z.read(name)).hexdigest()==digest
digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_suffix('.sha256.txt').write_text(digest+'\n',encoding='ascii')
print(json.dumps({'archive':str(archive),'sha':sha,'archive_sha256':digest,'files':len(sums)+1,'bytes':archive.stat().st_size}))
