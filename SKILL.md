---
name: classforge
description: 학교 수업 자료 제작 스킬 — 수업 주제 하나로 교실 프로젝터용 HTML 슬라이드, A4 학생 활동지와 정답지 PDF, 교수·학습 과정안(지도안) PDF를 함께 만들고 17개 자동 품질 게이트와 캡처 육안 검수를 통과시킨다. 교사가 채운 수업 설계서(.md)나 생성 이미지 삽화도 반영한다. "수업 자료 만들어줘", "수업 PPT", "수업 슬라이드", "학습지/활동지 만들어줘", "지도안/교수학습 과정안", "N학년 OO 단원 N차시 수업 준비", "형성평가 문항", "공개수업 자료" 같은 요청에 사용한다. 초·중·고 전 교과 대상.
---

# classforge — 수업 자료 한 벌 만들기

수업 주제 하나를 **lesson.json** 한 파일로 설계하면, 검증된 템플릿이 네 가지 산출물을 만든다.

| 산출물 | 파일 | 용도 |
|---|---|---|
| 수업 슬라이드 | `out/slides.html` (+`slides.pdf`) | 교실 프로젝터. 글꼴을 파일 안에 넣어 인터넷 없이 어느 PC에서나 같게 보인다. →/Space 넘김, 단계 공개, 퀴즈 정답 공개, 활동 타이머(T), 발표자 노트(N) |
| 학생 활동지 | `out/worksheet.pdf` | A4 인쇄. 정답 글자는 파일에 아예 들어가지 않는다 |
| 정답지 | `out/answer-key.pdf` | 같은 배치에 정답과 풀이 |
| 교수·학습 과정안 | `out/lesson-plan.pdf` | A4 가로. 도입·전개·정리, 평가 계획, 예상 질문 |

원칙 (강의 「ChatGPT Astra 업무자동화」와 공냥이 공개 스킬들에서 가져옴):
- **목적을 먼저 분명히** — 학습 목표에서 거꾸로 설계한다(목표 → 평가 문항 → 활동 → 슬라이드).
- **내용과 디자인을 분리** — 작성자는 lesson.json의 내용과 슬라이드 유형만 고른다. 레이아웃은 템플릿이 책임진다. 새 레이아웃을 발명하지 않는다.
- **게이트는 물리적 브레이크** — 스스로 "잘 됐다"고 판단하지 말고 `gate.mjs`가 exit 0을 낼 때까지 고친다. 그다음 캡처를 직접 본다.
- **수치는 출처가 있을 때만** — 화면·활동지의 모든 수치는 `facts`에 출처와 함께 있어야 한다(S4 게이트가 대조).
- **끝나면 회고** — 무엇이 게이트에 걸렸고 어떻게 고쳤는지 `retro.md`에 남긴다.

`SKILL_DIR` = 이 파일이 있는 폴더.

## 절차

### 0. 준비 확인 (처음 한 번)
```bash
cd "$SKILL_DIR" && [ -d node_modules/playwright-core ] || npm install
python -c "import fontTools" || pip install fonttools
```
Chrome(또는 Edge)이 필요하다. 다른 경로면 `CLASSFORGE_CHROME` 환경변수로 지정.

### 1. 입력 확인
교사가 수업 설계서를 채워 줬다면(`templates/수업설계서.md` 양식, 전부든 일부든) `intake.mjs`로 먼저 파싱하고 아래 질문은 건너뛴다(`references/intake.md`). 설계서가 없으면 요청에서 다음을 뽑는다. 빠진 것 중 **성취기준과 학교급/학년만** 물어보고 나머지는 합리적으로 정한 뒤 알린다.
- 학교급(`elem`/`middle`/`high`)·학년, 교과, 단원, 차시(예: 4/9차시), 수업 시간(초 40분, 중 45분, 고 50분)
- 성취기준: 교사가 준 원문을 그대로 쓴다. 받지 못했으면 코드는 비우고 `"verified": false`로 둔다. **성취기준 코드도 문장도 지어내지 않는다** — 원문이 없으면 text에 정확히 `"(교사 입력 필요)"`만 쓴다. 지도안에 그대로 표시된다.
- 수업 형태(모둠/짝/개인), 준비물 제약, 참고 자료(교과서 쪽, 기존 PPT·학습지 사진)

### 2. 참고 자료가 있으면 거꾸로 풀기
교사가 기존 자료나 마음에 드는 슬라이드 이미지를 주면, 베끼지 말고 구조만 읽는다: 어떤 순서로 무엇을 보여 주는지 → classforge 슬라이드 유형 중 무엇에 해당하는지 → 그 대응표를 설계에 반영. 이미지·문장을 그대로 옮기지 않는다.

### 3. 수업 설계 (거꾸로 설계)
`references/pedagogy.md`를 따른다. 순서:
1. 학습 목표 1~3개 — 관찰 가능한 동사 + "~할 수 있다."
2. `facts` — 쓸 수치·사실과 출처(교과서, 공공기관). 모르면 수치를 쓰지 않는다.
3. 활동지 문항 — 각 문항에 `obj`(몇 번 목표를 확인하는지). 목표마다 1문항 이상.
4. 지도안 흐름 — 도입·전개·정리, 분 합계 = 수업 시간.
5. 슬라이드 12~16장 — `references/slides.md`의 유형 카탈로그와 권장 흐름.

### 4. lesson.json 작성
작업 폴더에 `<주제-slug>/lesson.json`을 만든다. 스키마는 `references/lesson-schema.md`, 완성 예시는 `examples/season/lesson.json`(초6 과학). 삽화는 `references/design.md`의 SVG 규칙대로 **직접 그린다**(테마 클래스 사용, 글자 라벨은 최소 28px). 정확한 값·라벨이 필요 없는 도입부 훅·표지·실제 사진 장면은 SVG 대신 5단계의 생성 이미지를 쓸 수 있다. 증거 중심 탐구 수업(공식·주장 옆에 근거를 바로 붙이고, 대립 설명은 대칭 배치 후 다음 장에서 판정)으로 설계하려면 `meta.profile: "evidence"`를 쓴다(`references/pedagogy.md` §10, `references/design.md`).

### 5. 이미지 요청이 있으면 생성
`visual`에 `{image:{...}}`를 쓴 요청이 있으면 빌드 전에 준비한다(`references/images.md`):
```bash
node "$SKILL_DIR/scripts/images.mjs" <폴더>/lesson.json --compile-only   # 브리프 → 프롬프트 컴파일·검증(공냥 prompt-kit)
node "$SKILL_DIR/scripts/images.mjs" <폴더>/lesson.json                  # 실제 생성
```
기본은 subscription 경로(Codex CLI, 사용자 ChatGPT 구독 쿼터, 모델 자동 선택). 특정 모델을 강제하려면 lesson.json에 `"images": {"model": "gpt-image-2.5-sunburst"}`처럼 쓰고 `OPENAI_API_KEY`를 설정하면 그 모델의 API 경로(별도 과금)로 바뀐다.

### 6. 빌드 → 게이트 → 수정 반복
```bash
node "$SKILL_DIR/scripts/build.mjs" <폴더>/lesson.json
node "$SKILL_DIR/scripts/gate.mjs"  <폴더>/lesson.json
```
FAIL이 하나라도 있으면 메시지의 `→` 힌트대로 lesson.json을 고치고 다시 빌드·게이트. 템플릿이나 게이트 기준을 느슨하게 바꿔서 통과시키지 않는다. 게이트는 S1~S7(구조·문체·성취기준·설계서 반영)·E1(증거 중심)·I1(이미지)·B1~B8(브라우저 실측) — 목록과 흔한 해결법은 `references/gates.md`. 설계서(`meta.intake`)가 있으면 S7이, `meta.profile:"evidence"`면 E1이, 이미지 요청이 있으면 I1이 함께 통과해야 한다.

### 7. 캡처 육안 검수 + 도메인 정확성 검토 (게이트 통과 후 필수)
1. `out/shots/overview.png`, 모든 `slide-NN.png`, `worksheet-p*.png`, `answer-key-p*.png`, `lesson-plan-p*.png`를 Read로 열어 `references/design.md`의 **육안 검수 체크리스트**를 확인한다. 걸리면 고치고 6단계부터 다시.
2. **도메인 정확성 검토(필수, 작성자 자신이 아닌 별도 서브에이전트/검증자에게 맡긴다)**: 수치·과학·수학 내용이 있는 수업이면, lesson.json을 쓴 에이전트와 같은 컨텍스트에서 스스로 점검하지 않는다 — 별도로 띄운 서브에이전트(또는 verifier 역할)에게 슬라이드·**활동지·정답지**를 모두 넘겨 검토를 맡긴다. 범위: ① 모든 삽화·그림의 사실·수식 주장이 맞는가(예: 대칭 이중슬릿의 중앙은 밝은 무늬인가, 반사광은 입사 쪽으로 되돌아가는가, 좌표·부호가 본문과 일치하는가), ② **그림과 그 옆 발표자 노트·캡션이 서로 다른 말을 하고 있지 않은가**(figure ↔ notes/caption 일치). 그림마다 "주장 — 판정(맞음/틀림/애매)"을 `retro.md`에 남긴다. 게이트는 도형이 라벨과 겹치는지는 잡아도(B2) 그 안의 물리·수학이 맞는지는 모른다 — 이 검토가 그 자리를 메운다.

### 8. 전달
- 산출물 경로 4개와 사용법(슬라이드는 Chrome으로 열고 F 전체화면, →/Space 넘김, N 노트, T 타이머)
- 교사가 확인해야 할 것: `verified:false` 성취기준, `facts`의 출처, 교과서 표현과의 차이
- 수정 요청은 lesson.json만 고쳐 다시 빌드하면 된다는 점
- 설계서를 받았다면: 채운 항목 중 반영된 것/AI가 정한 것, `intake.mjs`의 경고, `--check`(S7)에서 `n/a`로 남아 사람이 마지막으로 확인해야 할 항목(`references/intake.md` 5절)

### 9. 회고
`<폴더>/retro.md`에 3~5줄: 걸린 게이트, 원인, 고친 방법, 다음에 처음부터 다르게 할 것.

## 합격 기준 (모두 예)
- [ ] `gate.mjs`가 `ALL PASS`(exit 0)
- [ ] 모든 슬라이드 캡처에서 글자 잘림·겹침·빈 화면 없음, 삽화 라벨이 읽힘
- [ ] 활동지에 정답 흔적 없음, 정답지에 모든 답과 풀이
- [ ] 지도안 시간 합 = 수업 시간, 성취기준 확인 표시가 사실대로
- [ ] 화면·활동지의 모든 수치가 `facts`에 출처와 함께 있음

## 참조
- `references/lesson-schema.md` — lesson.json 전체 스키마, 필드별 한도
- `references/slides.md` — 슬라이드 15유형 카탈로그, 수업 흐름 템플릿
- `references/design.md` — 디자인 규칙, SVG 삽화 작성법, 육안 검수 체크리스트
- `references/pedagogy.md` — 목표·발문·형성평가·활동지·지도안 작성 규칙
- `references/gates.md` — 게이트 17종, 오류 코드별 해결법
- `references/intake.md` — 수업 설계서(.md) 반영 절차, intake.json 매핑표, S7 게이트
- `references/images.md` — 이미지 브리프 → 프롬프트 컴파일 → 생성 절차, I1 게이트
- `CREDITS.md` — 참고한 오픈소스와 글꼴 라이선스
