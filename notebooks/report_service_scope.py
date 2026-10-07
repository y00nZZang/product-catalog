"""Separate historical full/scope results and fresh scope validation; replay-only notebook."""
import hashlib,json,math
from pathlib import Path
import nbformat as nb
import numpy as np
from customs_dataset import load_labels,read_jsonl,score_hs6
from run_service_scope import ROOT,DATA,RUN


def wilson(k,n):
    z=1.959963984540054;p=k/n;d=1+z*z/n
    mid=(p+z*z/(2*n))/d;half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [mid-half,mid+half]

def summarize_rows(rows,labels):
    q=score_hs6(rows,labels)
    steps=[s for r in rows for s in r.get('steps',[])]
    complete=[r for r in rows if r['status']!='error']
    return {'cases':len(rows),'quality':q,'accuracy_95pct_wilson':wilson(q['correct_hs6'],len(labels)),
        'workflow_p50_ms':float(np.median([r['network_sum_ms'] for r in complete])),
        'workflow_p95_ms':float(np.quantile([r['network_sum_ms'] for r in complete],.95)),
        'calls':len(steps),'input_tokens':sum((s.get('usage') or {}).get('input_tokens',0) for s in steps),
        'output_tokens':sum((s.get('usage') or {}).get('output_tokens',0) for s in steps),
        'estimated_cost_usd':sum(s.get('estimated_cost_usd') or 0 for s in steps),
        'unknown_cost_calls':sum(s.get('estimated_cost_usd') is None for s in steps),
        'errors':sum(r['status']=='error' for r in rows)}


def main():
    prior=ROOT/'private/jev-experiments/two-datasets-2026-10-06/hscodecomp'
    old=json.loads((prior/'results.json').read_text());fresh=json.loads((RUN/'results.json').read_text())
    selection=json.loads((DATA/'selection.json').read_text());observed_ids=set(selection['observed_ids'])
    labels=load_labels(ROOT/'datasets/customs/2026-10-06/hscodecomp')
    categories={r['id']:r['metadata']['top_category'] for r in read_jsonl(DATA/'fresh-inputs.jsonl')+read_jsonl(DATA/'observed-inputs.jsonl')}
    groups={};details=[]
    for group,raw in [('historical_full94',old),('historical_scope78',[r for r in old if r['id'] in observed_ids]),('fresh_scope93',fresh)]:
        groups[group]={}
        for provider in ('jev','llm'):
            rows=[r for r in raw if r['provider']==provider];refs={r['id']:labels[r['id']] for r in rows}
            groups[group][provider]=summarize_rows(rows,refs)
            if group=='fresh_scope93':
                live=json.loads((RUN/'summary.json').read_text())[provider]
                groups[group][provider].update(calls=live['actual_api_calls'],input_tokens=live['input_tokens'],
                    output_tokens=live['output_tokens'],estimated_cost_usd=live['known_estimated_cost_usd'],
                    unknown_cost_calls=live['unknown_cost_calls'],latency_denominator=live['latency_denominator'])
            for r in rows:
                entry={k:r.get(k) for k in ('id','provider','status','hs6','path','error','calls','network_sum_ms','input_tokens','output_tokens')}
                entry.update(top_category=categories.get(r['id']),group=group,reference_hs6=refs[r['id']]['reference_hs6'],correct=r['hs6']==refs[r['id']]['reference_hs6'])
                details.append(entry)
    j={r['id']:r for r in fresh if r['provider']=='jev'};l={r['id']:r for r in fresh if r['provider']=='llm'}
    assert set(j)==set(l)==set(selection['fresh_ids'])
    ids=sorted(j);ja=np.array([j[k]['hs6']==labels[k]['reference_hs6'] for k in ids],dtype=int)
    la=np.array([l[k]['hs6']==labels[k]['reference_hs6'] for k in ids],dtype=int)
    rng=np.random.default_rng(42);diff=ja-la
    distribution=diff[rng.integers(0,len(ids),size=(20000,len(ids)))].mean(axis=1)
    paired={'accuracy_difference_jev_minus_llm':float(diff.mean()),
            'difference_95pct_paired_bootstrap':[float(x) for x in np.quantile(distribution,[.025,.975])],
            'jev_only_correct':int(((ja==1)&(la==0)).sum()),'llm_only_correct':int(((ja==0)&(la==1)).sum()),
            'both_correct':int(((ja==1)&(la==1)).sum()),'both_incorrect':int(((ja==0)&(la==0)).sum()),
            'uncertainty':'Paired 20000-bootstrap, seed42; descriptive for this category-balanced sample, not service-population uncertainty or proof of equivalence'}
    report={'date':'2026-10-07','groups':groups,'selection':selection,'paired_fresh':paired,
        'methods':{'fresh':json.loads((RUN/'method.json').read_text()),'policy':json.loads((DATA/'scope-policy.json').read_text())},
        'results':details,'source':{'dataset':'https://huggingface.co/datasets/ATH-MaaS/HSCodeComp','revision':'ce9119795acef4ca537b2175e10a3feb7a0ecae9'},
        'actual_new_run':{'calls':sum(groups['fresh_scope93'][p]['calls'] for p in ('jev','llm')),
                          'estimated_cost_usd':sum(groups['fresh_scope93'][p]['estimated_cost_usd'] for p in ('jev','llm'))}}
    # Actual ledger accounting includes any failed requests outside complete workflow steps.
    ledger=[]
    for p in ('jev','llm'):
        records=read_jsonl(RUN/p/'requests.jsonl')
        ledger.extend({r['key']:r for r in records if r['event'] in ('success','failure')}.values())
    report['actual_new_run'].update(ledger_calls=len(ledger),ledger_known_cost=sum(r.get('estimated_cost_usd') or 0 for r in ledger),
        ledger_unknown_cost_calls=sum(r.get('estimated_cost_usd') is None for r in ledger),validation_failures=sum(r['event']=='failure' for r in ledger))
    out=Path(__file__).parent;result=out/'service-scope-results-2026-10-07.json';result.write_text(json.dumps(report,indent=2))
    cells=[nb.v4.new_markdown_cell('''# Household / hobby service-scope benchmark

## tl;dr

Results below compare **original greedy Jev and original greedy GPT-6 Luna only**. Expanded-path Jev and hybrid retrieval are abandoned and excluded. Scope selection is a product-use decision, not a filter for correct predictions. Historical full94, historical in-scope78, and fresh93 are separate groups; do not combine them as one blind test.

## Context & Methods

Scope policy was recorded before fresh inference. Household goods, kitchen, clothing/accessories, toys/games, hobby/sports, personal electronics/parts and DIY tools are candidates. Automotive, generic electronic/industrial supplies, professional machinery/stage/medical equipment are excluded. This is an unverified service-policy draft, not a verified Sazo rule or importability decision.

The automated screen yields 582 candidate products. Manual review of initial 96 fresh plus 80 historical cases excludes 5 factually out-of-scope products; fresh93 and historical78 remain. Rejected sampled products are **not replaced**. Remaining rule-eligible pool 577 is not a fully manually reviewed service catalogue.

### Key assumptions

Personal use is inferred from product facts, not verified buyer intent. Mixed materials, sets, missing or conflicting details remain. Fresh IDs have not appeared in earlier inference; product facts are inspected for scope review before inference, but labels and predictions are not used for selection. Sampling uses a fixed hash and category-balanced round-robin, so sample frequencies do not represent actual marketplace traffic.

Both providers receive identical title/attributes/category and full local HS2022 options at HS2 → HS4 → HS6. Single top-1 branch, no added research, no image evidence, no candidate reranking. GPT-6 Luna reasoning low. Providers run concurrently per product, ordered by fixed random seed. Time includes sequential HTTP, parsing and validation; excludes collection, queues and total application latency. Usage-based USD estimates are not invoices; more abstentions can lower cost/time. Accuracy denominator includes abstentions and errors.

Source: [HSCodeComp](https://huggingface.co/datasets/ATH-MaaS/HSCodeComp). Expert US code reference truncated to HS6; not a verified Korean customs ruling. The original 94-case experiment remains intact.

## Data'''),nb.v4.new_code_cell('''import json
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt
p=Path('service-scope-results-2026-10-07.json')
if not p.exists():p=Path('product-catalog/notebooks')/p
report=json.loads(p.read_text())
results=pd.DataFrame(report['results'])
selection=report['selection']
print({k:selection[k] for k in ['all_source_cases','eligible_cases','excluded_cases','fresh_pool']})
print('Initial fresh sample:',len(selection['initial_fresh_ids']),'final fresh sample:',len(selection['fresh_ids']))
print('Historical in-scope:',len(selection['observed_ids']))
display(pd.DataFrame(selection['fresh_categories'].items(),columns=['category','final_category_count']))
print('Actual new run:',report['actual_new_run'])'''),nb.v4.new_markdown_cell('''## Results

Historical subgroup figures are descriptive reuse of previously observed outputs. Primary new comparison is the fresh93 group. Answered accuracy and coverage appear beside full-denominator exact HS6 accuracy.'''),nb.v4.new_code_cell('''rows=[]
for group,values in report['groups'].items():
    for provider,s in values.items():
        q=s['quality']
        rows.append({'group':group,'provider':provider,'cases':s['cases'],'correct':q['correct_hs6'],
          'accuracy':q['accuracy_all'],'answered_accuracy':q['accuracy_answered'],'answer_rate':q['coverage'],
          'median_s':s['workflow_p50_ms']/1000,'p95_s':s['workflow_p95_ms']/1000,
          'calls':s['calls'],'input_tokens':s['input_tokens'],'output_tokens':s['output_tokens'],
          'cost_USD':s['estimated_cost_usd'],'errors':s['errors']})
comparison=pd.DataFrame(rows)
display(comparison.round(4))
print('Fresh paired comparison:',report['paired_fresh'])'''),nb.v4.new_code_cell('''plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False})
fig,grid=plt.subplots(2,2,figsize=(12,8));axes=grid.ravel()
comparison['cost_per_case_USD']=comparison.cost_USD/comparison.cases
groups=['historical_full94','historical_scope78','fresh_scope93']
labels=['Original 94','Observed scope 78','Fresh scope 93']
colors={'jev':'#186A85','llm':'#BE662B'}
for p,offset in [('jev',-.18),('llm',.18)]:
    rs=comparison[comparison.provider.eq(p)].set_index('group').reindex(groups)
    for ax,col,title in zip(axes,['accuracy','answer_rate','median_s','cost_per_case_USD'],['HS6 exact accuracy (all cases)','Answer rate','Median request-time sum (seconds)','Estimated cost per case (USD)']):
        bars=ax.bar([i+offset for i in range(3)],rs[col],width=.35,label=p,color=colors[p])
        for bar,val in zip(bars,rs[col]):ax.annotate(f'{val:.1%}' if col in ('accuracy','answer_rate') else (f'{val:.3f}' if col=='median_s' else f'{val:.6f}'),(bar.get_x()+bar.get_width()/2,val),ha='center',va='bottom',fontsize=9)
        ax.set_title(title);ax.set_xticks(range(3),labels);ax.set_ylim(bottom=0)
        if col in ('accuracy','answer_rate'):ax.set_ylim(0,1.05)
axes[2].set_ylim(0,comparison.median_s.max()*1.18)
axes[3].set_ylim(0,comparison.cost_per_case_USD.max()*1.18)
handles,names=axes[0].get_legend_handles_labels()
fig.legend(handles,names,loc='upper center',bbox_to_anchor=(.5,.95),ncol=2)
fig.suptitle('Scope-filtered historical results and separate fresh validation')
fig.tight_layout(rect=[0,0,1,.9]);fig.savefig('service-scope-comparison.png',dpi=150,bbox_inches='tight');plt.show()'''),nb.v4.new_code_cell('''fresh=results[results.group.eq('fresh_scope93')].copy()
# Per-category diagnostics, never used to remove difficult categories after inference.
display(fresh.groupby(['top_category','provider']).correct.agg(cases='size',correct='sum').reset_index())
# Exact-case disagreements, including abstentions; full outputs remain in JSON.
display(fresh[['id','provider','reference_hs6','hs6','status','correct']].head(24))
print('Sample-specific accuracy intervals:',{p:report['groups']['fresh_scope93'][p]['accuracy_95pct_wilson'] for p in ['jev','llm']})'''),nb.v4.new_markdown_cell('''## Takeaways

Read the executed fresh results as this sample's measured comparison, not proof of equivalent accuracy or readiness for automatic final customs classification. A narrowed domain can change difficulty but is not itself a model improvement. The observed historical subset was inspected previously and cannot serve as blind validation. Keep full94 results alongside service-scope results when revising the report or slides.

This notebook makes no API calls. `prepare_service_scope.py` reproduces input-only selection and its audit; `run_service_scope.py --live` explicitly runs the fixed original greedy comparison; `report_service_scope.py` regenerates this notebook from local run records. Labels and provider journals are never included in requests. Difficult in-scope cases remain in the denominator.''')]
    js=groups['fresh_scope93']['jev'];ls=groups['fresh_scope93']['llm']
    observed=f"Fresh93: Jev {js['quality']['correct_hs6']}/93 ({js['quality']['accuracy_all']:.1%}); Luna {ls['quality']['correct_hs6']}/93 ({ls['quality']['accuracy_all']:.1%}). Median request-time sums: {js['workflow_p50_ms']/1000:.3f}s / {ls['workflow_p50_ms']/1000:.3f}s. Usage-based cost estimates: ${js['estimated_cost_usd']:.6f} / ${ls['estimated_cost_usd']:.6f}."
    cells[0].source=cells[0].source.replace('Results below compare',observed+'\n\nResults below compare')
    cells[-1].source += '\n\n'+observed+'\n\nAccuracy difference (Jev minus Luna), paired sample-specific 95% bootstrap interval: '+str(paired['difference_95pct_paired_bootstrap'])+'. No equivalence or non-inferiority margin was pre-specified, so do not claim equivalent accuracy from this pilot alone. Jev answered 80 cases, Luna 60; answered accuracy was 51.3% versus 68.3%. Equal correct counts do not imply equal false-answer risk. Historical in-scope78 also remained worse for Jev (33.3%) than Luna (42.3%), so scope restriction alone does not establish general quality preservation.'
    md=['# 서비스 범위 한정 Jev / LLM 재평가 — 2026-10-07','',observed,'','| 집단 | 방식 | 정답/전체 | 정확도 | 답변률 | 중앙 시간(s) | p95(s) | 입력 토큰 | 출력 토큰 | 추정 비용(USD) |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for group,values in groups.items():
        for provider,v in values.items():
            q=v['quality'];md.append(f"| {group} | {provider} | {q['correct_hs6']}/{v['cases']} | {q['accuracy_all']:.1%} | {q['coverage']:.1%} | {v['workflow_p50_ms']/1000:.3f} | {v['workflow_p95_ms']/1000:.3f} | {v['input_tokens']:,} | {v['output_tokens']:,} | {v['estimated_cost_usd']:.6f} |")
    md += ['', '선별 기준: 서비스 범위 초안을 먼저 고정하고 상품명/속성 검토 후 적용. 원본 632개 중 규칙+표본 검토 기준 후보 577개(전체 수동 검토 아님); 최초 새 표본96개에서 범위 밖3개를 제외하고 대체하지 않아93개. 이전94개 중 범위 안78개는 별도 과거 결과 집계. 새로운93개는 이전94개와 중복하지 않음.', '', '사용자가 포기한 복수 경로 Jev 및 Jev 탐색+LLM 선택은 후속 비교에서 제외. 기존 단일 경로 HS2/HS4/HS6만 같은 조건으로 실행. 혼합 재질, 세트, 부품, 불충분/모순된 속성 등 서비스 범위 안의 어려운 사례 유지.', '', '범위는 사조의 검증된 정책이 아닌 연구 초안. HSCodeComp 전문가 US 참조 코드의 HS6 일치율이며 한국 공식 품목분류 정확도가 아님. 카테고리 균형 표집으로 실제 서비스 상품 비중을 대표하지 않음. 이전 집계와 새로운 검증 결과를 합쳐 블라인드 평가로 제시하지 말 것.', '', '답변한 사례의 정확도: Jev 41/80 = 51.3%, Luna 41/60 = 68.3%. 잘못 답한 사례는 각각39개/19개로 다르므로 전체 정답 수가 같다는 이유로 동일한 오답 위험을 주장하지 않음. 과거 서비스 한정78개에서는 Jev 33.3%, Luna42.3%였으므로 범위 제한이 일반적으로 품질을 보존한다는 근거가 아님.', '', '새 표본 Jev−LLM 정확도 차이: '+format(paired['accuracy_difference_jev_minus_llm'],'.1%')+'; 표본 내부 paired bootstrap 95% 구간: '+str(paired['difference_95pct_paired_bootstrap'])+'. 사전 동등성/비열등성 기준이 없어 동등한 정확도를 입증하지 않음.', '', '실제 새 API 실행: '+str(report['actual_new_run'])+'. 비용은 usage 기반 추정, 청구서 확인값 아님. 과거 결과 재집계에는 새 API 비용 없음.', '', '[HSCodeComp 데이터셋](https://huggingface.co/datasets/ATH-MaaS/HSCodeComp) · [재생용 노트북](../notebooks/service-scope-results-2026-10-07.ipynb)', '', '보고서/슬라이드 후속 개정에는 세 집단과 정답/전체 분모, 답변률을 명시하고 시간·비용을 정확도와 함께 표시할 것. 전체94개와 포기한 개선 실험의 기록을 삭제하거나 이번 결과로 덮어쓰지 않음.']
    (ROOT/'docs/service-scope-jev-experiment-2026-10-07.md').write_text('\n'.join(md)+'\n')
    b=nb.v4.new_notebook(cells=cells,metadata={'kernelspec':{'display_name':'Product Catalog Experiments (.venv)','language':'python','name':'product-catalog-experiments'}})
    nb.validate(b);nb.write(b,out/'service-scope-results-2026-10-07.ipynb')

if __name__=='__main__':main()
