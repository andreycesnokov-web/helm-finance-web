"""Reproducible inventory of legacy research and the new archive, never a legal review."""
import csv
import hashlib
import json
from pathlib import Path

root=Path(__file__).resolve().parents[2]
legacy=root/'knowledge/indonesia_official_kb'
kb=root/'knowledge/indonesia_tax_kb'
manifest=json.loads((kb/'store/manifest.json').read_text(encoding='utf-8'))
registry=json.loads((kb/'sources.json').read_text(encoding='utf-8'))
selections=json.loads((kb/'selections.json').read_text(encoding='utf-8'))
files=[]
fully_read={'README.md','ingestion_plan.md','reviewer_notes.md','MANIFEST.md','pph_23.md','pph_4_2.md','ppn_vat.md','coretax_bukti_potong.md','tax_rule_candidates.json','compliance_rule_candidates.json','evidence_rule_candidates.json'}
read_pages={'PP34_2017':[3,4,5,6,7,8],'PMK141_2015':[2,3,4], 'PP55_2022':[53,56],
 'PP20_2026':[3,4,5,6,7,8,9,10,11], 'PP58_2023':[5,11], 'PMK168_2023':[5,15,23],
 'PMK164_2023':[6,16,22,23], 'PMK131_2024':[1,2,3,4,5], 'PMK53_2025':[2,3,4],
 'PMK81_2024':[78,80,83,138,139,140,141,142,143], 'PMK54_2025':[1,2,3],
 'DJP_SDSN_2023':[213,214,231,232,236,242,243,244,249,252]}
for p in sorted(legacy.rglob('*')):
    if p.is_file():
        data=p.read_bytes()
        files.append({'path':str(p.relative_to(root)).replace('\\','/'),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
          'inspection':'parsed_registry' if p.name in ('source_registry.json','source_registry.csv') else
          'read_research_reference' if p.name in fully_read and (p.name!='README.md' or p.parent==legacy) else 'read_excerpt_only' if p.suffix=='.md' else 'listed_not_read',
          'legal_status':'not_verified'})
old=json.loads((legacy/'source_registry.json').read_text(encoding='utf-8'))
oldcsv=list(csv.DictReader((legacy/'source_registry.csv').open(encoding='utf-8-sig')))
report={'research_as_of':'2026-10-06','legacy_file_inventory':files,
 'legacy_registry_sources':len(old['sources']),'legacy_csv_rows':len(oldcsv),
 'legacy_archived_documents':[str(p.relative_to(root)) for p in legacy.rglob('*') if p.suffix.lower() in ('.pdf','.zip','.gz','.tar')],
 'legacy_downloaded_file_fields':sum(bool(s.get('downloaded_file')) for s in old['sources']),
 'legacy_statuses':sorted(set(s['status'] for s in old['sources'])),
 'legacy_claims_not_adopted':'All prior rate candidates are under review; a file hash establishes identity only.',
 'live_database_inspected':False,'new_sources':[]}
for s in registry['sources']:
    record=manifest['sources'].get(s['id'],{})
    versions=record.get('versions',[])
    s['downloaded_at']=versions[-1]['downloaded_at'] if versions else None
    s['sha256']=versions[-1]['sha256'] if versions else None
    s['checked_at']='2026-10-06'
    s['professional_review']=None
    s['verification_status']=('downloaded_selected_provisions_read' if s['id'] in read_pages else 'downloaded_extracted_not_read') if versions else 'download_failed'
    s['read_scope']=read_pages.get(s['id'],[]) if versions else []
    s['selected_index_scope']=[{'from':x['page_from'],'to':x['page_to'],'context':x['context']} for x in selections if x['source_id']==s['id']] if versions else []
    if s['id']=='PP20_2026':s['effective_from']='2026-04-22';s['date_basis']='Pasal II angka2 + promulgation p11'
    if s['id']=='PMK164_2023':s['effective_from']='2023-12-29';s['date_basis']='Pasal25 p22 + promulgation p23'
    if s['id']=='PMK53_2025':s['effective_from']='2025-08-01';s['date_basis']='Pasal II p4'
    if s['id']=='PP58_2023':s['relationships']=[{'type':'partially_repeals','target':'PP80_2010','scope':'Pasal2(3) only; PP58 Pasal4'}]
    if s['id']=='PMK164_2023':s['relationships']=[{'type':'partially_repeals','target':'PMK68_2010_as_amended_PMK197_2013','scope':'Pasal4 and5; PMK164 Pasal24'},{'type':'repeals','target':'PMK99_2018'}]
    if s['id']=='PMK1_2026':s['unresolved_issues'].append('two_download_timeouts; exact_current_amendment_text_not_read') if 'two_download_timeouts; exact_current_amendment_text_not_read' not in s['unresolved_issues'] else None
    if versions:
        e=json.loads((kb/'store'/versions[-1]['extraction']).read_text(encoding='utf-8'))
        s['archive_pages']=len(e['pages'])
    report['new_sources'].append({'id':s['id'],'status':s['verification_status'],'sha256':s['sha256'],'read_scope':s['read_scope']})
(kb/'sources.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(kb/'inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('legacy files',len(files),'legacy sources',len(old['sources']),'archived',sum(bool(s['sha256']) for s in registry['sources']))
