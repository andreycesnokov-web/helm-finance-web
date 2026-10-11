"""Bind editorial statements to exact reviewed source versions and provision text.
Selectors describe legal provisions, never test numbers/pages. No new legal review is inferred.
"""
import json
from pathlib import Path
def norm(s):return ' '.join(s.lower().split())
def bind(root):
    index=json.loads((root/'index.json').read_text(encoding='utf-8'))
    definitions=json.loads((root/'claim_definitions.json').read_text(encoding='utf-8'))
    reviewed=json.loads((root/'reviewed_versions.json').read_text(encoding='utf-8'))
    sources=json.loads((root/'sources.json').read_text(encoding='utf-8'))['sources']
    by_id={f['id']:f for f in index['fragments']};claims=[]
    for definition in definitions['claims']:
        c={k:v for k,v in definition.items() if k!='selectors'};c['supports']=[];c['binding_issues']=[]
        for selector in definition['selectors']:
            sid=selector['source_id'];expected=reviewed.get(sid)
            options=[g for g in index['provisions'] if g['source_id']==sid and g['article']==selector['article'] and g['role']==selector['role'] and g['sha256']==expected]
            matches=[]
            for g in options:
                text='\n'.join(by_id[fid]['text'] for fid in g['fragment_ids'])
                if all(norm(anchor) in norm(text) for anchor in [selector['needle'],*selector.get('passages',[])]):matches.append(g)
            if len(matches)!=1:
                c['binding_issues'].append({'code':'provision_not_uniquely_bound','selector':selector,'matches':len(matches)})
                continue
            g=matches[0];source=next(s for s in sources if s['id']==sid)
            # This previous provision is a reading reference for an explicit transition, not a current basis.
            use=selector.get('use','support')
            c['supports'].append({'provision_id':g['id'],'fragment_ids':g['fragment_ids'],
              'source_id':sid,'sha256':expected,'article':g['article'],'paragraphs':selector['paragraphs'],
              'role':g['role'],'use':use,'text_anchor':selector['needle'],
              'text_anchors':[selector['needle'],*selector.get('passages',[])],
              'related_explanation_provision_ids':g['related_explanation_ids'],
              'pages':sorted(set(by_id[i]['locator']['page'] for i in g['fragment_ids'])),
              'links':[by_id[i]['source_link'] for i in g['fragment_ids']],
              'period_restrictions':c['period'],'text_review':'editorial_anchor_checked_not_professional_review',
              'quality_limitations':['candidate_text_layer','paragraph_labels_may_contain_OCR_errors'],
              'source_period':{'from':by_id[g['fragment_ids'][0]]['effective_from'],'to':by_id[g['fragment_ids'][0]]['effective_to']}})
        c['binding_status']='bound' if not c['binding_issues'] else 'incomplete'
        claims.append(c)
    (root/'claims.json').write_text(json.dumps({'schema_version':2,'claims':claims},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    return claims
if __name__=='__main__':
    root=Path(__file__).resolve().parents[2]/'knowledge/indonesia_tax_kb'
    claims=bind(root)
    print('claims',len(claims),'bound',sum(c['binding_status']=='bound' for c in claims))
    for c in claims:
        if c['binding_issues']:print(c['id'],c['binding_issues'])
