# Jev와 LLM의 HS 후보 판단 실험

[실험 요약·한계](../docs/jev-experiment-2026-10-06.md) · [실제 결과 노트북](two-datasets-results-2026-10-06.ipynb) · [측정값](two-datasets-results-2026-10-06.json)

결과 노트북은 로컬 JSON만 읽는다. API 호출/비용이 발생하지 않는다. Jupyter 또는 VS Code에서 아래 가상환경을 선택한다.

```sh
cd notebooks
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m ipykernel install --user --name product-catalog-experiments
.venv/bin/jupyter lab
```

## 데이터와 실제 호출

HF 원본은 `ATH-MaaS/HSCodeComp`, pinned revision `ce9119795acef4ca537b2175e10a3feb7a0ecae9`. Apache-2.0이며 준비 스크립트가 원본 LICENSE/NOTICE도 저장한다. 상품 입력과 정답 라벨을 분리한다.

```sh
# Repository root: prepare HF; no model calls
notebooks/.venv/bin/python notebooks/prepare_customs_datasets.py
```

유료 실행기는 `run_two_datasets.py`이며 `.env.local` 또는 프로세스 환경의 기존 `OPENAI_API_KEY`, `TYPESAFEAI_API_KEY`를 읽는다. 실제 키를 노트북·Git에 저장하지 않는다. `hscodecomp`는 시작용94개, `mercari`는 로컬에 준비된30개, `judge`는 상위 모델 독립 분류를 실행한다. `--full`은HF 전체632개로 확대한다. 코드의 예약/호출 상한과 공급사 청구 조건을 먼저 확인한다. 같은 실행 폴더의 완료된 사례는 재사용하며 자동 재시도는 없다.

Mercari 판매자 설명은 재배포하지 않았다. 정확히 같은 과거 입력의 재현은 로컬 보관 자료가 필요하다. 공개 판매글을 새로 수집하려면 상품 설명 발췌·출처·시각만 담은 최소 캡처를 준비해 `prepare_customs_datasets.py --mercari-capture <file>`로 변환한다. 전체 HTML·판매자 프로필·댓글·세션은 넣지 않는다. 캡처 계약은 준비 스크립트의 `prepare_mercari` 함수를 참고한다. 필수 항목은 source_url, title, description_excerpt, description_original_characters, description_truncated, family, discovery_url, captured_at, capture_method이며 category_text와 condition_text는 선택 항목이다.

`report_two_datasets.py`는 원본 로컬 일지가 있을 때 보고서를 재생성한다. 공개된 결과 JSON과 노트북은 원본 일지 없이 열 수 있다. 운영 서비스·DB·기존 OpenAI 실행 예산과 분리된 연구 코드이며 운영 경로에 Jev를 적용하지 않았다.

## 오프라인 검증

```sh
notebooks/.venv/bin/python -m unittest discover -s notebooks -p 'test_jev_customs_experiment.py'
notebooks/.venv/bin/python -m unittest discover -s notebooks -p 'test_customs_dataset.py'
```

예산/캐시/실패 처리, 확률 검증, 정보 부족 보류, 라벨 유출과 분모 처리를 검증한다. 테스트 통과는 상품 분류 정확도 증거가 아니다.


## 최신: 서비스 범위 한정 단일 경로 비교 (2026-10-07)

가정용·취미 범위 초안을 먼저 고정하고 새 표본93개를 선별했습니다. 혼합 재질·세트·정보 부족 사례는 유지하고, 범위 밖으로 검토된 최초 표본3개는 대체하지 않았습니다. 기존 전체94개·범위안78개·새93개 결과는 따로 보존합니다. 자세한 [품질·시간·비용 결과](../docs/service-scope-jev-experiment-2026-10-07.md)와 [선별 기준](../datasets/customs/2026-10-07/service-scope/README.md)을 참고하세요.

```sh
# Repository root. Replay notebook: no paid requests.
notebooks/.venv/bin/python -m jupyter nbconvert --execute --to notebook --inplace notebooks/service-scope-results-2026-10-07.ipynb
# Prepare original pinned HF data and frozen scope; no model calls.
notebooks/.venv/bin/python notebooks/prepare_customs_datasets.py
notebooks/.venv/bin/python notebooks/prepare_service_scope.py
# Explicit paid run: original greedy Jev / Luna only. Reserved cap USD 3.20.
notebooks/.venv/bin/python notebooks/run_service_scope.py --live
notebooks/.venv/bin/python -m unittest discover -s notebooks -p 'test_service_scope.py'
```

복수 경로 Jev와 Jev 탐색+LLM 선택은 후속 비교에서 제외합니다. 새 결과 노트북은 공개 JSON만으로 재생됩니다. `report_service_scope.py`는 과거 원본 로컬 일지가 있어야 과거78/94개를 재집계할 수 있습니다. 공급사 요청 저널은 비공개이며, 보고서의 각 집단별 비용·시간·정확도와 개별 예측은 결과 JSON에서 확인할 수 있습니다.
