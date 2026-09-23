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

## 언제 이미지, 언제 SVG/plot인가
- **이미지(생성)를 쓴다**: 도입부 훅 장면, 실제 자연·사회 현상(프리즘 빛 분산, 도시 스카이라인, 화산 분화 순간…), 표지의 분위기 삽화. "그림이 예뻐야" 학생이 흥미를 느끼는 자리.
- **SVG/plot을 그대로 쓴다(design.md)**: 좌표평면·함수 그래프·막대그래프(수치가 정확해야 함), 라벨이 붙는 구조도·단면도(위치 관계가 정답의 일부), 지도(해안선 등 사실 관계). **정확한 값·라벨·위치 관계가 채점·이해에 들어가는 그림은 항상 SVG/plot**으로 남긴다 — 생성 이미지는 값을 보장하지 않는다.
- 판단이 애매하면: "이 그림이 틀리면 오개념이 생기는가?"(SVG/plot) vs "이 그림이 없어도 수업은 되지만 있으면 더 와닿는가?"(이미지).

## 요청 스키마
```json
"visual": { "image": {
  "id": "prism-light",              // 파일명이 됨 (영문 소문자·숫자·하이픈)
  "brief": "아침 창가, 프리즘을 통과한 햇빛이 벽에 무지개 빛띠를 만드는 장면",
  "role": "hook",                    // hook | concept | cover | background
  "ratio": "16:9",                   // 16:9 | 4:3 | 1:1 | 3:4
  "style": "photo"                   // photo | illustration | diagram-ish
  // "prompt": "(선택) 컴파일된 완성 프롬프트 — 없으면 아래 절차로 채운다"
} }
```
`role`은 레이아웃 힌트(빌드가 hook·cover는 풀블리드, concept·background는 칸 채움으로 다룬다), `style`은 프롬프트 톤 힌트다. `brief`는 한두 문장이면 충분하다 — 세부는 프롬프트 컴파일 단계에서 채운다.

## 절차
1. lesson.json에 `visual: { "image": {...} }`를 쓴다(`prompt` 없이).
2. `node scripts/images.mjs <lesson.json> --compile-only`를 실행한다. `prompt`가 없는 요청마다 `images/<id>.brief.md`가 생기고, 스크립트는 비정상 종료(exit 2)하며 빠진 목록을 출력한다.
3. 각 브리프를 **공냥 프롬프트 킷**(`vendor/prompt-kit/skills/image-prompt/`)의 마스터 템플릿으로 완성 프롬프트로 컴파일한다(아래 "컴파일 규칙"·예시 참고).
4. 완성 프롬프트를 lesson.json의 `image.prompt`에 직접 쓰거나, `images/<id>.prompt.txt`로 저장한다.
5. `--compile-only`를 다시 실행 — `node vendor/prompt-kit/.../check_prompt.mjs`로 검증하고, 교실 안전 문구를 자동으로 붙인다(이미 있으면 건너뜀). 모두 `[OK]`가 뜨면 통과(exit 0).
6. `node scripts/images.mjs <lesson.json>`(플래그 없이)로 실제 생성 — 기본은 subscription 경로(구독 쿼터, 모델 자동 선택). 이미지당 약 1분, 기본 동시성 2. 결과: `images/<id>.png`(원본), `images/<id>.web.webp`(임베딩용 축소본), `images/manifest.json`(해시+경로+모델 캐시 — 프롬프트·경로·강제 모델이 그대로면 재실행해도 다시 생성하지 않는다. 강제 재생성은 `--force`). 특정 모델을 강제하려면 위 "생성 경로 두 가지"대로 `images.model`을 쓰고 `OPENAI_API_KEY`를 설정하거나 `--route api`/`--route subscription`으로 직접 고른다.
7. 실패하면 `images/<id>.codex.log`를 읽는다. 1회 자동 재시도 후에도 실패하면 비정상 종료한다.

## 컴파일 규칙 (Format A, 5섹션만)
`vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿 6섹션 중 **Text-in-image는 쓰지 않는다** — classforge 이미지에는 글자를 절대 렌더링하지 않는다(글자는 HTML 레이어가 얹는다). 나머지 5섹션은 그대로:

| # | 섹션 | 씀 |
|---|---|---|
| 1 | `Scene:` | 누가·무엇이·어디서·무엇을. 60~120어. 학년에 맞는 소재(실제 인물 대신 가상의 학생·인물, 실존 브랜드·캐릭터 금지) |
| 2 | `Camera:` | 시점·거리·렌즈 character. `references/photo-vocab.md` §1·§5 어휘 |
| 3 | `Lighting:` | 방향·soft/hard·그림자. `photo-vocab.md` §2 |
| 4 | `Color grading:` | 팔레트 + 색온도 + **HEX 3~5개**(교과 강조색 계열 권장 — `lib.mjs`의 `ACCENTS`) |
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
Color grading: 따뜻한 아침 톤, warm 3200K-feel, 무지개 빛띠는 선명하게, 배경은 차분하게. 팔레트 #F7F4EC #0B7A6A #2952CC #FBD34D.
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
Color grading: 위쪽 세피아 계열 warm tone, 아래쪽 쿨톤 도시 팔레트로 대비. 팔레트 #B4480E #F7F4EC #2952CC #4B5563.
Texture/Medium: 평면화된 편집 일러스트, 옅은 그레인, 인쇄 매체 톤.
AR 4:3
```

## 빌드 통합
`images.mjs`는 lesson.json과 `images/manifest.json`만 쓴다. `build.mjs`는 `visual`이 `{image:{id}}` 형태면 `images/manifest.json`에서 `id`로 항목을 찾아 `web`(축소본, 없으면 `file` 원본)을 base64로 임베딩한다(`embedImage()`, `scripts/build.mjs`). `role`이 `cover`면 그 슬라이드의 이미지 칸을 슬라이드 가장자리까지 풀블리드로, `hook`이면 배정된 칸을 `object-fit:cover`로 가득 채우고, 그 외(`concept`·`background`)는 `object-fit:cover`에 둥근 모서리를 준 칸 채움으로 넣는다(`templates/deck.css`·`templates/print.css`의 `img-fill`/`bleed` 클래스). 매니페스트에 해당 `id`가 없거나 파일이 없으면 build.mjs가 "먼저 images.mjs를 실행하세요" 에러로 즉시 멈춘다. 검사는 게이트 I1(`references/gates.md`).
