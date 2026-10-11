"""Versioned article/continuation index. Raw text never corrected or reassigned by topic.
Continuation requires contiguous selected physical pages and a preceding explicit heading.
Explicit Penjelasan headings get their own role; initial orphan text has no inferred parent.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

HEADING = re.compile(r'(?mi)^(?:(Penjelasan)\s+)?(?:Pasal|Pasa1)\s+([0-9A-Z]+)(?:\s+[iI]?[*)(.]+)?\s*$')
STRUCTURE = re.compile(r'(?mi)^(BAB\s+[IVXLCDM]+|Bagian\s+\w+|PENJELASAN|LAMPIRAN)\s*$')
END = re.compile(r'(?mi)^(?:Agar setiap orang|Ditetapkan di|Diundangkan di)')
AMEND = re.compile(r'(?mi)^\d+\.\s*(?:Ketentuan|Pasal\s+\d+|Setelah\s+Bagian|Di antara\s+Pasal)[^\n]*')
FURNITURE = re.compile(r'(?mi)^(?:PRES\s*IDEN|REPU[^\n]*INDONESIA|MENTER[^\n]*KEUANGAN|SALINAN|SK No[^\n]*|(?:www\.)?jdih\.kemenkeu\.go\.id|\s*-\s*\d+\s*-\s*)$')

def h(text):return hashlib.sha256(text.encode()).hexdigest()
def build(root):
    registry=json.loads((root/'sources.json').read_text(encoding='utf-8'))
    manifest=json.loads((root/'store/manifest.json').read_text(encoding='utf-8'))
    selections=json.loads((root/'selections.json').read_text(encoding='utf-8'))
    fragments=[];provisions={}
    for selection in selections:
        sid=selection['source_id'];source=next(s for s in registry['sources'] if s['id']==sid)
        record=manifest['sources'].get(sid,{})
        if not record.get('versions'):continue
        version=next(v for v in record['versions'] if v['sha256']==record['current_sha256'])
        sha=version['sha256'];blob=root/'store'/version['blob'];ext=root/'store'/version['extraction']
        if hashlib.sha256(blob.read_bytes()).hexdigest()!=sha:raise ValueError('source_integrity_failure')
        extracted=json.loads(ext.read_text(encoding='utf-8'));extsha=hashlib.sha256(ext.read_bytes()).hexdigest()
        current=None;previous_page=None;ordinal=0;outline=[]
        scope=h(selection['context'])[:12]
        for p in extracted['pages']:
            if not selection['page_from']<=p['page']<=selection['page_to']:continue
            if p['quality']=='unreliable':current=None;previous_page=p['page'];continue
            if previous_page is None or p['page']!=previous_page+1:current=None
            text=p['text'];markers=[]
            # A signature/promulgation-only page is not a continuation of the final operative article.
            if END.search(text) and not HEADING.search(text) and not re.search(r'(?m)^\(\s*\d+',text):current=None
            for m in HEADING.finditer(text):markers.append((m.start(),'article',m))
            for m in STRUCTURE.finditer(text):markers.append((m.start(),'structure',m))
            for m in END.finditer(text):markers.append((m.start(),'end',m))
            for m in AMEND.finditer(text):markers.append((m.start(),'amendment',m))
            for m in FURNITURE.finditer(text):
                markers.append((m.start(),'furniture',m));markers.append((m.end(),'furniture_end',m))
            markers.sort(key=lambda x:x[0]);starts=sorted(set([0]+[x[0] for x in markers]+[len(text)]))
            by_start={x[0]:x for x in markers}
            for start,end in zip(starts,starts[1:]):
                marker=by_start.get(start);explicit=False
                if marker:
                    _,kind,m=marker
                    if kind=='structure':outline.append(m.group(0).strip());current=None
                    elif kind=='end':current=None
                    elif kind in ('furniture','furniture_end'):pass
                    elif kind=='amendment':
                        # The instruction changing/deleting an article is not the preceding article's body.
                        target=re.search(r'Pasal\s+(\d+[A-Z]?)',m.group(0),re.I)
                        if target:
                            ordinal+=1;article=target.group(1).upper();role='amendment_instruction'
                            pid=f'{sid}:{sha[:16]}:{scope}:{role}:{article}:{ordinal}'
                            current={'id':pid,'article':article,'role':role};explicit=True
                            provisions[pid]={'id':pid,'source_id':sid,'sha256':sha,'article':article,'role':role,
                              'context':selection['context'],'fragment_ids':[],'related_explanation_ids':[]}
                        else:current=None
                    else:
                        article=m.group(2).upper();role='explanation' if m.group(1) else 'operative_text';explicit=True
                        # Empty duplicate heading at page end must not change article identity.
                        if not current or current['article']!=article or current['role']!=role:
                            ordinal+=1
                            pid=f'{sid}:{sha[:16]}:{scope}:{role}:{article}:{ordinal}'
                            current={'id':pid,'article':article,'role':role}
                            provisions[pid]={'id':pid,'source_id':sid,'sha256':sha,'article':article,'role':role,
                              'context':selection['context'],'fragment_ids':[], 'related_explanation_ids':[]}
                body=text[start:end].strip()
                if len(body)<20:continue
                part_current=None if marker and marker[1]=='furniture' else current
                stable=h(f'{sid}:{sha}:{p["page"]}:{start}:{end}')[:24]
                fid=sid+':'+stable
                locator={'page':p['page'],'article':part_current['article'] if part_current else None,
                  'context':selection['context'],'start':start,'end':end,
                  'article_origin':'explicit_heading' if explicit else 'contiguous_continuation' if part_current else 'unassigned',
                  'paragraph_markers':[{'raw':m.group(0),'offset':start+m.start()} for m in re.finditer(r'(?m)^\(\s*\d+[a-z]?\s*\)',text[start:end])],
                  'footnote_markers':[{'raw':m.group(0),'offset':start+m.start(),'meaning_status':'unresolved'} for m in re.finditer(r'\*{2,}\)?',text[start:end])],
                  'outline':list(outline)}
                f={'id':fid,'source_id':sid,'sha256':sha,'text':body,'language':'id',
                  'topics':selection.get('topics',source['topics']),'locator':locator,
                  'provision_id':part_current['id'] if part_current else None,'role':part_current['role'] if part_current else 'unassigned',
                  'source_link':source['download_url']+'#page='+str(p['page']),'extraction_sha256':extsha,
                  'effective_from':selection.get('effective_from',source['effective_from']),
                  'effective_to':selection.get('effective_to'), 'end_date_confirmed':False,
                  'verification_status':'extracted_candidate','text_quality':'candidate_not_OCR_certified',
                  'tables':p['tables'],'unresolved_issues':selection.get('issues',['extraction_and_currency_require_review']),
                  'previous_fragment_id':None,'next_fragment_id':None}
                fragments.append(f)
                if part_current:
                    group=provisions[part_current['id']];group['fragment_ids'].append(fid)
            previous_page=p['page']
    by_id={f['id']:f for f in fragments}
    for g in provisions.values():
        ids=g['fragment_ids']
        for i,fid in enumerate(ids):
            by_id[fid]['previous_fragment_id']=ids[i-1] if i else None
            by_id[fid]['next_fragment_id']=ids[i+1] if i+1<len(ids) else None
        if g['role']=='operative_text':
            g['related_explanation_ids']=[x['id'] for x in provisions.values() if x['role']=='explanation' and
              x['source_id']==g['source_id'] and x['article']==g['article'] and x['context']==g['context']]
    payload={'schema_version':2,'fragments':fragments,'provisions':list(provisions.values())}
    (root/'index.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    return payload
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args()
    data=build(Path(a.root));print('fragments',len(data['fragments']),'provisions',len(data['provisions']))
