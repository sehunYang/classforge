# 품질 게이트

`node scripts/gate.mjs <lesson.json>` — 정적 검사(S1~S7)·증거 중심 검사(E1)·이미지 검사(I1) 후 브라우저 실측(B1~B8). 하나라도 FAIL이면 exit 1. 결과는 `out/gate-report.json`(`{ok, gates:[{id,name,ok,errors:[{code,msg,hint}],warnings}]}`).

경고(`!`)는 통과를 막지 않지만 캡처 검수 때 확인한다. 게이트를 통과시키려고 템플릿·한도를 바꾸지 않는다. 내용을 고친다.

| 게이트 | 검사 | 흔한 오류 → 해결 |
|---|---|---|
| S1 레슨 구조 (+그림 문항 바탕 S1-WS-BASE) | 필수 필드, 목표 형식, 슬라이드 8~20장, 첫/끝 장, 필수 유형, 같은 유형 3연속, 노트, 활동지 문항 5~14, 정답 필드, 지도안 단계 순서·시간 합. **`figure`에 `visual`/`svg`/`image`가 모두 없으면 FAIL(S1-WS-FIGEMPTY)** — 빈 자료 칸이 조용히 나가는 것을 막는다. **슬라이드·활동지 문항의 알 수 없는 필드는 경고(S1-UNKNOWN/S1-WS-UNKNOWN)** — 오타로 무시되는 필드를 잡는다. **선 잇기 정답이 항등 대응(1-1,2-2,…)이면 경고(S1-MATCH-ID)** | `S1-PLAN-MIN` 분 합계 맞추기 · `S1-NOTES` 노트 20자 이상 · `S1-RUN` 사이에 다른 유형 넣기 · `S1-WS-FIGEMPTY` visual에 `<svg>`·`{plot}`/`{bars}`·`{image:{...}}` 넣기 |
| S2 글자 수 | 제목·항목·설명·슬라이드 전체 글자 수(학교급별, `lesson-schema.md` 표). `$수식$`은 렌더링된 길이로 접어서 센다(백슬래시 명령 1글자, 중괄호·^·_는 제외) | 설명을 notes로, 슬라이드 분할, 항목을 짧은 명사형으로 |
| S3 목표-평가 연결 | 문항마다 `obj`, 목표마다 문항 1개 이상, quiz 존재 | 빠진 목표를 확인하는 문항 추가 |
| S4 수치 근거 | 화면·삽화·활동지의 수치가 `facts.text`에 같은 표기로 있는지, facts마다 출처 | facts에 출처와 함께 추가하거나 수치 삭제. 표기 통일(23.5° vs 23.5도) |
| S5 문체 | 이모지 금지, 목표의 부정 표현, 관찰 어려운 동사(경고), 개념 슬라이드 질문형 제목(경고) | 동사를 설명하다/구분하다 등으로 |
| S6 성취기준 | 존재 여부, `verified:false` 경고, 코드 형식 경고, **text에 메모 문장 금지(S6-NOTE)** — 단 정식 플레이스홀더 `"(교사 입력 필요)"`는 예외로 통과하고 경고만 남긴다 | 교사에게 원문 받기(못 받았으면 `"(교사 입력 필요)"`만 쓰기) |
| S7 설계서 반영 | `meta.intake`가 있을 때만: 설계서에서 채운 항목이 lesson.json·out/에 실제로 반영됐는지(`intake.mjs`의 `checkReflection`). 설계서 없으면 통과(경고만) | 힌트대로 lesson.json 수정, `references/intake.md` |
| E1 증거 중심 | `meta.profile:"evidence"`일 때만(`references/pedagogy.md` §10): **개념 슬라이드 한 장에 정의 하나**(points 2개 이상이면 FAIL) · **compare 바로 다음 장이 diagram/steps/quiz/bignum이어야 함**(대립 설명은 다음 장에서 판정) · **수식이 있는 슬라이드는 앞이나 뒤에 diagram/steps/timeline이 있어야 함**(공식 앞뒤에 증거) · **좌표평면(`plot`)에 `xLabel`/`yLabel`(또는 `axes.x`/`axes.y`)이 없으면 FAIL(E1-AXIS)**. 오개념이 있는데 hook/concept/compare 어디에도 역사 서사 단서가 없으면 경고(E1-HISTORY). **compare 앞 timeline의 마지막 사건이 이미 결론(설명/해결/밝혀)을 말하면 경고(E1-SPOILER, 스포일러)**. profile이 evidence가 아니면 통과(경고만) | `E1-ONEDEF` 포인트를 하나로 합치거나 슬라이드 분할 · `E1-JUDGE` compare 다음 장 유형 바꾸기 · `E1-EVIDENCE` diagram/steps/timeline을 바로 옆에 붙이기 · `E1-AXIS` plot에 xLabel/yLabel 추가 · `E1-SPOILER` 결론 사건을 compare 판정 뒤로 옮기기 |
| I1 이미지 | lesson.json 어디든 있는 `{image:{...}}`마다: 프롬프트가 prompt-kit `check_prompt.mjs` 통과, `images/manifest.json` 캐시가 현재 프롬프트·경로·모델과 일치, 원본·축소본 파일 존재, 긴 변 ≥1024px. 이미지 요청 없으면 통과(경고만) | `node scripts/images.mjs <lesson.json>`(먼저 `--compile-only`), `references/images.md` |
| B1 넘침·겹침 | 본문 영역 넘침, 안전 영역 밖 요소, 글자끼리 겹침 | 글 줄이기, 항목 수 줄이기, 삽화 비율 조정 |
| B2 글자 크기·선 (+SVG 긴 글 B2-SVGTEXT, 라벨 관통 B2-CROSS) | 모든 글자 ≥ 최소(초28·중26·고24px), 본문 역할 글자 ≥ 본문 최소(초38·중34·고32px), 삽화 라벨(경고), **삽화 선이 보이는지(B2-STROKE)**, **선/테두리 있는 사각형이 라벨을 관통(B2-CROSS)**, **얇은 채움 막대(렌더링 후 짧은 변 14px 미만)가 라벨과 겹침(B2-THINBAR)** | 삽화 viewBox 폭 줄이기(라벨이 커짐) · 선에는 `v-accent-s`/`v-ink-s`/`v-line`만 · 막대·테두리를 라벨에서 떨어뜨리기 |
| B3 명암 대비 | 본문 4.5:1, 큰 글자 3:1, **삽화 글자와 그 아래 도형 3:1(B3-SVG)** | `accent`를 직접 지정했다면 더 진한 색으로 · 글자 아래 도형은 연한 채움으로 |
| B4 글꼴 | 내장 글꼴 로드, 글꼴에 없는 한글 | 빌드 다시 실행(글자 목록으로 서브셋 재생성) |
| B5 화면 밀도 | 내용 면적 30% 미만 FAIL, 내용이 위쪽 55%에만 몰림(경고, `meta.profile:"evidence"`면 의도된 여백으로 보고 건너뜀) — cover·chapter·exit·bignum 제외. **삽화가 viewBox의 20% 미만(B5-VISUAL)** | 삽화 추가, steps에 아이콘, 유형 변경 · viewBox를 그림에 맞게 |
| B6 A4 쪽 (+그림 B6-FIG: 글자 8pt·칸 채움·관통·대비) | 한 쪽보다 큰 블록, 쪽 수(활동지 4·정답지 5·지도안 3 이하), 중간 쪽 채움 62% 이상, 인쇄 글자 8pt 이상, 대비, 활동지 문항 글자 크기 | draw 높이 조정, 문항 순서 조정, 문항 수 줄이기 |
| B7 정답 분리 | 활동지에 정답 흔적 0, 정답지 빈칸 모두 채움, 빈칸·문항 수 일치 | (템플릿 문제면 보고) |
| B8 실행 오류 | 콘솔 오류 0 | 삽화 SVG 문법 확인(닫는 태그, 따옴표) |

## 게이트가 잡지 못하는 것 → 캡처 육안 검수 + 도메인 정확성 검토
삽화의 의미가 맞는지, 도형끼리 어색하게 겹치는지, 제목 줄바꿈이 어색한지, 퀴즈 오답의 질. `design.md`의 체크리스트로 확인한다. **삽화·그림 속 과학·수학 내용이 실제로 맞는지, 그림과 그 옆 노트·캡션이 서로 다른 말을 하지 않는지는 게이트가 전혀 모른다** — SKILL.md 7단계의 도메인 정확성 검토(작성자 자신이 아닌 별도 서브에이전트/검증자가 슬라이드·활동지·정답지를 모두 보는 패스)로 확인한다.
