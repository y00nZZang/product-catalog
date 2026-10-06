"""Explicit bounded live benchmark; writes private JSON/CSV. No retries."""
import argparse
import json
from pathlib import Path
import pandas as pd
from jev_customs_experiment import Experiment, load_environment, paired_benchmark, CONTRACT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--run-id', default='token-time-2026-10-06')
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--samples-path', default='jev_customs_samples.json')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--max-calls', type=int, default=24)
    parser.add_argument('--budget-usd', type=float, default=.50)
    parser.add_argument('--reserve-usd', type=float, default=.02)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if not args.run_id or Path(args.run_id).name != args.run_id or args.run_id in ('.', '..'):
        parser.error('run-id must be a directory name')
    if not 1 <= args.repeats <= 3:
        parser.error('repeats must be 1..3 for the initial bounded run')
    presence = load_environment(root)
    if args.live and not all(presence.values()):
        parser.error('Missing key(s): ' + ', '.join(k for k,v in presence.items() if not v))
    folder = root/'private/jev-experiments'/args.run_id
    taxonomy = json.loads((root/'src/customs/data/hs2022.json').read_text())
    sample_path = Path(args.samples_path)
    if not sample_path.is_absolute():
        sample_path = root/'notebooks'/sample_path
    dataset = json.loads(sample_path.read_text())
    samples = dataset['samples']
    if args.limit is not None:
        if args.limit < 1:
            parser.error('limit must be positive')
        samples = samples[:args.limit]
    planned = len(samples)*args.repeats*2
    if planned > args.max_calls or planned*args.reserve_usd > args.budget_usd + 1e-9:
        parser.error('Planned calls exceed configured reservation budget/call cap')
    experiment = Experiment(folder, live=args.live, max_calls=args.max_calls, budget_usd=args.budget_usd, reserve_usd=args.reserve_usd)
    print(json.dumps({'live': args.live, 'samples':len(samples), 'repeats':args.repeats,
                      'max_calls':args.max_calls, 'reserved_budget_usd':args.budget_usd}), flush=True)
    rows = []
    # Trial-by-trial outputs give progress without logging credentials or request headers.
    # Pass repeats once so all trials retain distinct cache keys.
    def progress(row):
        print(json.dumps({k:row.get(k) for k in ['sample','provider','trial','status','cache_hit','latency_ms']}, ensure_ascii=False),flush=True)
    rows = paired_benchmark(experiment,samples,taxonomy,repeats=args.repeats,mode='fixed',seed=42,progress=progress)
    flat = pd.DataFrame([{k:v for k,v in r.items() if k!='steps'} for r in rows])
    payload={'contract':CONTRACT,'taxonomy':taxonomy['version'],'mode':'fixed','repeats':args.repeats,
             'models':experiment.models,'reasoning_effort':experiment.reasoning_effort,
             'price_checked':'2026-10-06','dataset':str(sample_path.relative_to(root)), 'dataset_notes':dataset.get('notes'),'rows':rows}
    (folder/'results-fixed.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    flat.to_csv(folder/'measurements.csv',index=False)
    if args.live:
        success=flat[flat.status.ne('error') & flat.status.ne('not_run')]
        summary=[]
        for provider in ['jev','llm']:
            group=success[success.provider.eq(provider)]
            fresh=group[group.cache_hit.eq(False)] if not group.empty else group
            summary.append({'provider':provider,'completed':len(group),
                            'errors':int(((flat.provider==provider)&(flat.status=='error')).sum()),
                            'fresh_observations':len(fresh),
                            'input_tokens':None if group.empty else int(group.input_tokens.sum()),
                            'output_tokens':None if group.empty else int(group.output_tokens.sum()),
                            'estimated_cost_usd':None if group.empty else float(group.estimated_cost_usd.sum()),
                            'p50_ms':None if fresh.empty else float(fresh.latency_ms.median()),
                            'p95_ms':None if fresh.empty else float(fresh.latency_ms.quantile(.95))})
        (folder/'summary.json').write_text(json.dumps(summary,indent=2))
        print(json.dumps(summary,indent=2),flush=True)
        print('Saved:',folder)
    else:
        print('Dry run; zero provider calls. Keys present:',presence)

if __name__=='__main__':
    main()
