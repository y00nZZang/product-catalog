# Household / hobby scope draft — 2026-10-07

This is a research definition for service-relevant classification, **not verified Sazo policy, prohibited-item screening, or a Korean customs determination**.

## Selection before inference

1. `scope-policy.json` was written before fresh model inference and defines category/type-based inclusion and professional/industrial exclusions.
2. `prepare_service_scope.py` reads only product inputs, category metadata, prior pilot IDs and review decisions. It never reads reference labels or predictions.
3. The rule screen starts with 582/632 candidates. Manual product-fact review covers initial 96 fresh and 80 historical candidates. It excludes five: professional Powercon plate, automotive fuel filter, veterinary microscope, industrial vacuum bellows, occupational hard-hat component. No rejected fresh product is replaced. Final fresh sample: **93**; historical in-scope subset: **78**. Rule-eligible pool after these exclusions: 577, of which most are not individually reviewed.
4. Prior original 94 IDs are excluded from the fresh pool. Fixed SHA256 ordering and category-balanced round-robin choose the initial 96; manual review decisions were finalized before inference. All sampled mixed-material, set, missing-information and contradictory-data examples remain if product use is in scope.

`selection.json` records IDs, policy/review hashes, selection counts and exclusions. `scope-audit.jsonl` preserves a decision for every original input; `manual-review.jsonl` records reviewed cases. `fresh-inputs.jsonl`/`observed-inputs.jsonl` contain exact unmodified model product inputs.

## Source and reference labels

[HSCodeComp](https://huggingface.co/datasets/ATH-MaaS/HSCodeComp), pinned revision `ce9119795acef4ca537b2175e10a3feb7a0ecae9`, source Apache-2.0. Source LICENSE and NOTICE are included in this directory. The HF preparation script downloads the original source and labels locally into `../../2026-10-06/hscodecomp/source/`. No answers or original dataset questions are included in product inputs. Expert US reference codes are loaded separately after inference and truncated to HS6; they are not verified Korean HSK rulings.

## Comparison contract

Only the original Jev / GPT-6 Luna greedy single-path HS2/HS4/HS6 pipelines run. Expanded beam Jev and Jev+LLM final selection are abandoned directions and excluded. Both get identical product facts, taxonomy and instructions; no research, image inputs, enriched child descriptions or output-based filtering. New providers run concurrently per case, with fixed random ordering. Historical full94 and historical scope78 are preserved as descriptive groups; fresh93 is a separate new validation group.

Full-denominator exact HS6 accuracy counts abstentions and errors as wrong. Answered accuracy, answer rate, token counts, request-time sum medians/p95 and usage-based cost estimates are also reported. This category-balanced pilot is not a frequency-weighted estimate of live service traffic; factual ambiguity and expert-label/version differences remain. Do not treat absence of a statistically detectable difference as equivalence.

Run records with provider request details stay private. Replay report and notebook are `notebooks/service-scope-results-2026-10-07.{json,ipynb}`. Reports/slides will be revised in a subsequent step; original evidence is preserved.
