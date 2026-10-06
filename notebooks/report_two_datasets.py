"""Summarize finished two-dataset runs and build replay-only notebook."""
import json
from pathlib import Path
import nbformat as nb
from customs_dataset import load_inputs,load_labels

ROOT=Path(__file__).resolve().parents[1]
RUN=ROOT/'private/jev-experiments/two-datasets-2026-10-06'
BASE=ROOT/'datasets/customs/2026-10-06'


def sanitized(predictions):
    fields=['id','provider','status','hs6','path','error','calls','input_tokens','output_tokens','cached_input_tokens',
            'reasoning_output_tokens','network_sum_ms','workflow_wall_ms']
    return [{k:r.get(k) for k in fields} for r in predictions]


def main():
    summaries={name:json.loads((RUN/name/'summary.json').read_text()) for name in ['hscodecomp','mercari','judge']}
    results={name:sanitized(json.loads((RUN/name/'results.json').read_text())) for name in summaries}
    methods={name:json.loads((RUN/name/'method.json').read_text()) for name in summaries}
    assert len(results['hscodecomp'])==188 and len(results['mercari'])==60 and len(results['judge'])==30
    hf_labels=load_labels(BASE/'hscodecomp')
    hf_inputs={r['id']:r for r in load_inputs(BASE/'hscodecomp',pilot=True)}
    for r in results['hscodecomp']:
        r['reference_hs6']=hf_labels[r['id']]['reference_hs6']
        r['top_category']=hf_inputs[r['id']]['metadata']['top_category']
        r['correct']=r['hs6']==r['reference_hs6']
    judges={r['id']:r for r in results['judge']}
    judge_proxy={}
    for provider in ['jev','llm']:
        predictions=[r for r in results['mercari'] if r['provider']==provider]
        eligible=correct=abstentions=abstain_agree=valid_judge=decisions_agree=0
        for r in predictions:
            judge=judges[r['id']]
            r['judge_status']=judge['status'];r['judge_hs6']=judge['hs6']
            if judge['status']=='error':
                r['judge_agreement']=None;continue
            valid_judge+=1
            match=(r['hs6']==judge['hs6']) if judge['status']=='candidate' else r['status']==judge['status']
            r['judge_agreement']=match;decisions_agree+=bool(match)
            if judge['status']=='candidate':eligible+=1;correct+=bool(match)
            else:abstentions+=1;abstain_agree+=bool(match)
        judge_proxy[provider]={'judge_valid_cases':valid_judge,'judge_decision_agreement':decisions_agree,
             'judge_decision_agreement_rate':decisions_agree/valid_judge if valid_judge else None,
             'judge_hs6_reference_cases':eligible,'hs6_matching_judge':correct,
             'hs6_judge_agreement_rate':correct/eligible if eligible else None,
             'judge_abstention_cases':abstentions,'abstention_agreements':abstain_agree,
             'label_basis':'Independent GPT-6 Sol low reference, not ground truth or official classification'}
    report={'date':'2026-10-06','kind':'live_hierarchical_benchmark_with_judge_proxy','summary':summaries,
            'methods':methods,'results':results,'judge_proxy':judge_proxy,
            'scope':{'hscodecomp':'94 category-stratified pilot of 632; not full benchmark','mercari':'all 30 purpose-sampled public listing excerpts',
                     'candidate_strategy':'full HS2022 greedy top-1 2/4/6, no retrieved examples/web search',
                     'latency':'sum of sequential actual HTTP+parse+validation times per workflow; queue/idle/replay time excluded',
                     'concurrency':'two providers concurrently per item, sequential hierarchy stages; judge separately',
                     'validation_policy':'probability sum 1±0.01 inclusive with 1e-9 floating point tolerance; previous captured .99 revalidated locally'}}
    base=ROOT/'notebooks'
    (base/'two-datasets-results-2026-10-06.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    n=nb.v4.new_notebook()
    n.cells=[nb.v4.new_markdown_cell('''# 두 데이터셋 실호출 결과

**HF: 632개 중 32개 대분류에서 층화 선택한 94개 / Mercari: 실제 판매글 30개 전체.** 저장된 결과만 분석하며 이 노트북 재실행은 유료 API를 호출하지 않습니다.

- Jev 1.13과 GPT-6 Luna low가 동일한 전체 HS2022 taxonomy를 이용해 greedy 2→4→6 경로를 선택합니다. 정답으로 후보를 줄이지 않습니다. 웹 검색/선례 조회/HS 해설서/이미지 분석/복수 경로 탐색은 하지 않았습니다.
- 두 공급사는 같은 상품에서 동시 실행하고 각 공급사의 단계는 순차 실행합니다. 시간은 각 단계의 실제 HTTP+파싱+검증 시간 합입니다. 큐 대기, 로컬 캐시 재표시, 보고서 생성 시간은 제외합니다.
- HF 정확도는 94개 전체를 분모로 합니다. 보류·실패·누락은 정답으로 세지 않습니다. 전문가 벤치마크 라벨과의 일치이며 한국 HSK 확정이나 법적 분류 검증이 아닙니다.
- Mercari에는 공식 정답이 없습니다. GPT-6 Sol low가 모델 예측·공급사 이름을 보지 않고 독립적으로 같은 계층 분류를 수행했습니다. 그 결과와의 **심사자 일치율**을 계산합니다. OpenAI 모델군의 공유 편향이 있을 수 있으며 정답 정확도로 표시하지 않습니다.
- 비용은 API usage와 공급사 단가를 이용한 추정입니다. 실패 응답도 usage가 있으면 포함하고 심사자 비용을 분리합니다. 청구서 금액은 확인하지 않았습니다.
- 초기 확률 합계 .99가 float 오차로 탈락한 검증 코드 문제를 수정했습니다. 허용범위 1±.01은 유지하며 1e-9 계산 오차만 허용합니다. 저장된 응답을 로컬 재검증했고 같은 요청을 재전송하거나 비용을 중복 집계하지 않았습니다.'''),nb.v4.new_code_cell('''from pathlib import Path
import json
import pandas as pd
from IPython.display import display,Markdown
ROOT=next(p for p in [Path.cwd(),*Path.cwd().parents] if (p/'src/customs/data/hs2022.json').exists())
report=json.loads((ROOT/'notebooks/two-datasets-results-2026-10-06.json').read_text())
performance=[]
for dataset,providers in report['summary'].items():
    for provider,s in providers.items():
        performance.append({'dataset':dataset,'provider':provider,'model':s['model'],'cases':s['cases'],
            'leaf_answers':s['leaf_answers'],'abstentions':s['abstentions'],'errors':s['workflow_errors'],
            'actual_api_calls':s['actual_api_calls'],'input_tokens':s['input_tokens'],'output_tokens':s['output_tokens'],
            'estimated_cost_usd':s['known_estimated_cost_usd'],'p50_seconds':s['workflow_p50_ms']/1000 if s['workflow_p50_ms'] is not None else None,
            'p95_seconds':s['workflow_p95_ms']/1000 if s['workflow_p95_ms'] is not None else None,
            'latency_n':s['latency_denominator'],'saved_validation_recoveries':s['saved_validation_recoveries']})
performance=pd.DataFrame(performance)
display(performance.round({'estimated_cost_usd':6,'p50_seconds':3,'p95_seconds':3}))
print('Total usage-based cost estimate USD:',performance.estimated_cost_usd.sum())'''),nb.v4.new_markdown_cell('''## HF: 전문가 참조 라벨 기준 정확도

전체 94개 정확도와 답변한 사례의 정확도/coverage를 함께 봅니다. 정답과 일치한 최종 HS6 수가 주 지표입니다. 32개 분류에서 최대 3개씩 선택했으므로 원본 데이터의 품목 비중과 다릅니다. 단계별 경로 정확도는 부분 경로도 포함해 계산하며 HS6 결과에서 단순 절단한 지표와 구분합니다.'''),nb.v4.new_code_cell('''quality=[]
for provider,s in report['summary']['hscodecomp'].items():
    q=s['quality']
    quality.append({'provider':provider,'reference_cases':q['reference_cases'],'correct_hs6':q['correct_hs6'],
        'accuracy_all':q['accuracy_all'],'accuracy_answered':q['accuracy_answered'],'coverage':q['coverage'],
        'chapter_path_accuracy_all':q['chapter_path_accuracy_all'],'heading_path_accuracy_all':q['heading_path_accuracy_all']})
quality=pd.DataFrame(quality)
display(quality.style.format({c:'{:.1%}' for c in ['accuracy_all','accuracy_answered','coverage','chapter_path_accuracy_all','heading_path_accuracy_all']}))
hf=pd.DataFrame(report['results']['hscodecomp'])
display(hf.groupby(['top_category','provider']).correct.agg(cases='size',correct='sum').reset_index())
# Preserve failed/abstained rows; bounded preview, full rows remain in JSON.
display(hf[~hf.correct][['id','top_category','provider','reference_hs6','hs6','status','error']].head(30))'''),nb.v4.new_markdown_cell('''## Mercari: 독립 상위 모델 심사자와의 일치

HS6 일치율의 분모는 심사자가 HS6를 선택한 사례입니다. 심사자가 정보 부족/잘못된 후보 경로로 보류한 경우는 따로 표시합니다. 전체 판단 일치율에는 HS6와 보류 상태 일치를 포함합니다. 심사자 호출 실패는 분모에서 제외하고 별도로 보고합니다.'''),nb.v4.new_code_cell('''proxy=pd.DataFrame([{'provider':p,**v} for p,v in report['judge_proxy'].items()])
display(proxy.drop(columns=['label_basis']))
mercari=pd.DataFrame(report['results']['mercari'])
display(mercari[['id','provider','hs6','status','judge_hs6','judge_status','judge_agreement']])
print('Judge model:',report['summary']['judge']['llm']['model'])
print('Judge errors:',report['summary']['judge']['llm']['workflow_errors'])
print('Judge cost estimate USD:',report['summary']['judge']['llm']['known_estimated_cost_usd'])'''),nb.v4.new_markdown_cell('''## 비용·시간 비교

단계 수와 조기 보류가 비용/시간에 영향을 줍니다. 더 싼 결과가 같은 품질이나 같은 답변률을 뜻하지 않습니다. 심사자 비용은 아래 비교 그래프에서 제외하고 위 표에 별도 표시합니다.'''),nb.v4.new_code_cell('''import matplotlib.pyplot as plt
plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(1,2,figsize=(11,4))
x=[0,1];names=['HF pilot (94)','Mercari (30)'];colors={'jev':'#186A85','llm':'#BE662B'}
for provider,offset in [('jev',-.18),('llm',.18)]:
    rows=performance[performance.provider.eq(provider)&performance.dataset.isin(['hscodecomp','mercari'])].set_index('dataset').reindex(['hscodecomp','mercari'])
    axes[0].bar([i+offset for i in x],rows.p50_seconds,width=.35,color=colors[provider],label=provider)
    axes[1].bar([i+offset for i in x],rows.estimated_cost_usd/rows.cases,width=.35,color=colors[provider],label=provider)
axes[0].set_ylabel('Median pipeline time (seconds)')
axes[1].set_ylabel('Estimated cost per case (USD)')
for ax in axes:
    ax.set_xticks(x,names);ax.set_ylim(bottom=0);ax.legend()
fig.tight_layout()
fig.savefig(ROOT/'private/jev-experiments/two-datasets-2026-10-06/cost-time.png',dpi=170)
plt.show()
fig,ax=plt.subplots(figsize=(6,3.5))
ax.bar(quality.provider,quality.accuracy_all*100,color=[colors[p] for p in quality.provider])
ax.set_ylim(0,100);ax.set_ylabel('HS6 exact match (%)');ax.set_title('HF expert-reference accuracy: all 94 cases')
for i,v in enumerate(quality.accuracy_all*100):ax.text(i,v+1,f'{v:.1f}%',ha='center')
fig.tight_layout();plt.show()'''),nb.v4.new_markdown_cell('''## 해석의 범위

현재 계층 탐색은 top-1 경로만 유지합니다. 상위 단계의 오분류나 불필요한 보류가 최종 정확도를 제한할 수 있습니다. 제품 입력이 불충분한 사례도 벤치마크 정답과 다르면 전체 정확도에서는 오답으로 셉니다. 이 차이를 비용 우위와 함께 해석해야 합니다.

HF 전체 632개 성능이나 한국 HSK 정확도로 일반화하지 않습니다. Mercari의 상위 모델 일치는 심사 모델 기준의 대리 지표이며 사람 검토/공식 결정문을 대체하지 않습니다. 두 데이터셋의 정확도와 일치율을 합산하지 않습니다.''')]
    n.metadata={'kernelspec':{'name':'product-catalog-experiments','display_name':'Product Catalog Experiments (.venv)','language':'python'},'language_info':{'name':'python'}}
    nb.validate(n);nb.write(n,base/'two-datasets-results-2026-10-06.ipynb')
    print(json.dumps({'quality':{p:s['quality'] for p,s in summaries['hscodecomp'].items()},'judge_proxy':judge_proxy,
                      'total_estimated_cost_usd':sum(s['known_estimated_cost_usd'] for d in summaries.values() for s in d.values())},indent=2))

if __name__=='__main__':main()
