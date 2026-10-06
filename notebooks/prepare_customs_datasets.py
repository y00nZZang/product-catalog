"""Prepare benchmark inputs separately from labels; no model calls.
Mercari source must be minimized public DOM captures, never complete page HTML/session state.
"""
import argparse
import hashlib
import json
import re
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HF_REPO='ATH-MaaS/HSCodeComp'
HF_REVISION='ce9119795acef4ca537b2175e10a3feb7a0ecae9'
HF_BASE=f'https://huggingface.co/datasets/{HF_REPO}/resolve/{HF_REVISION}/'
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'datasets/customs/2026-10-06'


def write_jsonl(path, rows):
    path.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))


def hash_file(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def download(file):
    req=urllib.request.Request(HF_BASE+file,headers={'User-Agent':'product-catalog-dataset-preparation'})
    with urllib.request.urlopen(req,timeout=30) as response:
        data=response.read(12_000_001)
        if len(data)>12_000_000:raise ValueError('Source too large')
    return file,data


def prepare_hf():
    folder=DEST/'hscodecomp';source=folder/'source';source.mkdir(parents=True,exist_ok=True)
    names=['data/test_data.jsonl','LICENSE','NOTICE','README.md']
    missing=[name for name in names if not (source/Path(name).name).exists()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for name,data in pool.map(download,missing):
            (source/Path(name).name).write_bytes(data)
    raw=[json.loads(line) for line in (source/'test_data.jsonl').read_text().splitlines()]
    tax=json.loads((ROOT/'src/customs/data/hs2022.json').read_text())
    leaves={e['code'] for e in tax['entries'] if len(e['code'])==6}
    inputs,labels,removed=[],[],[]
    for r in raw:
        identifier=f'hscodecomp-{r["task_id"]:04d}'
        attrs=json.loads(r['product_attributes'])
        # Classification-label keys in supplier attributes must not become model features.
        filtered={k:v for k,v in attrs.items() if not re.search(r'\bHS\b|HS.?CODE|HTS|tariff.?code|海关编码|税番',k,re.I)}
        if len(filtered)!=len(attrs):removed.append(identifier)
        category=[r.get(f'cate_lv{i}_desc') for i in range(1,6)]
        category=list(dict.fromkeys(c for c in category if c))
        product={'title':r['product_name'],'description':json.dumps(filtered,ensure_ascii=False),
                 'category':' > '.join(category)}
        inputs.append({'id':identifier,'product':product,'kind':'expert_benchmark_input',
                       'metadata':{'dataset':HF_REPO,'revision':HF_REVISION,'task_id':r['task_id'],
                                   'top_category':r['cate_lv1_desc'],'input_scope':'original title + attributes + categories; no question/answer fields'}})
        code=str(r['hs_code']).zfill(10)
        assert re.fullmatch(r'\d{10}',code) and code[:6] in leaves
        labels.append({'id':identifier,'reference_hs6':code[:6],'reference_code10':code,
                       'jurisdiction':'US','label_status':'dataset_expert_reference',
                       'local_human_reviewed':False,'official_ruling_verified':False,
                       'label_source':f'https://huggingface.co/datasets/{HF_REPO}/blob/{HF_REVISION}/data/test_data.jsonl',
                       'hs_edition':'not_explicitly_verified; all HS6 labels occur in local HS2022 taxonomy'})
    assert len(inputs)==632 and len({r['id'] for r in inputs})==632
    write_jsonl(folder/'inputs.jsonl',inputs);write_jsonl(folder/'labels.jsonl',labels)
    # Deterministic category-stratified starter sample. No filtering by model predictions or known-answer inclusion.
    groups=defaultdict(list)
    for r in inputs:groups[r['metadata']['top_category']].append(r['id'])
    pilot=[identifier for category in sorted(groups) for identifier in sorted(groups[category],key=lambda x:hashlib.sha256(x.encode()).hexdigest())[:3]]
    (folder/'pilot-ids.json').write_text(json.dumps(pilot,indent=2))
    manifest={'dataset':HF_REPO,'revision':HF_REVISION,'prepared_at':datetime.now(timezone.utc).isoformat(),
              'records':len(inputs),'top_categories':dict(Counter(r['metadata']['top_category'] for r in inputs)),
              'hs6_classes':len(set(r['reference_hs6'] for r in labels)), 'hs2022_label_membership':632,
              'starter_sample_records':len(pilot),'label_attribute_keys_removed':removed,
              'license':'Apache-2.0; original LICENSE and NOTICE retained',
              'label_note':'Expert benchmark reference, not a Korean HSK ruling or local human verification.',
              'files':{p.name:hash_file(p) for p in folder.glob('*.jsonl')},
              'upstream_files':{p.name:hash_file(p) for p in source.iterdir()}}
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    return {'records':len(inputs),'categories':len(groups),'pilot':len(pilot)}


def sanitize_excerpt(text):
    lines=[];removed=0
    for line in (text or '').splitlines():
        # Exclude contact links and personal body/profile details unrelated to merchandise.
        if re.search(r'https?://|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{2,4}-\d{2,4}-\d{3,4}\b|住所|電話番号|連絡先|身長|体重',line,re.I):
            removed+=1;continue
        lines.append(line)
    return '\n'.join(lines).strip(),removed


def prepare_mercari(capture_path):
    rows=json.loads(capture_path.read_text())
    folder=DEST/'mercari';folder.mkdir(parents=True,exist_ok=True)
    inputs,labels,evidence=[],[],[]
    ids=set()
    for r in rows:
        match=re.fullmatch(r'https://jp\.mercari\.com/item/(m\d+)',r['source_url'])
        assert match,'Only public Mercari item URLs accepted'
        identifier='mercari-'+match.group(1)
        if identifier in ids:continue
        ids.add(identifier)
        description,removed=sanitize_excerpt(r['description_excerpt'])
        assert r['title'] and description
        flags=[]
        text=r['title']+'\n'+description
        for flag,pattern in {'bundle':r'セット|まとめ売り|まとめ', 'defective_or_unverified':r'ジャンク|動作未確認|故障',
                             'partial_item_or_packaging':r'片耳|のみ|空瓶|空き瓶|箱だけ|箱のみ',
                             'mixed_material_words':r'レザー|革|素材|木製|陶器|ポリエステル|綿',
                             'seller_terms':r'即購入|神経質|返品|コメント|ご遠慮|素人'}.items():
            if re.search(pattern,text):flags.append(flag)
        inputs.append({'id':identifier,'kind':'unstructured_marketplace_input',
                       'product':{'title':r['title'],'description':description,'category':r.get('category_text')},
                       'metadata':{'source_url':r['source_url'],'captured_at':r['captured_at'],
                                   'family':r['family'],'discovery_url':r['discovery_url'],
                                   'condition_text':r.get('condition_text'),'capture_method':r['capture_method'],
                                   'rendered_description_characters':r['description_original_characters'],
                                   'excerpt_limit_characters':800,'excerpt_truncated':r['description_truncated'],
                                   'contact_or_profile_lines_removed':removed,'lexical_flags_not_ground_truth':flags}})
        labels.append({'id':identifier,'reference_hs6':None,'reference_code10':None,'jurisdiction':None,
                       'label_status':'unlabelled','local_human_reviewed':False,'official_ruling_verified':False,
                       'judge_model':None,'judge_verdict':None,'judge_reference_hs6':None})
        evidence.append({'id':identifier,'source_url':r['source_url'],'captured_at':r['captured_at'],
                         'title_excerpt':r['title'],'description_excerpt':description,
                         'excerpt_sha256':hashlib.sha256(description.encode()).hexdigest(),
                         'scope':'Public product DOM excerpt only; seller profiles, comments, headers, sessions and images excluded.'})
    write_jsonl(folder/'inputs.jsonl',inputs);write_jsonl(folder/'labels.jsonl',labels);write_jsonl(folder/'evidence.jsonl',evidence)
    errors_path=capture_path.parent/'capture-errors.json'
    errors=json.loads(errors_path.read_text()) if errors_path.exists() else []
    manifest={'dataset':'mercari-unstructured-2026-10-06','prepared_at':datetime.now(timezone.utc).isoformat(),
              'records':len(inputs),'families':dict(Counter(r['metadata']['family'] for r in inputs)),
              'description_missing':sum(not r['product']['description'] for r in inputs),
              'excerpt_truncated':sum(r['metadata']['excerpt_truncated'] for r in inputs),
              'capture_errors':errors,'reference_labels':0,'judge_calls':0,
              'sampling':'Purposive keyword families; first up to 3 unique visible search-result items per family, plus initial audio seed. Not random or representative of marketplace volume.',
              'limitations':'Text-only public excerpts; images not analysed. Labels are empty; accuracy unavailable until independent adjudication.',
              'copyright':'Seller texts are source excerpts for local evaluation; no open redistribution license assumed.',
              'files':{p.name:hash_file(p) for p in folder.glob('*.jsonl')}}
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    return {'records':len(inputs),'families':manifest['families'],'reference_labels':0}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--mercari-capture',type=Path)
    args=parser.parse_args()
    print('HF',prepare_hf())
    if args.mercari_capture:print('Mercari',prepare_mercari(args.mercari_capture))

if __name__=='__main__':main()
