"""Load model inputs independently from reference labels; score without model calls."""
import json
import re
from pathlib import Path

PRODUCT_FIELDS={'title','description','category'}


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def load_inputs(folder, pilot=False):
    folder=Path(folder)
    rows=read_jsonl(folder/'inputs.jsonl')
    if len({r['id'] for r in rows})!=len(rows):raise ValueError('duplicate input IDs')
    if pilot:
        ids=set(json.loads((folder/'pilot-ids.json').read_text()))
        rows=[r for r in rows if r['id'] in ids]
        if len(rows)!=len(ids):raise ValueError('unknown pilot IDs')
    return rows


def model_product(row):
    product=row['product']
    if not set(product)<=PRODUCT_FIELDS:raise ValueError('unexpected product fields; potential label leakage')
    return {k:product.get(k) for k in sorted(PRODUCT_FIELDS)}


def load_labels(folder):
    rows=read_jsonl(Path(folder)/'labels.jsonl')
    if len({r['id'] for r in rows})!=len(rows):raise ValueError('duplicate label IDs')
    return {r['id']:r for r in rows}


def score_hs6(predictions, labels):
    """Full-denominator exact match. Missing/abstained/failed predictions count wrong.
    Pass only the evaluated subset of labels when using the starter sample.
    Mercari's null labels deliberately yield no accuracy, never 100% null==null.
    """
    if len({r['id'] for r in predictions})!=len(predictions):raise ValueError('duplicate predictions')
    by_id={r['id']:r for r in predictions}
    gold={k:v for k,v in labels.items() if re.fullmatch(r'\d{6}',str(v.get('reference_hs6') or ''))}
    answered=correct=hs2=hs4=0
    for key,label in gold.items():
        predicted=by_id.get(key,{}).get('hs6')
        if re.fullmatch(r'\d{6}',str(predicted or '')):
            answered+=1
            correct+=predicted==label['reference_hs6']
            hs2+=predicted[:2]==label['reference_hs6'][:2]
            hs4+=predicted[:4]==label['reference_hs6'][:4]
    n=len(gold)
    return {'reference_cases':n,'answered':answered,'correct_hs6':correct,
            'accuracy_all':correct/n if n else None,
            'accuracy_answered':correct/answered if answered else None,
            'coverage':answered/n if n else None,
            'accuracy_hs2_all':hs2/n if n else None,'accuracy_hs4_all':hs4/n if n else None,
            'label_basis':'dataset expert reference; not verified Korean HSK' if n else 'unlabelled: accuracy unavailable'}
