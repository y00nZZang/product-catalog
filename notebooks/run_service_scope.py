"""Original greedy Jev vs Luna on frozen, previously unevaluated service-scope sample."""
import argparse,hashlib,json,random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from customs_dataset import read_jsonl, load_labels
from jev_customs_experiment import Experiment,load_environment
from run_two_datasets import run_workflow,summarize
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'datasets/customs/2026-10-07/service-scope'
RUN=ROOT/'private/jev-experiments/service-scope-v1-2026-10-07'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true');args=parser.parse_args()
    if not args.live:raise SystemExit('Explicit --live required; reserved maximum combined USD 3.20.')
    selection=json.loads((DATA/'selection.json').read_text())
    assert hashlib.sha256((DATA/'scope-policy.json').read_bytes()).hexdigest()==selection['policy_sha256'],'Scope policy changed after selection'
    assert hashlib.sha256((DATA/'manual-review.jsonl').read_bytes()).hexdigest()==selection['manual_review_sha256'],'Review changed after selection'
    assert all(load_environment(ROOT).values()),'Both provider keys required'
    rows=read_jsonl(DATA/'fresh-inputs.jsonl')
    assert [r['id'] for r in rows]==selection['fresh_ids']
    assert not set(selection['fresh_ids'])&set(selection['observed_ids'])
    assert len(rows)==93
    reviews={r['id']:r for r in read_jsonl(DATA/'manual-review.jsonl')}
    assert all(reviews[r['id']]['decision']=='include' for r in rows)
    taxonomy=json.loads((ROOT/'src/customs/data/hs2022.json').read_text())
    folder=RUN;cases=folder/'cases';cases.mkdir(parents=True,exist_ok=True)
    experiments={p:Experiment(folder/p,live=True,max_calls=320,budget_usd=1.6,reserve_usd=.005,max_output_tokens=1000) for p in ('jev','llm')}
    method={'date':'2026-10-07','scope':'household/hobby service draft, not verified Sazo policy',
        'selection':selection,'strategy':'Original full HS2022 greedy 2/4/6, single path, no child-description enrichment or reranking',
        'models':{p:e.models[p] for p,e in experiments.items()},'reasoning_effort':'low','concurrency':2,
        'denominator':'All 93 selected cases; abstentions/errors count wrong',
        'input':'Identical title/attributes/category only; reference labels joined after all inference',
        'timing':'Sequential HTTP+parse+validation sum per item; providers concurrent and randomized within item',
        'prior_observation':'Fresh IDs never evaluated in original94 or improved94; authors may inspect input facts for scope, not outcomes',
        'excluded_methods':['improved beam Jev','Jev retrieval + LLM final selection']}
    (folder/'method.json').write_text(json.dumps(method,indent=2))
    outputs=[];rng=random.Random(42)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for i,row in enumerate(rows):
            order=['jev','llm'];rng.shuffle(order)
            futures=[pool.submit(run_workflow,experiments[p],p,row,taxonomy,cases) for p in order]
            for f in futures:
                r=f.result();outputs.append(r)
                print(json.dumps({'case':i+1,'total':len(rows),'id':row['id'],'provider':r['provider'],
                                  'status':r['status'],'hs6':r['hs6']},ensure_ascii=False),flush=True)
                if r.get('error','').startswith(('jev_http_401','jev_http_403','llm_http_401','llm_http_403','experiment_budget')):
                    raise RuntimeError('Auth/budget guard stopped run; inspect saved journal')
    labels=load_labels(ROOT/'datasets/customs/2026-10-06/hscodecomp')
    report=summarize(folder,rows,outputs,experiments,labels)
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':main()
