# lesson.json 스키마

한 파일에 수업 한 차시의 모든 내용이 들어간다. 완성 예시: `examples/season/lesson.json`.

## 인라인 표기 (모든 문자열)
| 표기 | 결과 | 쓰는 곳 |
|---|---|---|
| `**낱말**` | 굵게 | 핵심어 1~2개 |
| `==낱말==` | 형광펜 밑줄 | 한 슬라이드에 1곳 |
| `*낱말*` | 핵심 낱말(primary 색) | 한 슬라이드에 1곳 |
| `\n` | 줄바꿈 | 표지 부제 등 |
| `{{실제 정답}}` | 빈칸(활동지) | 활동지 `concept` 본문, `table` 칸 전체. `{{ }}` 안에는 그 자리의 실제 정답 텍스트를 쓴다(예: `{{높다}}`) — "정답"이라는 낱말 자체를 쓰는 게 아니다(게이트 S1-BLANK-LITERAL이 그 사고를 막는다) |

수식의 곱셈 기호는 `*` 대신 `×`를 쓴다(`*`는 강조로 해석된다).

## meta
```json
"meta": {
  "title": "계절은 왜 생길까?",          // 수업 제목 (표지·활동지·지도안)
  "short": "계절이 생기는 까닭",         // 슬라이드 오른쪽 위 짧은 제목 (없으면 title)
  "subject": "과학",                    // 교과 이름(표지·머리말에 표시). 색은 교과와 무관한 고정 팔레트 — design.md "팔레트"
  "grade": "초등 6학년",
  "level": "elem",                      // elem | middle | high → 글자 크기·글자 수 한도가 바뀐다
  "unit": "계절의 변화",
  "lesson": "4/9차시",
  "minutes": 40,                        // 지도안 시간 합과 같아야 한다
  "school": "", "teacher": "", "date": "",   // (선택) 지도안 머리
  "profile": "evidence",                // (선택) "default"(기본) | "evidence"(증거 중심 탐구 스타일 — 공식 옆에 근거, 대립 설명은 판정 전 대칭 배치, 절제된 디자인. `pedagogy.md` §10)
  "tone": "해요체",                     // (선택) "해요체" | "합쇼체" — 지정 없으면 초·중 해요체, 고 합쇼체 (템플릿 고정 문구에 적용)
  "font": "auto",                       // (선택) "auto"(기본, evidence 프로파일이고 PC에 설치돼 있으면 KoPub) | "kopub" | "pretendard" — `design.md` "글꼴"
  "intake": "설계서.md",                // (선택) 수업 설계서 경로(lesson.json 기준 상대 경로) — 있으면 게이트 S7이 반영 여부를 확인
  "objectivesStudent": ["실험 결과로 두 가설 중 타당한 쪽을 판단할 수 있다."],  // (선택, evidence) 학생용 목표 — 아래 "meta.objectivesStudent" 참고
  "standards": [ { "code": "[6과12-03]", "text": "원문 그대로", "verified": true } ]
}
```
성취기준을 교사에게 받지 못했으면 `"code": ""`, `"verified": false`. 코드를 추측해 넣지 않는다. `profile: "evidence"`는 증거 중심 탐구 스타일이다 — 공식·주장 옆에 그 근거(실험·역사)를 바로 붙이고, 대립 설명은 대칭으로 놓은 뒤 다음 슬라이드에서 실험으로 판정하며, 개념 슬라이드 한 장에 정의 하나만 둔다(저작 규칙은 `references/pedagogy.md` §10). 디자인은 절제되어 제목 두께가 한 단계 낮고 챕터 전환도 종이 배경을 유지하며, 코럴은 움직이는 핵심 요소 하나에만 쓴다(`references/design.md`). B5 게이트의 "내용이 위쪽에만 몰림" 경고는 이 프로파일에서 의도된 여백으로 보고 건너뛴다. 이 세부 저작 규칙은 게이트 E1이 확인한다 — 설계서로 프로파일을 요청한 경우 S7은 `meta.profile`(과 `meta.tone`)이 요청한 값과 같은지만 본다. `tone`은 build.mjs의 문체 고정 문구(안내문 등)가 해요체/합쇼체 중 무엇을 쓸지 정한다. `intake`는 교사가 채운 `templates/수업설계서.md`를 `intake.mjs`로 파싱해 반영한 경우에만 쓴다(`references/intake.md`).

## images (선택, 최상위)
```json
"images": {
  "model": "gpt-image-2.5-sunburst", "quality": "high",
  "style": { "palette": "#F8F6FA #3B1E54 #7A5C9E #FF6F61", "lighting": "soft daylight", "medium": "clean educational photo" },
  "subject": "같은 초록 콩 모종, 같은 학생 손, 같은 투명 컵"
}
```
`visual`에 `{image:{...}}` 생성 이미지 요청이 있을 때만 쓴다. 기본(이 필드 없음)은 subscription 경로(Codex CLI, 사용자 ChatGPT 구독 쿼터, 모델은 서버가 고른다). `model`을 쓰면(또는 환경변수 `CLASSFORGE_IMAGE_MODEL`) 그 모델을 강제하는 api 경로로 바뀌며 `OPENAI_API_KEY`가 있어야 한다(사용자의 OpenAI API 과금, 구독 쿼터와 별도). `quality`는 api 경로에서만 쓰며 기본값 `high`. `style`(선택, palette/lighting/medium 각각 선택)은 이 수업의 모든 이미지 프롬프트 끝에 자동으로 붙어 한 세트처럼 보이게 한다. `subject`(선택)는 레슨 전체 연속성 힌트(실험 절차처럼 같은 소재가 이어질 때) — 이미지별로 다르게 주려면 각 `image.continuity`를 쓴다(`image.continuity`가 있으면 그 요청에서는 `images.subject` 대신 쓰인다). 자세한 절차는 `references/images.md`.

## objectives (1~3개)
`"~할 수 있다."`로 끝나는 문장. 관찰 가능한 동사(설명하다·구분하다·찾다·그리다·계산하다·비교하다·만들다·발표하다). `pedagogy.md` 참고. 이 문구는 **지도안**(`plan`)이 쓰고, 게이트 **S7**이 설계서 반영 확인에 이 필드를 그대로 대조한다 — 그래서 교사가 준 목표 문장(결론이 담겨 있어도)을 여기서는 고쳐 쓰지 않는다.

## meta.objectivesStudent (선택, `objectives`와 같은 길이의 배열)
`evidence` 프로파일에서 `objectives`가 "빛이 입자(광자)의 성질을 가진다고 설명할 수 있다"처럼 compare의 판정 결론을 담고 있으면, 학생이 보는 자리(goals 슬라이드 기본값, 활동지·정답지 머리말 "학습 목표", 스스로 점검하기 표)에는 이 필드를 대신 쓴다 — "실험 결과로 파동설과 입자설 중 타당한 쪽을 판단할 수 있다"처럼 결론 없이 할 일만 적는다. 없으면 그 자리들도 `objectives`를 그대로 쓴다. `goals` 슬라이드에 `items`를 직접 쓰면 그 슬라이드만 오버라이드되고 활동지·정답지 머리말은 여전히 `objectives`(또는 `objectivesStudent`, 있으면)를 쓴다. 지도안은 이 필드와 무관하게 항상 `objectives`를 쓴다. 게이트 **E1-PRESPOILER**가 goals 슬라이드에 실제로 보이는 문구와 활동지·정답지 머리말 문구를 각 compare의 판정 근거·좌우 라벨과 대조해, 결론을 미리 말하면 FAIL한다(`references/pedagogy.md` §10).

## facts
```json
"facts": [ { "id": "f1", "text": "지구의 자전축은 약 23.5° 기울어져 있다.", "source": "초등 과학 6-2 교과서" } ]
```
슬라이드·삽화 라벨·막대그래프 값·활동지에 나오는 수치(두 자리 이상, 소수, 단위가 붙은 수)는 모두 여기 `text`에 같은 표기로 있어야 한다. 실험 조건이나 수학 예제처럼 설계로 정한 값은 `"source": "수업 설계(예제 값)"`로 적는다. `meta`(학년·단원·차시·제목·수업 시간)에 있는 숫자는 대조에서 허용된다. `plot`의 눈금 숫자는 대조하지 않는다. `plot`의 `data`(실측값) 시리즈는 각 점의 x·y 값이 `data.fact`로 연결한 fact의 `text`에 그대로 있어야 한다(게이트 S4-DATA, `design.md` 참고) — 실제 자료가 없으면 값을 지어내지 말고 `"source": "수업 설계(예시 실험값)"`로 예시임을 밝힌다. `data`가 있는 "예측 vs 측정" `plot`은 `y` 범위를 실측값에 맞추고(여유 10~20%) 억지로 늘리지 않는다 — `data`가 있으면 `scale`이 자동으로 `"free"`가 되어 각 축을 칸에 꽉 채우므로, 범위를 넓게 잡을수록 데이터가 한쪽에 몰린다(`design.md`의 `plot.scale` 참고).

`data`의 모든 점이 같은 `plot`의 `lines`/`curves`(예측)와 1% 이내로 정확히 일치하면 안 된다 — 그건 실측이 아니라 공식으로 계산해 값을 베낀 것이다(게이트 **E1-DATAFIT**). 값을 지어낼 때도 점마다 현실적인 편차를 준다. `data.fact`로 연결한 fact의 `source`에 `"예시"`가 들어 있으면, 그 `data.label`에도 `"측정값(예시)"`처럼 예시임을 밝힌다 — 출처에만 적고 화면 라벨이 그냥 "측정값"이면 학생이 실측으로 오해한다(게이트 **E1-EXAMPLE-LABEL**).

## slides (8~20장, 권장 12~16장)
공통 필드: `type`(필수), `notes`(필수, 20자 이상 — 교사가 말할 핵심과 발문), `kicker`(선택, 제목 위 작은 머리말), `reveal`(선택, true면 항목을 → 키로 하나씩 공개).

| type | 필수 필드 | 선택 필드 | 개수 한도 |
|---|---|---|---|
| `cover` | — (`title` 없으면 meta.title) | `kicker`, `subtitle`, `visual` | — |
| `goals` | — (`items` 없으면 objectives) | `title`, `question`(중심 질문) | — |
| `hook` | `question`, `visual` | `kicker`, `lead`, `caption` | — |
| `chapter` | `title` | `no`("02"), `sub` | — |
| `concept` | `title`, `points[{h,t}]` | `lead`, `visual`, `caption` | points 초1~3 / 중·고 1~4. `points[].t`·`lead`·`caption`은 문장이므로 `meta.tone`의 어미로 맺는다(S5-TONE), `points[].h`는 개조식 허용 |
| `compare` | `title`, `left{label,items[],visual?}`, `right{…}` | `note`, `kind`("rival" 기본 \| "contrast") | 각 3개 권장 |
| `steps` | `title`, `steps[{h,t,visual?}]` | `hot`(강조할 단계 index, 기본 0), `evidence` | 3~5 |
| `diagram` | `title`, `visual` | `kicker`, `caption`, `evidence` | — |
| `bignum` | `value`, `label`, `fact`(facts id) | `unit`, `caption`, `source`, `visual`, `evidence` | — |
| `quiz` | `question`, `answer` | `choices[]`(있으면 answer는 1부터 번호), `explain`, `evidence` | 선택지 4개 권장 |
| `activity` | `title`, `steps[]`, `minutes` | `mode`("4인 모둠"), `worksheetRef`("활동지 02"), `output`, `visual`(선택, 예: 장치 사진 — 단계 목록 옆에 들어가고 제목·타이머 폭은 그대로다) | steps 3~4 |
| `vocab` | `terms[{term,def,en?}]` | `title` | 2~4 |
| `timeline` | `title`, `events[{when,what}]` | — | 3~5 |
| `summary` | `title`, `items[]` | `next`(다음 차시 예고), `visual`(선택, 여운을 주는 장면) | 2~3 |
| `exit` | `question` | `hint`, `visual`(선택, 여운을 주는 장면 — 있으면 기본 장식 곡선 대신 그 자리에 들어간다) | — |
| `passage` | `title`, `chunks[{label,text,hot?}]` | `kicker`, `note`, `reveal` | chunks 1~4, 지문 글자 수 = 슬라이드 한도 × 3 |

규칙: 첫 장 `cover`, 마지막 장 `summary` 또는 `exit`. `goals`·`quiz`·`activity`·`summary` 각 1장 이상. 같은 유형 3장 연속 금지. 삽화(`visual`)가 있는 슬라이드 1장 이상(권장 4장 이상). **`visual`은 그 유형의 렌더러가 실제로 읽는 자리에만 쓴다** — `cover`·`hook`·`concept`·`diagram`·`bignum`·`activity`·`exit`·`summary`는 최상위 `visual`을, `compare`는 `left.visual`/`right.visual`을, `steps`는 각 `steps[].visual`을 쓴다. 그 외 자리(예: `quiz`·`compare`·`steps`의 최상위 `visual`, `goals`·`chapter`·`vocab`·`timeline`·`passage` 전체)에 `visual`을 쓰면 화면에 조용히 나오지 않고 게이트 **S1-VISUAL-IGNORED**로 FAIL한다.

`evidence`(선택, `steps`·`diagram`·`bignum`·`quiz`만): `meta.profile:"evidence"`에서 `compare` 바로 다음 판정 슬라이드가 무엇을 근거로, 어느 쪽을 기각하며 판정하는지 밝힌다. 형태는 `{ "fact": "fN", "refutes": "left"|"right" }`(배열도 가능 — 근거가 여럿이면). 문자열(facts id) 하나만 쓰는 옛 형태도 파싱은 되지만, `refutes`가 없으면 게이트 **E1-JUDGE-EVIDENCE**가 "어느 설명을 기각하는지 밝혀야 함"으로 FAIL한다. 판정 슬라이드가 `visual.plot`에 `data` 시리즈를 이미 갖고 있으면 `evidence`는 안 써도 된다(그래프 자체가 근거). `evidence`를 달았으면 그 슬라이드의 `explain`·`caption`·본문·`points`·`notes` 어딘가에 그 fact의 수치나 특징적인 낱말이 실제로 보여야 하고("근거를 달아만 놓고 언급은 안 함"을 막는다), 기각된 쪽(`refutes`가 가리키는 `left`/`right`, 또는 `data`만으로 판정할 때는 둘 중 하나)의 라벨·낱말이 "예측하지 못했다/맞지 않다/틀렸다/기각" 같은 반대 표현과 함께 보여야 한다 — 게이트 **E1-JUDGE-DISCRIM**(`references/pedagogy.md` §10 "구별력" 참고).

`compare.kind`(선택, 기본 `"rival"`): 좌우가 **서로 배타적인 주장**(하나가 맞으면 하나는 틀림)이면 `"rival"`(기본값) — 위 판정·구별력 규칙(E1-JUDGE·E1-JUDGE-EVIDENCE·E1-JUDGE-DISCRIM)이 적용된다. 좌우가 **둘 다 참인 서로 다른 사실·효과**를 나란히 놓고 대비만 할 뿐이면(예: "세기를 늘리면"(전자 수↑) vs "진동수를 높이면"(전자 에너지↑)) `"contrast"`로 쓴다 — 판정 규칙을 면제받고, 그 자체로는 역사 서사(E1-HISTORY)도 요구하지 않는다. 단, `"contrast"`인데 좌우 `label`/`items`에 "설명/예측/가설/생각/주장/…설/때문" 같은 주장·추측 언어가 있으면 대립 가설을 위장한 것으로 보고 게이트 **E1-CONTRAST-MISUSE**가 FAIL한다.

`visual`은 다음 중 하나(세 갈래 규칙 — 그래프는 plot/bars, 정밀 도형은 도해 엔진, 그 외 삽화는 전부 생성 이미지. 손그림 `<svg>`는 레거시이며 게이트 **V1**이 잡아낸다):
1. **(레거시)** `<svg …>` 문자열 — 예전에 직접 그리던 삽화 형식. 새 lesson.json에는 쓰지 않는다 — 아래 2~4번 중 맞는 형태로 대신한다(`design.md`, 게이트 V1-RAWSVG).
2. `{ "plot": {…} }` 또는 `{ "bars": {…} }` — 좌표평면·함수·막대그래프는 반드시 이 선언형으로(`design.md` "그래프는 선언형으로")
3. `{ "tikz": {…} }` / `{ "refraction": {…} }` / `{ "circuit": {…} }` / `{ "particles": {…} }` / `{ "geometry": {…} }` / `{ "vectors": {…} }` — 정확한 값·라벨·위치 관계(광선 경로, 회로, 입자 개수·크기, 작도)가 채점·이해에 들어가는 정밀 도형은 이 도해 엔진으로 그린다(생성 이미지는 개수·각도를 보장 못한다). 각 형태의 필드는 그 스크립트의 문서를 따른다.
4. lesson.json 기준 상대 경로의 이미지 파일(`"img/photo.jpg"`) — 빌드 때 파일 안에 들어간다. 저작권이 확인된 이미지만.
5. `{ "image": { "id", "brief", "role", "ratio"?, "style", "continuity"?, "prompt"?, "purpose"?, "hint"? } }` — Codex·OpenAI Images API로 생성하는 이미지. **정확한 값·라벨이 필요 없는 모든 삽화**(훅·표지·개념·실험 단계·정리 장면 등)에 이 형태를 쓴다 — 개수 제한 없음. `role`은 `hook`\|`concept`\|`cover`\|`background`\|`step`\|`scene` 중 하나(`ratio`를 안 쓰면 role별 기본값이 채워진다). `role`이 `cover`면 칸을 풀블리드로, 그 외는 둥근 모서리 채움(`object-fit:cover`)으로 넣는다. **단, evidence 프로파일의 rival `compare` 좌우에는 쓰지 않는다**(게이트 V1-COMPAREIMG — 개수·크기를 보장 못해 판정 전에 답을 암시할 수 있다. `kind:"contrast"` 대비는 가능). `purpose`(선택, `exit`·`summary`에서만 의미가 있다)는 `"evidence"`(판정 근거를 다시 보여줌) 또는 `"application"`(실생활 적용 사례) — **`exit`·`summary`는 이미지 없음이 기본값**이고, 넣는다면 `purpose`를 지정하고 `caption`·`hint`(이 필드, 이미지 전용 설명)·`notes` 중 하나에 이 이미지가 무엇을 보여주고 수업과 어떻게 연결되는지 적어야 한다(게이트 **V1-CONCEPTMOOD**, `references/pedagogy.md` §10). 절차·프롬프트 작성법은 `references/images.md`, 검사는 게이트 I1(프롬프트·해상도)·V1(어디에 있어야 하는지, 손그림 금지).

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
| `concept` | `text`(`\n`으로 문단), `obj` | 본문 안 `{{ }}`로 실제 정답을 감싼 빈칸(예: `{{높다}}`, "정답"이라는 글자 자체는 아님) 1개 이상 |
| `choice` | `q`, `choices[]`, `answer`(1부터), `explain`, `obj`, `cols`(선택 1·2) | `answer` |
| `short` | `q`, `lines`(줄 수), `answer`(모범 답안), `explain`, `obj` | `answer` |
| `ox` | `q`, `rows[{s, a:true/false}]`, `obj` | `a` |
| `match` | `q`, `left[]`, `right[]`, `answer[[왼쪽번호,오른쪽번호],…]`, `obj` | 쌍 수 = 왼쪽 항목 수 |
| `table` | `q`, `head[]`, `rows[[…]]`, `obj` | 정답 칸은 실제 정답 텍스트를 `{{ }}`로 감싼다(예: `{{높다}}`) — "정답"이라는 글자를 그대로 쓰지 않는다(게이트 S1-BLANK-LITERAL) |
| `draw` | `q`, `height`(mm, 30~70), `model`(채점 기준), `placeholder`, `base`(바탕 그림), `answer`(정답지 그림), `obj` | `model`, `answer` |
| `figure` | `visual`(슬라이드 `visual`과 같은 형식 — `{plot}`/`{bars}` · 도해 엔진(`{tikz}`등) · `{image:{...}}`, 예전 이름 `svg`/`image`도 파싱은 되지만 `svg`에 `<svg>` 문자열을 넣으면 게이트 **V1-RAWSVG**로 실패), `caption`, `height`(mm) | (자료 제시용, 문항 아님. `visual`이 없으면 게이트 **S1-WS-FIGEMPTY**로 실패 — 빈 자료 칸이 조용히 나가는 것을 막는다) |
| `passage` | `text`(`\n`으로 문단, 문단 번호 자동), `title`, `source`, `start`(첫 문단 번호 — 지문을 둘로 나눌 때 이어 매기기) | (읽기 지문, 문항 아님. `{{ }}`로 실제 낱말을 감싼 빈칸 가능, 예: `{{광합성}}`) |

모든 문항에 `obj`(학습 목표 번호, 1부터)를 단다. `points`(배점)는 선택.

`draw`의 `base`/`answer`: 학생이 그 위에 그리는 바탕과, 정답지에만 나오는 정답 그림. 좌표평면이면 `{ "plot": { "x": [-5,5], "y": [-5,5] } }`(직선 없이), `answer`는 같은 범위에 정답 직선·점을 넣은 plot. 지도·도형이면 `<svg>` 문자열 대신 `{geometry}`/`{tikz}` 같은 도해 엔진 형태로 그린다(손그림 `<svg>`는 게이트 **V1-RAWSVG**로 실패). 문항에 "좌표평면·그래프를 그리·지도에·백지도"가 들어가면 `base`가 없을 때 S1-WS-BASE로 실패한다.

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
