"""Live paired hierarchical benchmark, plus independent stronger-model reference.
Two providers run concurrently for the same item; each hierarchy stays sequential.
No automatic retries, gold-based candidate filtering or model-output-based sampling.
"""
import argparse
import json
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from customs_dataset import load_inputs,load_labels,model_product,score_hs6
from jev_customs_experiment import Experiment,load_environment,classify_hierarchy,token_totals

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'datasets/customs/2026-10-06'
RUN=ROOT/'private/jev-experiments/two-datasets-2026-10-06'


def run_workflow(experiment,provider,row,taxonomy,results_folder):
    path=results_folder/f'{row["id"]}-{provider}.json'
    if path.exists():
        saved=json.loads(path.read_text())
        if saved.get('error') != 'probability_sum':return saved
    product=model_product(row)  # No labels or metadata enter the request.
    started=time.perf_counter()
    result={'id':row['id'],'provider':provider,'status':'error','hs6':None,'path':[]}
    try:
        classification=classify_hierarchy(experiment,provider,product,taxonomy)
        steps=classification['steps']
        result.update({'status':classification['status'],'path':classification['path'],
                       'hs6':classification['path'][-1] if classification['status']=='candidate' else None,
                       'steps':steps,'calls':len(steps),'network_sum_ms':sum(s['latency_ms'] for s in steps),
                       **token_totals(steps)})
    except RuntimeError as error:
        result['error']=str(error)
    result['workflow_wall_ms']=(time.perf_counter()-started)*1000
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result


def summarize(folder,rows,outputs,experiments,labels=None):
    summary={}
    for provider,experiment in experiments.items():
        predictions=[r for r in outputs if r['provider']==provider]
        terminal=[r for r in experiment.records if r['event'] in ('success','failure')]
        events=list({r['key']:r for r in terminal}.values())
        costs=[]
        for r in events:
            usage=r.get('usage') or {}
            cost=r.get('estimated_cost_usd')
            if cost is None and usage.get('input_tokens') is not None and usage.get('output_tokens') is not None:
                it,ot=usage['input_tokens'],usage['output_tokens']
                details=usage.get('input_tokens_details') or {}
                ct,wt=details.get('cached_tokens',0),details.get('cache_write_tokens',0)
                cost=(it*.042)/1e6 if provider=='jev' else ((it-ct-wt)*experiment.prices['llm'][0]+ct*experiment.prices['llm'][0]*.1+wt*experiment.prices['llm'][0]*1.25+ot*experiment.prices['llm'][1])/1e6
            costs.append(cost)
        import numpy as np
        complete=[r for r in predictions if r['status']!='error']
        summary[provider]={'cases':len(predictions),'valid_workflows':len(complete),
                           'leaf_answers':sum(r['status']=='candidate' for r in predictions),
                           'abstentions':sum(r['status'] in ('needs_information','none_of_above') for r in predictions),
                           'workflow_errors':sum(r['status']=='error' for r in predictions),
                           'actual_api_calls':len(events),'api_validation_failures':sum(r['event']=='failure' for r in events),
                           'input_tokens':sum((r.get('usage') or {}).get('input_tokens',0) for r in events),
                           'output_tokens':sum((r.get('usage') or {}).get('output_tokens',0) for r in events),
                           'known_estimated_cost_usd':sum(c for c in costs if c is not None),
                           'unknown_cost_calls':sum(c is None for c in costs),
                           'workflow_p50_ms':float(np.median([r['network_sum_ms'] for r in complete])) if complete else None,
                           'workflow_p95_ms':float(np.quantile([r['network_sum_ms'] for r in complete],.95)) if complete else None,
                           'latency_denominator':len(complete),
                           'model':experiment.models[provider],
                           'saved_validation_recoveries':sum(bool(r.get('derived_from_saved_validation_failure')) for r in events)}
        if labels:
            selected={row['id']:labels[row['id']] for row in rows}
            summary[provider]['quality']=score_hs6(predictions,selected)
            summary[provider]['quality']['chapter_path_accuracy_all']=sum(bool(r['path']) and r['path'][0]==selected[r['id']]['reference_hs6'][:2] for r in predictions)/len(rows)
            summary[provider]['quality']['heading_path_accuracy_all']=sum(len(r['path'])>1 and r['path'][1]==selected[r['id']]['reference_hs6'][:4] for r in predictions)/len(rows)
    (folder/'summary.json').write_text(json.dumps(summary,indent=2))
    (folder/'results.json').write_text(json.dumps(outputs,ensure_ascii=False,indent=2))
    return summary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('dataset',choices=['hscodecomp','mercari','judge'])
    parser.add_argument('--limit',type=int)
    parser.add_argument('--full',action='store_true')
    args=parser.parse_args()
    assert all(load_environment(ROOT).values()),'Both provider keys required'
    taxonomy=json.loads((ROOT/'src/customs/data/hs2022.json').read_text())
    source='mercari' if args.dataset=='judge' else args.dataset
    rows=load_inputs(BASE/source,pilot=(source=='hscodecomp' and not args.full))
    rows=sorted(rows,key=lambda r:r['id'])
    if args.limit:rows=rows[:args.limit]
    folder=RUN/args.dataset;results_folder=folder/'cases';results_folder.mkdir(parents=True,exist_ok=True)
    providers=['llm'] if args.dataset=='judge' else ['jev','llm']
    experiments={}
    for provider in providers:
        judge=args.dataset=='judge'
        cap=2000 if args.full else (300 if source=='hscodecomp' else 100)
        experiments[provider]=Experiment(folder/provider,live=True,llm_model='gpt-6-sol' if judge else 'gpt-6-luna',
            prices={'jev':(.042,0),'llm':(2,10) if judge else (.1,.5)},reasoning_effort='low',
            max_calls=cap,budget_usd=5 if judge else (8 if args.full else 1.2),
            reserve_usd=.05 if judge else .004,max_output_tokens=1000)
    outputs=[];rng=random.Random(42)
    print(json.dumps({'dataset':args.dataset,'cases':len(rows),'providers':providers,'candidate_strategy':'full HS2022 greedy 2/4/6; no gold','concurrency':len(providers)}),flush=True)
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        for i,row in enumerate(rows):
            order=providers.copy();rng.shuffle(order)
            futures=[pool.submit(run_workflow,experiments[p],p,row,taxonomy,results_folder) for p in order]
            for future in futures:
                result=future.result();outputs.append(result)
                print(json.dumps({'done_case':i+1,'of':len(rows),'id':row['id'],'provider':result['provider'],
                                  'status':result['status'],'hs6':result['hs6']},ensure_ascii=False),flush=True)
                if result.get('error','').startswith(('jev_http_401','jev_http_403','llm_http_401','llm_http_403')):
                    raise RuntimeError('Authentication error; stopped')
    labels=load_labels(BASE/source) if source=='hscodecomp' else None
    summary=summarize(folder,rows,outputs,experiments,labels)
    (folder/'method.json').write_text(json.dumps({'dataset':source,'selected_ids':[r['id'] for r in rows],
        'pilot':source=='hscodecomp' and not args.full,'concurrency':len(providers),'reasoning_effort':'low',
        'judge_blinding':'Independent classification; no evaluated predictions or provider names supplied' if args.dataset=='judge' else None},indent=2))
    print(json.dumps(summary,indent=2),flush=True)

if __name__=='__main__':main()
