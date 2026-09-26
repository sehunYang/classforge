# 이미지 생성 — 브리프 → 프롬프트 → Codex

슬라이드·활동지 `visual`(또는 `figure.svg` 등 어디든)에 손으로 그린 SVG나 선언형 `plot`/`bars` 대신 **실제 생성 이미지**를 쓰고 싶을 때 이 절차를 쓴다.

## 생성 경로 두 가지
기본은 **subscription 경로**다 — 사용자의 ChatGPT 구독 쿼터로 Codex CLI(`codex exec`, 내장 image_generation 도구)를 호출한다. 이 경로는 **모델을 고를 수 없다**(서버가 알아서 고른다) — 그래서 lesson.json에 아무것도 안 쓰면 이 경로가 쓰인다.

특정 모델을 강제로 쓰고 싶으면(예: `gpt-image-2.5-sunburst` 같은 모델명) **api 경로**로 전환된다:
```json
"images": { "model": "gpt-image-2.5-sunburst", "quality": "high" }
```
(`model`은 환경변수 `CLASSFORGE_IMAGE_MODEL`로도 줄 수 있다 — lesson.json 쪽이 우선한다. `quality`는 선택이며 기본값 `high`.) api 경로는 사용자의 **OpenAI API 키로 별도 과금**되며(`OPENAI_API_KEY` 환경변수 필요), `images.mjs`가 Node의 내장 `fetch`로 OpenAI Images API를 **직접** 호출한다(`POST https://api.openai.com/v1/images/generations`, `{model, prompt, size, quality, n:1}`, 응답의 `b64_json` 또는 `url`을 받아 저장 — CLI나 다른 스크립트를 거치지 않는다). 모델 문자열은 **그대로** 넘긴다 — 킷이 모르는 모델이어도 다른 모델로 조용히 바꿔치기하지 않는다. API가 그 모델을(또는 다른 파라미터를) 거부하면 검증되지 않은 다른 모델로 넘어가는 대신 응답 본문의 에러 메시지 그대로 실패한다(`images/<id>.codex.log`에서 확인). `OPENAI_API_KEY` 값은 요청 헤더에만 실리고 어디에도 출력·기록되지 않는다.

`images.model`을 썼는데 `OPENAI_API_KEY`가 없으면 즉시(생성 호출 전에) 안내와 함께 비정상 종료한다 — `--route subscription`을 주면 강제 모델을 무시하고 구독 쿼터 경로로 진행할 수 있다. `--route api|subscription`으로 경로를 직접 지정할 수도 있다(`--route api`인데 키가 없으면 마찬가지로 즉시 실패).

경로별 사이즈 근사가 다르다는 점만 유의: subscription 경로는 `16:9`에 전용 버킷(1792x1024)이 있지만, api 경로(대부분의 GPT Image 계열 모델이 보장하는 레거시 사이즈 4종만 사용)는 `16:9`도 `4:3`과 같은 1536x1024로 근사한다 — 둘 다 각 백엔드가 지원하는 가장 가까운 사이즈일 뿐, 프롬프트의 `AR` 토큰이나 lesson.json의 `ratio` 값은 그대로다.

`images/manifest.json`의 각 항목에 `route`(`subscription`|`api`), `model`(`server-selected` 또는 강제 지정한 모델명), api 경로면 `quality`가 기록된다. 프롬프트가 그대로여도 경로·강제 모델·품질 중 하나라도 바뀌면 캐시를 무시하고 다시 생성한다.

## 언제 이미지, 언제 도해 엔진, 언제 plot/bars인가 (세 갈래 규칙)
손으로 쓴 `<svg>` 삽화는 더 이상 쓰지 않는다(레거시, `design.md`). 정확한 값·라벨·위치 관계가 필요 없는 삽화는 전부 이 절차로 생성 이미지를 쓰고, 그 반대(정확해야 하는 그림)는 도해 엔진이나 선언형 그래프로 남긴다 — 게이트 **V1**이 이 세 갈래 밖의 손그림 SVG를 잡아낸다.
- **이미지(생성, 이 문서)를 쓴다**: 도입부 훅 장면, 실제 자연·사회 현상(프리즘 빛 분산, 도시 스카이라인, 화산 분화 순간…), 표지의 분위기 삽화, 실험 절차의 실제 도구·장치·손 동작(steps), 개념을 돕는 사진 소재, 정리·exit의 여운 있는 장면. **개수 제한이 없다** — 수업에 필요한 만큼 만든다. 약한 손그림으로 이미지를 아끼지 않는다.
- **정밀 도해 엔진(`{tikz}`/`{refraction}`/`{circuit}`/`{particles}`/`{geometry}`/`{vectors}`)을 쓴다**: 라벨이 붙는 구조도·단면도(위치 관계가 정답의 일부), 광선 추적, 회로도, 입자 모형, 기하 작도처럼 **정확한 값·라벨·위치 관계가 채점·이해에 들어가는 그림**. 생성 이미지는 개수·각도·비율을 보장하지 못하므로 이런 그림에는 절대 쓰지 않는다.
- **선언형 `plot`/`bars`를 쓴다**: 좌표평면·함수 그래프·막대그래프(수치가 정확해야 함).
- 판단이 애매하면: "이 그림의 개수·각도·위치가 틀리면 오개념이 생기는가?"(도해 엔진/plot) vs "이 그림이 없어도 수업은 되지만 있으면 더 와닿는가?"(이미지).

### 예외 — 판정 슬라이드는 이미지를 쓰지 않는다
`meta.profile:"evidence"`에서 대립 설명(`compare`, rival) 바로 다음 판정 슬라이드는 위 규칙과 무관하게 **AI 이미지를 시각 자료로 쓰지 않는다**(게이트 **V1-JUDGEIMG**). 판정은 개수·질량·부피 같은 정확한 관찰값으로 갈라야 하는데, 생성 이미지는 그 값을 화면에 보장하지 못한다 — 예를 들어 "반응 전후 흙의 질량이 같다"를 저울 **사진**으로 보여주면 눈금의 실제 수치를 확인할 길이 없다. 판정 슬라이드는 `{plot}`/`{bars}`나 도해 엔진(`{particles}` 등)으로 실제 값·관계를 그리거나, 시각 자료 없이 `evidence`만 인용하는 quiz 판정으로 대신한다. 같은 역사적 실험을 보여주는 `hook` 등 판정 슬라이드가 아닌 자리에는 이미지를 그대로 쓸 수 있다.

### 경고 — 수치 결과를 말하는 diagram은 되도록 이미지를 피한다
`diagram` 슬라이드의 캡션이 단위 붙은 숫자(g·kg·파운드·분·℃·A·V·kPa 등)로 결과를 말하는데 시각 자료가 AI 이미지면 게이트가 **V1-NUMIMG**로 경고한다(FAIL은 아니다) — 이미지는 그 수치를 정확히 보장하지 못하니, 가능하면 `{plot}`/`{bars}`나 도해 엔진으로 바꾼다.

### 구조가 중요한 장치는 사진만으로 끝내지 않는다 (게이트 V1-APPARATUS)
회로·배선·전류계·전압계·광전관·검전기·분광기·광학 장치처럼 **연결·배선·기하가 정답의 일부인 장치**는 생성 이미지가 그 구조를 보장하지 못한다(사진 속 광전관이 실제로는 그냥 진공관처럼 보이거나, 회로가 실제로 연결돼 있는지 사진만으로는 확인할 수 없다). brief에 이런 낱말이 있는 이미지를 쓰면:
- **같은 슬라이드**에 그 장치의 정밀 도해(`{circuit}`/`{tikz}`/`{refraction}`/`{geometry}` 등)를 함께 넣거나,
- 캡션에 **"장면 사진 — 연결은 도해 참고"**처럼 "도해"라는 낱말을 넣어 이 이미지가 분위기용임을 밝히고, **인접 슬라이드**(바로 앞이나 뒤)에 그 정밀 도해를 실제로 둔다.

둘 다 없으면 게이트가 잡는다 — 일반 수업은 **경고**(V1-APPARATUS), `meta.profile:"evidence"`는 정확성 기준이 더 높으므로 **FAIL**이다.

### 입자·전자·광자는 되도록 그리지 않는다
전자·광자·분자 같은 입자는 사진으로 찍을 수 없는 대상이라 생성 이미지가 **빛나는 공 + 궤적** 같은 상투적이고 부정확한 모습으로 그리기 쉽다(예: 튀어나오는 광전자를 빛나는 구슬처럼 그리는 것 — 실제로는 눈에 보이지 않는다). 이런 장면은:
- 가능하면 아예 안 그린다(장치·현상의 결과만 사진으로 보여준다 — 예: 검전기 금속박이 오므라드는 모습),
- 꼭 입자 움직임을 보여야 하면 생성 이미지가 아니라 **도해**(`{particles}` 등)로 그린다. 생성 이미지에 "전자", "광자" 같은 낱말을 brief에 넣지 않는다.

### 캡션이 주장하는 상태를 이미지가 그대로 보여줘야 한다
"금속박이 오므라든다"는 캡션 옆에 금속박이 벌어진 사진을 쓰면 안 된다 — 그림과 글이 다른 말을 하면 학생이 헷갈린다(SKILL.md 7단계 도메인 검토가 잡지만, brief를 쓸 때부터 캡션과 같은 상태를 명시한다). 아래 "단계 상태 이어가기"의 `state`/`mustShow`/`mustNotShow`를 정지 장면 하나짜리 이미지에도 그대로 쓸 수 있다.

## 단계 상태 이어가기 (steps 실험 절차의 물리적 연속성)
실험 절차 여러 장을 생성 이미지로 이을 때 가장 흔한 사고는 **앞 단계에서 바뀐 물리적 상태가 다음 단계 이미지에 안 이어지는 것**이다(예: 탈색 단계 다음 요오드 반응 단계인데 잎이 여전히 초록색으로 나옴 — 실제 블라인드 테스트에서 나온 사고). `{image:{...}}` 요청에 다음 필드를 쓰면 `images.mjs`가 자동으로 이어 붙인다:

```json
{ "id": "iodine-step-3", "role": "step", "style": "photo",
  "brief": "완전히 탈색되어 하얗게 된 잎에 요오드 용액을 떨어뜨리는 순간",
  "state": "완전히 탈색되어 하얗게 된 잎, 그 위에 갈색 요오드 용액이 막 떨어지는 순간",
  "mustShow": ["하얗게 탈색된 잎", "갈색 요오드 용액 방울"],
  "mustNotShow": ["초록색 잎", "green leaf"]
}
```
- **`state`**(선택): 이 이미지가 보여줘야 할 물리적 상태를 한 문장으로 적는다. 컴파일된 프롬프트 끝에 "Must depict this exact state: …"로 붙는다.
- 같은 `steps` 슬라이드 안에서, **바로 앞 단계**의 `state`가 있으면 자동으로 "Starts from this exact prior state: …"로 이어 붙는다 — 작성자가 직접 반복해 쓸 필요 없다(단계 순서대로 자동 연결, `images.mjs`의 `stepChainPrevStates`).
- **`mustShow`/`mustNotShow`**(선택, 문자열 배열): "반드시 보여야 함/보이면 안 됨" 목록. `mustNotShow`는 공냥 프롬프트 킷의 부정문 금지 목록(no/without/avoid 등)에 걸리지 않는 "Must not show: …" 형태로 붙는다 — 그래도 `state`/`mustShow`로 원하는 결과를 긍정형으로 먼저 적는 것이 기본이고, `mustNotShow`는 마지막 안전장치로만 쓴다(부정형 지시는 생성 모델이 정확히 안 지킬 수도 있다).
- 이 절도 `check_prompt.mjs` 검증을 그대로 통과해야 한다(부정문·SD 폐기 어휘를 안 쓰므로 보통 통과한다).
- **상태 사슬 쓰는 법**(실험 절차 예시 — 요오드 반응):
  1. `state: "초록색 잎 한 장, 아직 식물 줄기에 붙어 있는 상태"` (식물에서 떼지 않은 상태부터 시작 — "떼어 낸 잎"으로 갑자기 건너뛰지 않는다)
  2. `state: "잎이 에탄올 물중탕(물이 든 비커 속 시험관)에서 탈색되는 중"`, `mustShow: ["에탄올 시험관이 물이 든 비커 속에 잠긴 물중탕 장치"]`, `mustNotShow: ["에탄올 시험관을 알코올램프 불꽃에 직접 올려놓은 모습"]` — 에탄올은 인화성이라 반드시 물중탕으로 가열한다는 사실을 brief 단계에서부터 못 박는다.
  3. `state: "완전히 탈색되어 하얗게 된 잎, 그 위에 갈색 요오드 용액이 막 떨어지는 순간"`, `mustNotShow: ["초록색 잎", "green leaf"]` — 앞 단계에서 자동으로 이어받은 prevState("탈색되는 중")와 자기 `state`("완전히 하얗게 됨") 둘 다 프롬프트에 들어간다.
  4. `state: "하얗던 잎 표면 중 녹말이 있던 부분이 진한 청람색으로 변한 상태"` — 다시 초록으로 돌아가지 않는다.
- 검증만 하고 싶으면 `--compile-only`로 각 `images/<id>.prompt.txt`를 열어 "Physical state continuity" 절이 이전 단계를 실제로 이어받았는지 확인한다.

## 요청 스키마
```json
"visual": { "image": {
  "id": "prism-light",              // 파일명이 됨 (영문 소문자·숫자·하이픈)
  "brief": "아침 창가, 프리즘을 통과한 햇빛이 벽에 무지개 빛띠를 만드는 장면",
  "role": "hook",                    // hook | concept | cover | background | step | scene
  "ratio": "16:9",                   // (선택) 16:9 | 4:3 | 1:1 | 3:4 — 안 쓰면 role별 기본값(아래 표)
  "style": "photo",                  // photo | illustration | diagram-ish
  "continuity": "같은 초록 콩 모종, 같은 학생 손, 같은 투명 컵",  // (선택) 이 요청의 연속성 힌트 — 아래 "연속성" 참고
  "state": "완전히 탈색되어 하얗게 된 잎",     // (선택) 이 장면이 보여야 할 물리적 상태 — "단계 상태 이어가기" 참고
  "mustShow": ["하얗게 탈색된 잎"],           // (선택) 문자열 배열, 반드시 보여야 할 것
  "mustNotShow": ["초록색 잎"],               // (선택) 문자열 배열, 보이면 안 되는 것(마지막 안전장치로만)
  "purpose": "scene"                          // (선택) scene | evidence | application | apparatus | concept — 아래 "purpose" 참고
  // "prompt": "(선택) 컴파일된 완성 프롬프트 — 없으면 아래 절차로 채운다"
} }
```
`role`은 레이아웃 힌트(빌드가 `cover`는 풀블리드, 그 외(`hook`·`concept`·`background`·`step`·`scene`)는 칸을 `object-fit:cover`로 채우는 둥근 모서리로 다룬다), `style`은 프롬프트 톤 힌트다. `brief`는 한두 문장이면 충분하다 — 세부는 프롬프트 컴파일 단계에서 채운다. **개수 제한은 없다** — 수업에 정말 필요한 만큼 만든다. 약한 SVG 손그림 하나로 이미지 하나를 아끼지 않는다(`references/design.md`).

### role과 기본 ratio (칸 크기 실측 기준, `design.md` "칸 크기 실측")
`ratio`를 안 쓰면 `images.mjs`가 role별 기본값을 자동으로 채운다(실제로 쓰인 값은 `lesson.json`에 그대로 저장되어 다음부터 눈으로 보고 고칠 수 있다).

| role | 쓰는 자리 | 실측 칸(가로×세로) | 기본 ratio |
|---|---|---|---|
| `cover` | 표지 오른쪽 칸 | 722×722 | `4:3` |
| `hook` | 훅 오른쪽 칸 | 846×774 | `16:9` |
| `concept` | 개념 오른쪽 칸 | 792×582(≈4:3) | `4:3` |
| `diagram`(role은 `scene`이나 `concept`을 그대로 씀) | 전체 폭 | 1696×598(≈3:1) | `16:9`(지원 4종 중 가장 가까운 가로형 — 위아래가 `object-fit:cover`로 잘린다) |
| `step` | steps 각 단계 칸 | 380×260(≈3:2) | `4:3` |
| `scene`·`background` | compare(대비형) 좌우 칸, bignum, activity(단계 목록 옆 칸, 927×856), exit·summary(735×856), 그 외 일반 칸 채움 | 칸마다 다름 | `4:3` |

### steps(실험 절차) 브리프 쓰는 법
각 단계 이미지는 "그 단계에서 실제로 손이 하는 일"을 보여 줘야 한다 — 도구·재료·손 동작이 사진에 실제로 보이게 브리프를 쓴다(예: "학생 손이 스포이트로 비커에 요오드 용액 두 방울을 떨어뜨리는 순간, 클로즈업"). **화면에 글자를 넣지 않는다** — 단계 번호·이름은 slides.js가 `steps[].h`/`t`로 이미지 아래 캡션에 얹는다. 연속된 단계(1~4)는 같은 소재(같은 잎, 같은 비커, 같은 학생 손)를 그리도록 `continuity`(요청별) 또는 `images.subject`(레슨 전체)로 못 박는다(아래 "연속성").

### `purpose` — 이 이미지가 화면에서 하는 일
값: `scene`(장면 묘사, 기본적인 분위기·상황), `evidence`(판정·주장의 근거를 보여줌), `application`(배운 개념을 실생활에 적용하는 예), `apparatus`(실험 장치·도구), `concept`(개념 설명을 돕는 그림). 형식은 `images.mjs`가 검증하지만(다섯 값 중 하나인지만), 그 값이 자리에 맞는지는 **`impl-gates`가 추가할 별도 게이트**가 확인할 예정이다 — 지금은 값을 정확히 붙여 두는 것이 중요하다.

**`exit`·`summary`의 이미지는 `purpose`가 `evidence` 또는 `application`이어야 하고, 그 이미지가 왜 거기 있는지 설명하는 `caption`이 있어야 한다.** 단순히 "여운을 주는 장면"(`scene`)이라면 exit·summary에는 아예 이미지를 넣지 않는다 — 수업을 정리하는 마지막 화면은 장식보다 "오늘 배운 것의 증거"나 "이게 어디에 쓰이는지"를 보여주는 편이 낫다. 예: exit에서 "일상에서 이 원리가 쓰이는 예"(application) 사진 + "이 현상도 같은 원리로 설명됩니다"라는 캡션.

## 이어가기 그룹 — 그룹 전체를 함께 다시 만든다
같은 `steps` 슬라이드의 단계 이미지들, 또는 `continuity`(요청별)나 `images.subject`(레슨 전체)가 서로 같은 이미지들은 **한 그룹**이다. `node scripts/images.mjs <lesson.json>`(플래그 없이)을 실행하면, 그룹 안 어느 하나라도 캐시가 낡았으면(프롬프트가 바뀌었거나 경로/모델이 바뀌었거나) **그 그룹 전체**를 문서 순서대로 함께 다시 만든다 — 하나만 새로 만들면 이어지던 장면이 끊긴다(실제 사고: continuity 문구를 바꿨는데 4단계 중 1장만 다시 만들어 나머지 3장이 옛 설정으로 남음 — `I1-STALE`이 사후에야 잡아냈다). 콘솔에 `이어가기 그룹 확장: …도 함께 다시 만듭니다`가 뜨면 이 확장이 일어난 것이다.

**`--only id1,id2`**: 지정한 id만(캐시 여부와 무관하게) 강제로 다시 만든다. 이 id가 속한 그룹에 `--only`에 안 넣은 다른 멤버가 있으면 경고만 뜨고(막지는 않는다) 지정한 것만 다시 만든다 — 한 장만 결과가 나빠 그 한 장만 고쳐 다시 만들고 싶을 때 쓴다. 그룹 전체를 바꿔야 하는 상황(예: continuity 문구 자체를 바꿈)이면 `--only` 없이 플래그 없는 기본 실행을 쓴다.

## 브리프 근접 중복 경고 (컴파일 시점, 차단하지 않음)
`--compile-only`(또는 실제 생성) 실행 중 같은 수업 안에서 서로 다른 이미지 두 개의 brief가 낱말을 많이 공유하면(예: 표지 이미지와 개념 설명 이미지가 사실상 같은 장면을 묘사) `[DUP?]` 경고가 뜬다 — 이어가기 그룹(위, 같은 continuity·같은 steps 슬라이드)끼리는 원래 비슷해야 정상이므로 비교하지 않는다. 경고가 뜨면 두 이미지 중 하나를 다른 장면·다른 각도로 바꾸거나, 정말 같은 장면이 맞으면(예: 표지가 훅 장면을 그대로 재사용) `continuity`를 같게 써서 의도된 반복임을 명시한다.

## 절차
1. lesson.json에 `visual: { "image": {...} }`를 쓴다(`prompt` 없이).
2. `node scripts/images.mjs <lesson.json> --compile-only`를 실행한다. `prompt`가 없는 요청마다 `images/<id>.brief.md`가 생기고, 스크립트는 비정상 종료(exit 2)하며 빠진 목록을 출력한다.
3. 각 브리프를 **공냥 프롬프트 킷**(`vendor/prompt-kit/skills/image-prompt/`)의 마스터 템플릿으로 완성 프롬프트로 컴파일한다(아래 "컴파일 규칙"·예시 참고).
4. 완성 프롬프트를 lesson.json의 `image.prompt`에 직접 쓰거나, `images/<id>.prompt.txt`로 저장한다.
5. `--compile-only`를 다시 실행 — `node vendor/prompt-kit/.../check_prompt.mjs`로 검증하고, 교실 안전 문구를 자동으로 붙인다(이미 있으면 건너뜀). 모두 `[OK]`가 뜨면 통과(exit 0). 통과하면 이어서 `(dry-run) ...을 실행하면 다시 만들 이미지 N개: ...`가 뜬다 — 실제로 생성하지는 않고, 지금 플래그 없이 실행하면 무엇이 새로 만들어질지(이어가기 그룹 확장 포함)만 미리 보여준다.
6. `node scripts/images.mjs <lesson.json>`(플래그 없이)로 실제 생성 — 기본은 subscription 경로(구독 쿼터, 모델 자동 선택). 이미지당 약 1분, 기본 동시성 2(`--concurrency 3`처럼 늘릴 수 있다 — 이미지가 10장을 넘어도 오래 걸리지 않게). 결과: `images/<id>.png`(원본), `images/<id>.web.webp`(임베딩용 축소본), `images/manifest.json`(해시+경로+모델 캐시 — 프롬프트·경로·강제 모델이 그대로면 재실행해도 다시 생성하지 않는다. 강제 재생성은 `--force`). 특정 모델을 강제하려면 위 "생성 경로 두 가지"대로 `images.model`을 쓰고 `OPENAI_API_KEY`를 설정하거나 `--route api`/`--route subscription`으로 직접 고른다. **개수 제한은 없다** — 수업에 필요하면 몇 장이든 만든다.
7. 실패하면 `images/<id>.codex.log`를 읽는다. 1회 자동 재시도 후에도 실패하면 비정상 종료한다.

## 문제 해결

**실패해도 기존 이미지는 안전하다.** 각 시도는 임시 파일에 생성한 뒤 시그니처·크기/비율·provenance·중복 해시 검사를 전부 통과해야만 최종 `<id>.png`/`<id>.web.*`로 원자적 교체(rename)된다 — 시도가 실패해도 지난 성공분과 `manifest.json` 항목은 절대 지워지거나 덮어써지지 않는다. 안심하고 재시도(`--only <id> --force`)해도 된다.

**Codex 인증 오류(401)** — subscription 경로에서 `images/<id>.codex.log`에 `401 Unauthorized: Incorrect API key ...`가 보이면(주로 `Falling back from WebSockets to HTTPS transport` 경고 직후), 계정의 ChatGPT 로그인 세션이 갱신이 필요한 상태인 경우다(관찰 사례: 몇 시간 유휴 후 발생, 별다른 조치 없이도 몇 시간 뒤 저절로 풀림). images.mjs는 이 패턴을 감지하면 같은 실행에 남은 다른 이미지들을 더 시도하지 않고 바로 중단한다(전부 같은 이유로 실패할 것이 거의 확실하므로) — 콘솔에 `Codex 인증 오류(401) — 잠시 뒤 다시 실행하거나 codex login으로 다시 로그인하세요. 기존 이미지는 그대로 남아 있습니다.`가 뜨고 비정상 종료(exit 1)한다. 대처: 잠시 뒤 그대로 다시 실행하거나, `codex login`으로 다시 로그인한 뒤 재실행한다 — 위 원자적 교체 덕분에 이미 만들어져 있던 이미지들은 이 오류와 무관하게 그대로 남아 있다.

## 정리(`--prune`) — lesson.json에서 지운 이미지 요청 뒷정리
슬라이드를 고치며 `{image:{...}}` 요청을 지우거나 id를 바꾸면, 그 이미지 파일과 manifest 항목은 `images/`에 그대로 남는다(용량만 차지, 빌드·게이트에는 영향 없음). `node scripts/images.mjs <lesson.json> --prune`을 실행하면 지금 lesson.json이 참조하지 않는 모든 id를 찾아 그 파일들(`<id>.png`·`<id>.web.*`·`<id>.prompt.txt`·`<id>.codex.log`·`<id>.brief.md`)을 `images/_unused/`로 옮기고 manifest에서 항목을 뺀 뒤 옮긴 id 목록을 출력한다. **지우지 않고 옮기기만 한다** — 되돌리려면 `_unused/`에서 다시 꺼내면 된다. 참조하는 이미지가 없으면(0개) "옮길 것 없음"만 출력하고 끝난다.

## 컴파일 규칙 (Format A, 5섹션만)
`vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿 6섹션 중 **Text-in-image는 쓰지 않는다** — classforge 이미지에는 글자를 절대 렌더링하지 않는다(글자는 HTML 레이어가 얹는다). 나머지 5섹션은 그대로:

| # | 섹션 | 씀 |
|---|---|---|
| 1 | `Scene:` | 누가·무엇이·어디서·무엇을. 60~120어. 학년에 맞는 소재(실제 인물 대신 가상의 학생·인물, 실존 브랜드·캐릭터 금지) |
| 2 | `Camera:` | 시점·거리·렌즈 character. `references/photo-vocab.md` §1·§5 어휘 |
| 3 | `Lighting:` | 방향·soft/hard·그림자. `photo-vocab.md` §2 |
| 4 | `Color grading:` | 팔레트 + 색온도 + **HEX 3~5개**(장면에 맞는 색. 교실 안전 문구가 고정 팔레트 `#3B1E54 #7A5C9E #FF6F61 #F8F6FA`를 보조 힌트로 자동으로 붙인다 — `lib.mjs`의 `PALETTE`) |
| 5 | `Texture/Medium:` | 매체·질감. `photo-vocab.md` §6 |
| — | 트레일링 | 끝에 `AR <ratio>` 토큰만(예: `AR 16:9`) |

`images.mjs`가 검증 직전에 항상 아래 교실 안전 문구를 (없으면) 자동으로 붙이므로 작성자가 직접 쓸 필요는 없지만, 원칙은 알아 둔다:
- **부정문 대신 결과 상태로**: "글자 없이"(O) / "no text"(X, 검증기가 화이트리스트 밖 영어 부정문으로 막는다). 한국어는 "없이/없는"까지는 되지만 "~하지 마/~금지/~없어야" 같은 지시형은 경고가 뜬다.
- **워터마크·로고 제거**는 `clean, brand-free, copy-free finish`(공냥 킷의 권장 긍정 표현, `photo-vocab.md` §6).
- 프롬프트 안에 **따옴표(" " ' ')를 쓰지 않는다** — 따옴표가 있으면 검증기가 "렌더 텍스트가 있다"고 판단해 다른 규칙이 걸린다.
- SD 시대 폐기 어휘(`masterpiece`, `4k`, `highly detailed`, 가중치 `(word:1.3)`, `--ar` 같은 미드저니 플래그)는 전부 금지 — 이미 `check_prompt.mjs`가 잡는다.
- `AR`은 lesson.json의 `ratio`와 반드시 같아야 한다.

## 검증만 하고 싶을 때
```bash
node vendor/prompt-kit/skills/image-prompt/scripts/check_prompt.mjs images/<id>.prompt.txt
```
`{ok:true, errors:[]}`가 나와야 한다. `errors`가 있으면 `hint`대로 고친다. `warnings`는 통과를 막지 않지만 확인해 둔다.

## 워크드 이그잼플 1 — 초6 과학: 프리즘과 빛의 분산 (hook)
브리프: `"아침 햇빛이 프리즘을 통과해 벽에 무지개 빛띠를 만드는 장면, 학생이 신기해하며 관찰"`, role `hook`, ratio `16:9`, style `photo`.

```
Scene: 교실 창가 책상, 세모기둥 유리 프리즘 위로 아침 햇살이 비스듬히 들어와 통과하면서 뒤편 흰 벽에 빨강에서 보라까지 이어지는 무지개 빛띠가 넓게 펼쳐진다. 앞쪽에는 초등학생 한 명이 등을 보인 채 몸을 기울여 빛띠를 관찰하는 실루엣만 살짝 걸쳐 있다.
Camera: 아이레벨, 프리즘에서 약 50cm 거리의 3/4 앵글, natural perspective, 빛띠와 프리즘이 모두 선명하게 보이는 deep focus.
Lighting: 창을 통한 낮은 각도의 자연광, warm morning light, 빛줄기 자체가 은은하게 보이는 옅은 광선(god ray) 느낌.
Color grading: 따뜻한 아침 톤, warm 3200K-feel, 무지개 빛띠는 선명하게, 배경은 차분하게. 팔레트 #F8F6FA #3B1E54 #7A5C9E #FF6F61.
Texture/Medium: 자연광 사진 느낌, matte, subtle film grain, 과장 없는 사실적 질감.
AR 16:9
```
(이 뒤에 `images.mjs`가 교실 안전 문구를 자동으로 붙인다.)

## 워크드 이그잼플 2 — 중2 사회: 도시화로 달라진 스카이라인 (cover)
브리프: `"20세기 초 저층 마을과 오늘날 고층 스카이라인을 한 화면 위아래로 대비"`, role `cover`, ratio `4:3`, style `illustration`.

```
Scene: 화면을 위아래로 나눈 대비 구도. 위쪽은 낮은 기와지붕과 골목이 이어진 옛 마을, 아래쪽은 같은 위치에 들어선 유리 고층 빌딩 스카이라인 — 지평선 위치와 원경 산 능선을 똑같이 맞춰 같은 장소임을 알 수 있게 한다.
Camera: 정면 아이레벨, 넓은 파노라마 구도, 두 장면 모두 화면 폭을 가득 채움.
Lighting: 위쪽은 부드러운 오후 자연광과 따뜻한 그림자, 아래쪽은 유리 외벽에 반사되는 차분한 하늘빛.
Color grading: 위쪽 세피아 계열 warm tone, 아래쪽 쿨톤 도시 팔레트로 대비. 팔레트 #3B1E54 #F8F6FA #7A5C9E #1C1E24.
Texture/Medium: 평면화된 편집 일러스트, 옅은 그레인, 인쇄 매체 톤.
AR 4:3
```

## 수업 전체 일관성 (`images.style`·연속성)
한 수업 안의 이미지 여러 장이 서로 다른 스타일로 보이지 않도록, lesson.json 최상위 `images`에 `style`을 쓰면 `images.mjs`가 이를 모든 프롬프트 끝(교실 안전 문구 바로 앞)에 자동으로 붙인다 — 작성자가 프롬프트마다 팔레트·조명을 반복해 쓸 필요가 없다.
```json
"images": {
  "style": { "palette": "#F8F6FA #3B1E54 #7A5C9E #FF6F61", "lighting": "soft daylight, natural window light", "medium": "clean educational photo, neutral lab bench" },
  "subject": "같은 초록 콩 모종 하나, 같은 학생 손, 같은 투명 플라스틱 컵"   // (선택) 레슨 전체 연속성 — 실험 절차(steps)처럼 같은 소재가 이어지는 수업에 쓴다
}
```
- `style.palette`/`lighting`/`medium`은 각각 생략 가능하다 — 있는 것만 합쳐 한 문장으로 붙는다.
- **연속성**: 실험 절차(steps)처럼 여러 장이 "같은 장면의 다음 순간"이어야 할 때, 레슨 전체에 `images.subject`를 쓰거나(모든 이미지에 공통 적용) 이미지별로 `image.continuity`(개별 요청, `images.subject`보다 우선)를 써서 "같은 잎·같은 비커·같은 손"처럼 구체적인 소재를 못 박는다. 그래도 생성 이미지는 매번 새로 그려지는 것이라 얼굴·소품이 완벽히 동일하게 나오지는 않는다 — 캡션·라벨이 그 차이를 가리키지 않게(`design.md` 육안 검수) 확인한다.
- `style`/`continuity`가 만든 절도 여느 절과 마찬가지로 `check_prompt.mjs` 검증을 통과해야 한다(부정문·SD 폐기 어휘를 안 쓰므로 보통 그대로 통과한다).
- `images/<id>.prompt.txt`를 열어 보면 이 절이 실제로 어떻게 붙었는지 확인할 수 있다.

## 빌드 통합
`images.mjs`는 lesson.json과 `images/manifest.json`만 쓴다. `build.mjs`는 `visual`이 `{image:{id}}` 형태면 `images/manifest.json`에서 `id`로 항목을 찾아 `web`(축소본, 없으면 `file` 원본)을 base64로 임베딩한다(`embedImage()`, `scripts/build.mjs`) — `cover`·`hook`·`concept`·`diagram`·`compare`·`steps`·`bignum`·활동지 `figure` 등 `visual`을 받는 자리라면 어디든 그대로 통한다. `role`이 `cover`면 그 슬라이드의 이미지 칸을 슬라이드 가장자리까지 풀블리드로, 그 외(`hook`·`concept`·`background`·`step`·`scene`)는 `object-fit:cover`에 둥근 모서리를 준 칸 채움으로 넣어 비율이 달라도 칸을 꽉 채우고 찌그러지지 않는다(`templates/deck.css`·`templates/print.css`의 `img-fill`/`bleed` 클래스). 라벨(단계 이름 등)은 이미지 위에 얹지 않고 항상 그 칸 아래 HTML 캡션(`steps[].h`/`t`, `caption`)으로 따로 그린다. 매니페스트에 해당 `id`가 없거나 파일이 없으면 build.mjs가 "먼저 images.mjs를 실행하세요" 에러로 즉시 멈춘다. 검사는 게이트 I1(프롬프트·캐시·해상도)과 V1(어디에 이미지·도해가 있어야 하는지, 손그림 SVG 금지) — `references/gates.md`.
