# lesson.json 스키마

한 파일에 수업 한 차시의 모든 내용이 들어간다. 완성 예시: `examples/season/lesson.json`.

## 인라인 표기 (모든 문자열)
| 표기 | 결과 | 쓰는 곳 |
|---|---|---|
| `**낱말**` | 굵게 | 핵심어 1~2개 |
| `==낱말==` | 형광펜 밑줄 | 한 슬라이드에 1곳 |
| `*낱말*` | 강조색 | 한 슬라이드에 1곳 |
| `\n` | 줄바꿈 | 표지 부제 등 |
| `{{정답}}` | 빈칸(활동지) | 활동지 `concept` 본문, `table` 칸 전체 |

수식의 곱셈 기호는 `*` 대신 `×`를 쓴다(`*`는 강조로 해석된다).

## meta
```json
"meta": {
  "title": "계절은 왜 생길까?",          // 수업 제목 (표지·활동지·지도안)
  "short": "계절이 생기는 까닭",         // 슬라이드 오른쪽 위 짧은 제목 (없으면 title)
  "subject": "과학",                    // 교과 → 강조색 자동 (국어·수학·사회·역사·도덕·과학·영어·음악·미술·체육·실과·기술가정·정보·창체)
  "grade": "초등 6학년",
  "level": "elem",                      // elem | middle | high → 글자 크기·글자 수 한도가 바뀐다
  "unit": "계절의 변화",
  "lesson": "4/9차시",
  "minutes": 40,                        // 지도안 시간 합과 같아야 한다
  "accent": "#0B7A6A",                  // (선택) 강조색 직접 지정. 종이색 위 대비 4.5:1 이상
  "school": "", "teacher": "", "date": "",   // (선택) 지도안 머리
  "profile": "evidence",                // (선택) "default"(기본) | "evidence"(증거 중심 탐구 스타일 — 공식 옆에 근거, 대립 설명은 판정 전 대칭 배치, 절제된 디자인. `pedagogy.md` §10)
  "tone": "해요체",                     // (선택) "해요체" | "합쇼체" — 지정 없으면 초·중 해요체, 고 합쇼체 (템플릿 고정 문구에 적용)
  "intake": "설계서.md",                // (선택) 수업 설계서 경로(lesson.json 기준 상대 경로) — 있으면 게이트 S7이 반영 여부를 확인
  "standards": [ { "code": "[6과12-03]", "text": "원문 그대로", "verified": true } ]
}
```
성취기준을 교사에게 받지 못했으면 `"code": ""`, `"verified": false`. 코드를 추측해 넣지 않는다. `profile: "evidence"`는 증거 중심 탐구 스타일이다 — 공식·주장 옆에 그 근거(실험·역사)를 바로 붙이고, 대립 설명은 대칭으로 놓은 뒤 다음 슬라이드에서 실험으로 판정하며, 개념 슬라이드 한 장에 정의 하나만 둔다(저작 규칙은 `references/pedagogy.md` §10). 디자인은 절제되어 제목 두께가 한 단계 낮고 챕터 전환도 흰 배경을 유지하며, 강조색은 움직이는 핵심 요소 하나에만 쓴다(`references/design.md`). B5 게이트의 "내용이 위쪽에만 몰림" 경고는 이 프로파일에서 의도된 여백으로 보고 건너뛴다. 이 세부 저작 규칙은 게이트 E1이 확인한다 — 설계서로 프로파일을 요청한 경우 S7은 `meta.profile`(과 `meta.tone`)이 요청한 값과 같은지만 본다. `tone`은 build.mjs의 문체 고정 문구(안내문 등)가 해요체/합쇼체 중 무엇을 쓸지 정한다. `intake`는 교사가 채운 `templates/수업설계서.md`를 `intake.mjs`로 파싱해 반영한 경우에만 쓴다(`references/intake.md`).

## images (선택, 최상위)
```json
"images": { "model": "gpt-image-2.5-sunburst", "quality": "high" }
```
`visual`에 `{image:{...}}` 생성 이미지 요청이 있을 때만 쓴다. 기본(이 필드 없음)은 subscription 경로(Codex CLI, 사용자 ChatGPT 구독 쿼터, 모델은 서버가 고른다). `model`을 쓰면(또는 환경변수 `CLASSFORGE_IMAGE_MODEL`) 그 모델을 강제하는 api 경로로 바뀌며 `OPENAI_API_KEY`가 있어야 한다(사용자의 OpenAI API 과금, 구독 쿼터와 별도). `quality`는 api 경로에서만 쓰며 기본값 `high`. 자세한 절차는 `references/images.md`.

## objectives (1~3개)
`"~할 수 있다."`로 끝나는 문장. 관찰 가능한 동사(설명하다·구분하다·찾다·그리다·계산하다·비교하다·만들다·발표하다). `pedagogy.md` 참고.

## facts
```json
"facts": [ { "id": "f1", "text": "지구의 자전축은 약 23.5° 기울어져 있다.", "source": "초등 과학 6-2 교과서" } ]
```
슬라이드·삽화 라벨·막대그래프 값·활동지에 나오는 수치(두 자리 이상, 소수, 단위가 붙은 수)는 모두 여기 `text`에 같은 표기로 있어야 한다. 실험 조건이나 수학 예제처럼 설계로 정한 값은 `"source": "수업 설계(예제 값)"`로 적는다. `meta`(학년·단원·차시·제목·수업 시간)에 있는 숫자는 대조에서 허용된다. `plot`의 눈금 숫자는 대조하지 않는다.

## slides (8~20장, 권장 12~16장)
공통 필드: `type`(필수), `notes`(필수, 20자 이상 — 교사가 말할 핵심과 발문), `kicker`(선택, 제목 위 작은 머리말), `reveal`(선택, true면 항목을 → 키로 하나씩 공개).

| type | 필수 필드 | 선택 필드 | 개수 한도 |
|---|---|---|---|
| `cover` | — (`title` 없으면 meta.title) | `kicker`, `subtitle`, `visual` | — |
| `goals` | — (`items` 없으면 objectives) | `title`, `question`(중심 질문) | — |
| `hook` | `question`, `visual` | `kicker`, `lead`, `caption` | — |
| `chapter` | `title` | `no`("02"), `sub` | — |
| `concept` | `title`, `points[{h,t}]` | `lead`, `visual`, `caption` | points 초1~3 / 중·고 1~4 |
| `compare` | `title`, `left{label,items[],visual?}`, `right{…}` | `note` | 각 3개 권장 |
| `steps` | `title`, `steps[{h,t,visual?}]` | `hot`(강조할 단계 index, 기본 0) | 3~5 |
| `diagram` | `title`, `visual` | `kicker`, `caption` | — |
| `bignum` | `value`, `label`, `fact`(facts id) | `unit`, `caption`, `source`, `visual` | — |
| `quiz` | `question`, `answer` | `choices[]`(있으면 answer는 1부터 번호), `explain` | 선택지 4개 권장 |
| `activity` | `title`, `steps[]`, `minutes` | `mode`("4인 모둠"), `worksheetRef`("활동지 02"), `output` | steps 3~4 |
| `vocab` | `terms[{term,def,en?}]` | `title` | 2~4 |
| `timeline` | `title`, `events[{when,what}]` | — | 3~5 |
| `summary` | `title`, `items[]` | `next`(다음 차시 예고) | 2~3 |
| `exit` | `question` | `hint` | — |
| `passage` | `title`, `chunks[{label,text,hot?}]` | `kicker`, `note`, `reveal` | chunks 1~4, 지문 글자 수 = 슬라이드 한도 × 3 |

규칙: 첫 장 `cover`, 마지막 장 `summary` 또는 `exit`. `goals`·`quiz`·`activity`·`summary` 각 1장 이상. 같은 유형 3장 연속 금지. 삽화(`visual`)가 있는 슬라이드 1장 이상(권장 4장 이상).

`visual`은 넷 중 하나:
1. `<svg …>` 문자열 — 직접 그린 삽화(`design.md`)
2. `{ "plot": {…} }` 또는 `{ "bars": {…} }` — 좌표평면·함수·막대그래프는 반드시 이 선언형으로(`design.md` "그래프는 선언형으로")
3. lesson.json 기준 상대 경로의 이미지 파일(`"img/photo.jpg"`) — 빌드 때 파일 안에 들어간다. 저작권이 확인된 이미지만.
4. `{ "image": { "id", "brief", "role", "ratio", "style", "prompt"? } }` — Codex·OpenAI Images API로 생성하는 이미지(정확한 값·라벨이 필요 없는 훅·표지·실제 사진 장면에만). `role`이 `cover`|`hook`이면 칸을 풀블리드/가득 채움으로, 그 외(`concept`|`background`)는 둥근 모서리 채움으로 넣는다. 절차·프롬프트 작성법은 `references/images.md`, 검사는 게이트 I1.

### 글자 수 한도 (게이트 S2, 공백 제외)
| | 초 elem | 중 middle | 고 high |
|---|---|---|---|
| 제목 | 24 | 28 | 32 |
| 질문형 제목(hook·quiz·exit·goals) | 48 | 56 | 64 |
| 항목 한 줄(`h`, 목록, 선택지) | 34 | 42 | 48 |
| 설명(`t`) | 57 | 71 | 81 |
| 슬라이드 전체 | 125 | 160 | 180 |

넘치면 슬라이드를 둘로 나누거나 설명을 `notes`로 옮긴다.

## worksheet
```json
"worksheet": {
  "title": "…", "subtitle": "…",
  "sections": [ { "title": "개념 정리", "lead": "(선택) 안내 한 줄", "minutes": 5, "items": [ … ] } ],
  "tip": "(선택) 마지막 도움말 한 줄"
}
```
섹션 2개 이상, 문항(concept·figure 제외) 5~14개. 마지막에 목표별 "스스로 점검하기" 표가 자동으로 붙는다. 문항 번호도 자동.

| type | 필드 | 정답 표기 |
|---|---|---|
| `concept` | `text`(`\n`으로 문단), `obj` | 본문 안 `{{정답}}` 빈칸 (1개 이상) |
| `choice` | `q`, `choices[]`, `answer`(1부터), `explain`, `obj`, `cols`(선택 1·2) | `answer` |
| `short` | `q`, `lines`(줄 수), `answer`(모범 답안), `explain`, `obj` | `answer` |
| `ox` | `q`, `rows[{s, a:true/false}]`, `obj` | `a` |
| `match` | `q`, `left[]`, `right[]`, `answer[[왼쪽번호,오른쪽번호],…]`, `obj` | 쌍 수 = 왼쪽 항목 수 |
| `table` | `q`, `head[]`, `rows[[…]]`, `obj` | 정답 칸은 칸 전체를 `"{{정답}}"` |
| `draw` | `q`, `height`(mm, 30~70), `model`(채점 기준), `placeholder`, `base`(바탕 그림), `answer`(정답지 그림), `obj` | `model`, `answer` |
| `figure` | `visual`(슬라이드 `visual`과 같은 형식 — `<svg>` 문자열 · `{plot}`/`{bars}` · `{image:{...}}`, 예전 이름 `svg`/`image`도 그대로 통함), `caption`, `height`(mm) | (자료 제시용, 문항 아님. `visual`이 없으면 게이트 **S1-WS-FIGEMPTY**로 실패 — 빈 자료 칸이 조용히 나가는 것을 막는다) |
| `passage` | `text`(`\n`으로 문단, 문단 번호 자동), `title`, `source`, `start`(첫 문단 번호 — 지문을 둘로 나눌 때 이어 매기기) | (읽기 지문, 문항 아님. `{{빈칸}}` 가능) |

모든 문항에 `obj`(학습 목표 번호, 1부터)를 단다. `points`(배점)는 선택.

`draw`의 `base`/`answer`: 학생이 그 위에 그리는 바탕과, 정답지에만 나오는 정답 그림. 좌표평면이면 `{ "plot": { "x": [-5,5], "y": [-5,5] } }`(직선 없이), `answer`는 같은 범위에 정답 직선·점을 넣은 plot. 지도·도형이면 `<svg>` 문자열. 문항에 "좌표평면·그래프를 그리·지도에·백지도"가 들어가면 `base`가 없을 때 S1-WS-BASE로 실패한다.

성취기준 `text`에는 성취기준 문장만 쓴다. "확인 필요, 추정, 아직 받지 못함" 같은 메모를 쓰면 인쇄물에 그대로 나가므로 S6-NOTE로 실패한다(원문이 없으면 `verified:false`만).

## plan
```json
"plan": {
  "model": "모형 탐구 수업 (예상 → 실험 → 설명)",
  "materials": ["손전등", "활동지"],
  "flow": [
    { "stage": "도입", "element": "동기 유발", "minutes": 3,
      "teacher": ["…"], "student": ["…"], "material": "슬라이드 1~3", "note": "유의점" }
  ],
  "evaluation": [ { "what": "평가 요소", "method": "관찰·활동지", "criteria": { "상": "…", "중": "…", "하": "…" } } ],
  "questions": [ { "q": "예상 질문", "a": "답" } ],
  "checkpoint": "다음 차시로 넘어가도 되는 기준 한 문장"
}
```
`stage`는 `도입` → `전개` → `정리` 순서만. 행마다 `teacher`와 `student`가 모두 있어야 한다. `minutes` 합 = `meta.minutes`.
