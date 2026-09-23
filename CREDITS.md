# 참고한 자료와 라이선스

## 설계 참고 (코드 복사 없이 구조·원칙을 참고)
공냥이(gongnyang) GitHub 공개 저장소 — 모두 MIT License
- **deck-factory** — 무빌드 단일 HTML 슬라이드, 네 모서리 크롬, 채운 카드 대신 헤어라인, 레이아웃 어휘 제한, CJK `keep-all`
- **awesome-html-scrolline-deck** — 정적/브라우저 게이트 2단계, exit code 관례, 가시 요소 실측, 가로 넘침 0 검사
- **bookforge** — HTML→Playwright PDF 인쇄 트랙, 쪽 채움(reach/ink) 개념, "엔진은 내용을 만들지 않는다"(수치 날조 방지)
- **cardprinter** — 글자 크기 하한(fail-closed), 세이프존 넘침 검사, 오류 코드 + 수정 힌트
- **gongnyang-prompt-kit** — `{ok, errors:[{code,msg,hint}]}` 리포트 형식, 결과 지향 긍정 서술
- **gongnangi-chart-skill** — 핵심 메시지형 제목("So What?"), 강조색 하나
- **data-literacy-with-ai** — 커리큘럼·핸드아웃·강사대본 구성, 시간 블록, 상·중·하 루브릭, "완료 판단 체크포인트"

영상 「ChatGPT Astra 업무자동화 사용법! PPT, 문서, 영상까지」(패스트캠퍼스, 2026-09-22) 요약에서 가져온 원칙: 목적을 분명히, 레퍼런스 리버스 프롬프팅, 게이트=물리적 브레이크, 작은 부품 조합, 회고 루프, 수정 가능한 산출물.

## 이미지 생성 (`vendor/prompt-kit/`)
`scripts/images.mjs`가 실행 시점에 그대로 쓰는 코드·문서를 **공냥이 프롬프트 킷**(gongnyang-prompt-kit, MIT License)에서 가져와 동봉했다. 원본: https://github.com/gongnyang/gongnyang-prompt-kit (스킬 `image-prompt`). 라이선스 전문은 `vendor/prompt-kit/LICENSE`.
- `skills/image-prompt/scripts/check_prompt.mjs` — 프롬프트 검증기(수정 없이 그대로), `images.mjs`가 컴파일된 프롬프트마다 실행해 `{ok,errors,warnings}`를 받는다.
- `skills/image-prompt/SKILL.md`, `skills/image-prompt/references/photo-vocab.md` — 프롬프트 작성 시 읽는 참고 문서(Format A 마스터 템플릿·철칙·카메라/조명/색 어휘). `references/images.md`가 이 문서들을 어떻게 쓰는지 안내한다.
- 이미지 생성 자체는 사용자의 ChatGPT 구독 쿼터로 Codex CLI(`codex exec`, 내장 image_generation 도구)를 호출한다. API 키 방식은 쓰지 않는다.

## 글꼴
- **Pretendard** (Regular·Medium·SemiBold·Bold·ExtraBold) — SIL Open Font License 1.1, `assets/fonts/LICENSE-Pretendard-OFL.txt`. 빌드 때 문서에 쓰인 글자만 서브셋해 파일 안에 넣는다(OFL이 허용하는 방식).
