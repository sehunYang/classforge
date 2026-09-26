# review.json 스키마 (도메인 검토 기록)

`SKILL.md` 7.2단계의 도메인 정확성 검토를 실제로 수행했다는 증거를 남기는 파일이다. **작성 주체는 빌드를 만든 저자가 아니라 별도의 검토 서브에이전트**여야 한다 — 저자가 스스로 채우면 "게이트만 통과시키는" 형식적 파일이 되기 쉽다. 경로는 `<lesson.json이 있는 디렉터리>/review.json`(lesson.json과 같은 위치, `out/` 밖). 게이트 **R1**(`references/gates.md`)이 이 파일의 존재·형식·최신성만 강제한다 — 검토 내용 자체(사진이 정말 맞는지 등)의 정오는 게이트가 판정할 수 없고, 그건 검토 서브에이전트의 몫이다.

## 전체 모양

```json
{
  "reviewedAt": "2026-09-25T11:09:00.000Z",
  "reviewer": "separate-subagent",
  "checklist": {
    "1": "ok", "2": "ok", "3": "issue", "4": "ok", "5": "ok",
    "6": "ok", "7": "na", "8": "ok", "9": "ok", "10": "ok",
    "11": "ok", "12": "ok", "13": "ok", "14": "ok", "15": "ok", "16": "ok"
  },
  "slides": [
    { "n": 5, "figure": "저울 눈금이 반응 전후 모두 200g을 가리킴", "text": "반응 전후 질량이 같다고 설명", "verdict": "맞음", "reason": "그림과 설명이 일치" }
  ],
  "images": [
    { "id": "step3-leaf", "state": "탈색 후 흰 잎에 아이오딘 반응으로 청람색 반점", "required": "탈색 후 청람색 반응(3단계 캡션 기준)", "inherit": "2단계(탈색 완료)에서 이어받음", "verdict": "맞음" }
  ],
  "experiments": [
    { "where": "5번 compare→6번 판정", "validity": "대조군(어둠)이 하루 이상 전처리라 수업 시간 안에 실제로 차이가 남 — 타당함", "verdict": "맞음" }
  ],
  "stamp": {
    "lesson": "d7fb7b9f3e2a4be08eb4c6984a0a7419b6454c871ff4b14d83f3a1824aec7b4d",
    "images": { "step3-leaf": "524f126f3b58a31cf0593e579019512c6bde1ce31bb1c3516159dc939166f28b" }
  }
}
```

`stamp`와 `reviewedAt`은 **둘 다 손으로 채우지 않는다** — verdict를 모두 쓴 뒤 **마지막 단계**로 아래 명령을 실행하면 게이트가 지금 시각·해시를 계산해 둘 다 채워 준다(review.json이 이미 있으면 그 파일에 바로 써 넣는다):

```
node scripts/gate.mjs <lesson.json> --review-stamp
```

`--review-stamp`는 `reviewedAt`을 실행 시점의 **실제 UTC ISO 시각**(`new Date().toISOString()`)으로 덮어쓴다 — 검토자가 KST 등 현지 시각 숫자에 "Z"(UTC 표시)를 그대로 붙여 손으로 적으면 실제보다 9시간 앞선 시각이 되어 미래 시각 FAIL(R1-STALE)이 뜨는 사고를 막기 위함이다. 손으로 `reviewedAt`을 적지 않는다.

## 필드

- **`reviewedAt`**(필수, ISO 8601 문자열): 검토를 마친 시각. **`--review-stamp`가 채운다(손으로 적지 않는다)** — 정보용이다(누가 언제 검토했는지 기록으로 남을 뿐, 신선함 판정에는 안 쓴다, 신선함은 아래 `stamp`가 대신 판정한다). 그래도 형식이 아예 깨졌거나(파싱 불가) 지금보다 5분 넘게 미래인 값이면 FAIL(R1-STALE, 시계 오차·오타로 본다) — 흔한 원인은 현지 시각에 "Z"를 잘못 붙여 손으로 적는 것이니, `--review-stamp`로 채우면 이 문제 자체가 생기지 않는다.
- **`reviewer`**(권장): 검토를 수행한 주체를 적는다(예: `"separate-subagent"`). 비어 있으면 경고만 한다.
- **`stamp`**(필수, 객체): 검토 당시 콘텐츠의 sha256 지문 — `{ "lesson": "<lesson.json의 sha256 hex>", "images": { "<이미지 id>": "<그 파일의 sha256 hex>" } }`. **손으로 채우지 않고 `node scripts/gate.mjs <lesson.json> --review-stamp`로 채운다**(위 "전체 모양" 참고) — 검토 서브에이전트가 verdict를 모두 쓴 **마지막 단계**로 실행한다. 게이트 R1은 이 값을 "지금" 다시 계산한 lesson.json·참조 이미지의 sha256과 비교한다: **`stamp`(또는 `stamp.lesson`)가 아예 없으면 FAIL(R1-STAMP)**, 힌트는 `--review-stamp`를 실행하라는 것. 있는데 **`stamp.lesson`이나 `stamp.images[id]` 중 하나라도 지금 계산한 해시와 다르면 FAIL(R1-STALE)** — 검토 이후 그 파일 내용이 바뀌었다는 뜻이다. 수정 시각 비교와 달리 파일을 touch만 해서는 안 걸리고(내용이 그대로면 신선함 그대로), 한 글자라도 바뀌면 확실히 걸린다. `out/`(슬라이드 렌더·캡처·gate-report.json 등 게이트가 매번 다시 쓰는 빌드 산출물)은 비교 대상이 아니다 — 콘텐츠는 lesson.json(과 참조 이미지)이 대표한다.
- **`checklist`**(필수, 객체): 키는 문자열 `"1"`부터 `"16"`까지(SKILL.md 7.2의 ①~⑯ 16개 항목과 1:1 대응 — 그림·캡션·노트 정확성, 수치의 물리적 타당성, 측정값 vs 공식값 구분, compare 이미지-텍스트 일치, 표기/기호-그림 일치, 판정 구별력("기각된 쪽 설명도 이 관찰을 예측하는가?"), 학생 실험 순서(스포일러·실측-먼저), 연속 절차의 이미지 상태 이어받기, 장치 구조 정확성(사진만으론 배선 검증 불가), 입자 의인화 금지, 안전 가시성, 판정 전 스포일러, 실험 타당성(pedagogy.md §11), 선택지 범주어 함정, 회로 도해 검산 등). 값은 `"ok"`(문제 없음) · `"issue"`(가벼운 문제, 통과는 하되 기록) · `"na"`(해당 없음) 중 하나 — **`"틀림"`을 쓰면 안 된다**(그건 `slides`/`images`/`experiments`의 `verdict` 전용 값이다). 16개 키 중 하나라도 없으면 FAIL(R1-CHECKLIST), 값이 `"issue"`면 경고(R1-CHECKLIST-ISSUE).
- **`slides`**(배열): 시각 자료가 있는 슬라이드마다(권장: 있는 슬라이드는 전부) 행 하나.
  - `n`(필수, 1부터 슬라이드 번호) — lesson.json의 `slides[n-1]`과 대응.
  - `figure`(문자열) — 그 슬라이드의 그림/그래프/사진이 실제로 무엇을 보여주는지. **그 슬라이드에 시각 자료(`visual`)가 있는데 비어 있으면 FAIL(R1-FIGURE-EMPTY)**.
  - `text`(문자열) — 캡션·notes·본문이 그 그림에 대해 주장하는 내용.
  - `verdict`(필수) — `"맞음"`(figure와 text가 일치) · `"애매"`(판단 보류, 경고로 남음) · `"틀림"`(불일치 — FAIL).
  - `reason`(문자열, 권장) — 판정 근거 한 줄.
  - **lesson.json의 모든 슬라이드 번호에 행이 있어야 한다**(시각 자료가 없는 슬라이드도 포함 — `figure`는 빈 문자열이어도 되지만 행 자체는 있어야 한다). 빠지면 FAIL(R1-SLIDE-MISSING).
- **`images`**(배열): lesson.json이 참조하는 모든 이미지 `id`(`{image:{id,...}}`로 요청된 것, `images/manifest.json`의 키와 같다)마다 행 하나.
  - `id`(필수) — 이미지 요청 id.
  - `state`(문자열) — 그 이미지가 실제로 보여주는 물리적 상태(예: "탈색 후 흰 잎").
  - `required`(문자열) — 캡션·절차가 요구하는 상태(예: "탈색 후 청람색 반응").
  - `inherit`(문자열) — 앞 단계에서 이어받아야 할 상태, 없으면 `"n/a"`(예: 연속된 실험 절차 사진이 앞 단계 결과를 반영하는지).
  - `verdict`(필수) — `"맞음"`·`"애매"`·`"틀림"`(위 slides와 같은 기준).
  - **참조되는 모든 이미지 id에 행이 있어야 한다**. 빠지면 FAIL(R1-IMAGE-MISSING).
- **`experiments`**(배열, 선택): 수업에 실험(특히 `compare`→판정 흐름)이 있으면 그 실험마다 행 하나. 행 자체의 존재는 강제하지 않는다(검토자가 실험이 있는 만큼만 적는다) — 다만 적었다면 `verdict`는 검사한다.
  - `where`(문자열) — 어느 슬라이드/활동인지(예: `"5번 compare→6번 판정"`).
  - `validity`(문자열) — 그 대조군이 수업 시간 안에 실제로 차이를 낼 수 있는지, 전처리가 필요한지(`references/pedagogy.md` §11 "교과별 실험 함정" 표 기준).
  - `verdict`(필수) — `"맞음"`·`"애매"`·`"틀림"`.

## verdict 값과 게이트 판정

| verdict | 의미 | 게이트 R1 반응 |
|---|---|---|
| `맞음` | 문제 없음 | 통과 |
| `애매` | 판단이 애매함, 수업에는 쓸 수 있지만 저자가 다시 볼 만함 | 경고(R1-VERDICT-AMBIGUOUS) — 막지는 않는다 |
| `틀림` | 실제로 틀렸거나 불일치함 | FAIL(R1-VERDICT) — 반영 후 재검토해야 통과 |

## 흔한 실수

- 저자(빌드 담당) 본인이 review.json을 채우는 것 — 검토가 형식적이 돼 원래 문제(도메인 검토 자체가 빠짐)가 재발한다. 반드시 **별도 검토 서브에이전트**가 lesson.json·`out/`(슬라이드 렌더 결과)·이미지 파일을 직접 보고 채운다.
- verdict를 다 쓰고 `--review-stamp`를 안 돌리는 것 — `stamp`가 아예 없으면 FAIL(R1-STAMP)한다. 검토의 **마지막 단계**로 반드시 `node scripts/gate.mjs <lesson.json> --review-stamp`를 실행한다.
- 수정 후 다시 검토하지 않고 `--review-stamp`만 다시 돌리는 것 — stamp는 "검토 시점의 내용"을 가리켜야 하는 값이라, 내용만 새로 찍고 verdict를 안 고치면 검토가 그 수정을 실제로 봤다는 보장이 없다(게이트는 이 사고까지는 못 잡는다 — 검토 절차 자체를 지켜야 한다).
- lesson.json이나 이미지를 고친 뒤 `--review-stamp`를 다시 안 돌리는 것 — `stamp.lesson`이나 `stamp.images[id]`가 지금 내용의 해시와 달라지면 FAIL(R1-STALE)한다. `out/`은 검사 대상이 아니므로 out/만 새로 생겼다고 오래됐다고 나오지는 않는다 — lesson.json이나 참조 이미지가 바뀌었을 때만 다시 검토하고 stamp를 다시 찍으면 된다.
- `reviewedAt`을 손으로 적는 것 — 특히 KST 등 현지 시각 숫자에 "Z"(UTC)를 그대로 붙이면 실제보다 9시간 앞선 미래 시각이 되어 FAIL(R1-STALE)한다. `--review-stamp`가 실제 UTC 시각으로 채워 주니 손으로 적지 않는다.
- `reviewedAt`을 미래 시각으로 잘못 적는 것(시계 오차·오타) — 지금보다 5분 넘게 미래면 FAIL(R1-STALE)한다(정보용 필드지만 이 정도로 어긋나면 데이터 문제로 본다).
- `checklist` 값에 `"틀림"`을 쓰는 것 — checklist는 `ok`/`issue`/`na`만 쓴다. "틀림"은 slides/images/experiments의 verdict 전용이다.
- 시각 자료가 없는 슬라이드(예: `quiz`에 이미지가 없는 경우)를 `slides[]`에서 빼는 것 — 행 자체는 모든 슬라이드 번호에 있어야 한다(figure는 비워도 된다).
