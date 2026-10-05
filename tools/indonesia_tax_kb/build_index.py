"""Build a deterministic index from explicitly selected primary-text page ranges.
Article boundaries are candidates; no OCR correction or legal interpretation is performed.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

def build(root):
    sources = json.loads((root/'sources.json').read_text(encoding='utf-8'))
    manifest = json.loads((root/'store/manifest.json').read_text(encoding='utf-8'))
    selections = json.loads((root/'selections.json').read_text(encoding='utf-8'))
    fragments = []
    for selection in selections:
        sid = selection['source_id']
        source = next(s for s in sources['sources'] if s['id'] == sid)
        record = manifest['sources'].get(sid, {})
        versions = record.get('versions', [])
        if not versions:
            continue
        version = next(v for v in versions if v['sha256'] == record['current_sha256'])
        sha = version['sha256']
        blob = root/'store'/version['blob']
        if hashlib.sha256(blob.read_bytes()).hexdigest() != sha:
            raise ValueError('source_integrity_failure')
        extraction = json.loads((root/'store'/version['extraction']).read_text(encoding='utf-8'))
        selected = [p for p in extraction['pages'] if selection['page_from'] <= p['page'] <= selection['page_to']]
        for page in selected:
            if page['quality'] == 'unreliable':
                continue
            # Keep paragraphs, lettering and table structure; do not split by arbitrary tokens.
            text = page['text']
            boundaries = list(re.finditer(r'(?mi)^(?:Pasal|Pasa1)\s+([0-9A-ZIl]+)\s*$', text))
            points = [0] + [m.start() for m in boundaries if m.start() != 0] + [len(text)]
            for start, end in zip(points, points[1:]):
                body = text[start:end].strip()
                if len(body) < 100:
                    continue
                article = next((m.group(1) for m in boundaries if m.start() == start), None)
                locator = {'page':page['page'], 'article':article,
                           'context':selection['context'], 'start':start, 'end':end}
                stable = hashlib.sha256((sid+':'+sha+':'+str(page['page'])+':'+str(start)+':'+str(end)).encode()).hexdigest()
                fragments.append({'id':sid+':'+stable[:24], 'source_id':sid,'sha256':sha,
                    'text':body, 'language':'id','topics':selection.get('topics',source['topics']),
                    'locator':locator,'source_link':source['download_url']+'#page='+str(page['page']),
                    'extraction_sha256':hashlib.sha256((root/'store'/version['extraction']).read_bytes()).hexdigest(),
                    'effective_from':selection.get('effective_from',source['effective_from']),
                    'effective_to':selection.get('effective_to'),
                    'verification_status':'extracted_candidate', 'checked_at':None,
                    'text_quality':'candidate_not_OCR_certified','tables':page['tables'],
                    'conditions':selection.get('conditions',{}),
                    'unresolved_issues':selection.get('issues',['extraction_and_currency_require_review'])})
    payload={'schema_version':1,'fragments':fragments}
    (root/'index.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return payload

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True)
    args=p.parse_args();print('fragments',len(build(Path(args.root))['fragments']))
