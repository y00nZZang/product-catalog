"""Frozen service-scope selector: never reads labels or model outputs."""
import collections
import hashlib
import json
import re
from pathlib import Path
from customs_dataset import load_inputs
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'datasets/customs/2026-10-06/hscodecomp'
DEST=ROOT/'datasets/customs/2026-10-07/service-scope'

def classify_scope(row,policy):
    category=row['metadata']['top_category']
    if category not in policy['include_categories']:
        return 'exclude','category:'+category
    title=row['product']['title']
    for reason,pattern in policy['exclude_title_patterns'].items():
        if re.search(pattern,title):return 'exclude',reason
    return 'include','household/hobby category; no professional-equipment exclusion'

def select_fresh(rows,old_ids,n=96):
    buckets=collections.defaultdict(list)
    for r in rows:
        if r['id'] not in old_ids:buckets[r['metadata']['top_category']].append(r)
    for values in buckets.values():values.sort(key=lambda r:hashlib.sha256(('scope-v1|'+r['id']).encode()).hexdigest())
    selected=[]
    while len(selected)<n:
        added=False
        for key in sorted(buckets):
            if buckets[key] and len(selected)<n:selected.append(buckets[key].pop(0));added=True
        if not added:break
    return sorted(selected,key=lambda r:r['id'])

def main():
    policy=json.loads((DEST/'scope-policy.json').read_text())
    rows=load_inputs(SOURCE);old_ids=set(json.loads((SOURCE/'pilot-ids.json').read_text()))
    audit=[];eligible=[]
    for row in rows:
        decision,reason=classify_scope(row,policy)
        audit.append({'id':row['id'],'top_category':row['metadata']['top_category'],
            'title':row['product']['title'],'decision':decision,'reason':reason,'previously_evaluated':row['id'] in old_ids})
        if decision=='include':eligible.append(row)
    fresh=select_fresh(eligible,old_ids)
    observed=[r for r in eligible if r['id'] in old_ids]
    initial_fresh_ids=[r['id'] for r in fresh]
    review_path=DEST/'manual-review.jsonl'
    reviews={r['id']:r for r in map(json.loads,review_path.read_text().splitlines())} if review_path.exists() else {}
    excluded_review={k for k,v in reviews.items() if v['decision']=='exclude'}
    for a in audit:
        if a['id'] in excluded_review:a.update(decision='exclude',reason='manual:'+reviews[a['id']]['reason'])
    eligible=[r for r in eligible if r['id'] not in excluded_review]
    fresh=[r for r in fresh if r['id'] not in excluded_review]
    observed=[r for r in observed if r['id'] not in excluded_review]
    for name,values in [('fresh-inputs.jsonl',fresh),('observed-inputs.jsonl',observed),('scope-audit.jsonl',audit)]:
        (DEST/name).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in values))
    (DEST/'selection.json').write_text(json.dumps({'policy_sha256':hashlib.sha256((DEST/'scope-policy.json').read_bytes()).hexdigest(),
        'initial_fresh_ids':initial_fresh_ids,'manual_excluded_ids':sorted(excluded_review),
        'manual_review_sha256':hashlib.sha256(review_path.read_bytes()).hexdigest() if review_path.exists() else None,
        'all_source_cases':len(rows),'eligible_cases':len(eligible),'excluded_cases':len(rows)-len(eligible),
        'observed_ids':[r['id'] for r in observed],'fresh_ids':[r['id'] for r in fresh],
        'fresh_pool':sum(r['id'] not in old_ids for r in eligible),
        'fresh_categories':dict(collections.Counter(r['metadata']['top_category'] for r in fresh)),
        'exclusion_reasons':dict(collections.Counter(r['reason'] for r in audit if r['decision']=='exclude'))},indent=2))
    print((DEST/'selection.json').read_text())

if __name__=='__main__':main()
