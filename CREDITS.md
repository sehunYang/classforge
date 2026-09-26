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

## 정밀 도식·인라인 수식 (`scripts/diagrams.mjs`)
`scripts/diagrams.mjs`는 기하·광학·회로·입자 모형처럼 정확한 각도·좌표·기호가 필요한 도식과, 본문 속 `$...$` 수식을 실제 LaTeX으로 조판한다. 엔진은 두 갈래다(`references/design.md` "정밀 도식은 TikZ로"):
- **시스템 LaTeX**(교사 PC에 설치돼 있으면 우선 사용) — **MiKTeX**(Christian Schenk 외, [miktex.org](https://miktex.org)) 또는 **TeX Live**(TeX User Group, [tug.org/texlive](https://tug.org/texlive)) 배포판의 `latex`·`dvisvgm`을 그대로 호출한다. 이 스킬은 이 배포판들을 동봉하지 않는다 — 사용자가 각자 설치한 것을 찾아 쓸 뿐이다. LaTeX 커널 자체는 **LPPL(LaTeX Project Public License)**, MiKTeX·dvisvgm은 각각 GPL 계열 라이선스(각 프로젝트 배포본의 라이선스 파일 참고)이며, 이 스킬은 그 실행 파일을 외부 프로세스로 호출만 하므로 재배포 의무가 없다. **dvisvgm**(Martin Gieseking, GPL-3.0, [dvisvgm.de](https://dvisvgm.de))으로 DVI→SVG 변환을 하며, `--no-fonts` 옵션으로 글자까지 벡터 경로로 바꿔 별도 글꼴 파일이 전혀 필요 없게 만든다.
- **node-tikzjax**(npm, LPPL-1.3c — `node_modules/node-tikzjax/LICENSE`) — 시스템 LaTeX이 없는 PC에서만 대체로 쓰는 오프라인 WASM TeX. [TikZJax](https://tikzjax.com)(kisonecat, [artisticat1의 fork](https://github.com/artisticat1/tikzjax))를 Node.js에 이식한 프로젝트다([prinsss/node-tikzjax](https://github.com/prinsss/node-tikzjax)). 회로 그림은 그 안에 함께 실린 **circuitikz**(LaTeX 패키지, LPPL)를 쓴다.
  - **BaKoMa 폰트**(node-tikzjax가 `css/bakoma/`에 번들) — Computer Modern·AMS 글꼴의 TrueType판. BaKoMa Fonts Licence(Basil K. Malyshev, `node_modules/node-tikzjax/css/bakoma/LICENCE`)는 임베딩·수정·재배포를 요금 없이 허용한다. 이 엔진일 때만(시스템 LaTeX은 `--no-fonts`라 글꼴이 필요 없다) 실제 쓰인 font-family만 골라 그 도식 SVG 안에 base64로 넣는다.
  - 렌더링·네트워크 요청 없이 완전히 로컬 WASM(`tex.wasm.gz`)과 번들 TeX 패키지(`tex_files.tar.gz`)로 동작한다 — `embedFontCss` 등 기본으로 CDN을 참조하는 옵션은 쓰지 않는다.

두 엔진 모두 한글이 없으므로(design.md) 한글 라벨은 이 스킬이 Pretendard로 직접 겹쳐 그린다 — TeX 글꼴을 벡터 경로로 바꿔 배포하는 일은 어느 엔진에도 없다.

## 글꼴
- **Pretendard** (Regular·Medium·SemiBold·Bold·ExtraBold) — SIL Open Font License 1.1, `assets/fonts/LICENSE-Pretendard-OFL.txt`. 빌드 때 문서에 쓰인 글자만 서브셋해 파일 안에 넣는다(OFL이 허용하는 방식).
- **KoPub World**(한국출판인회의, 문화체육관광부 지원) — 문체부·한국출판인회의가 무료 배포하되 등록이 필요하고, "가공(서브셋 포함)"과 "웹서비스·프로그램에 넣어 배포"는 별도 승인이 필요하며 재배포는 금지된 라이선스(`kopus.org` 이용약관). 그래서 이 스킬은 KoPub 폰트 파일을 **동봉·서브셋·base64 임베딩하지 않는다** — `scripts/fonts.py`가 그 PC에 이미 설치된 KoPub World Dotum을 `local()`로 참조만 한다(`meta.font:"kopub"` 또는 `"auto"`+`profile:"evidence"`일 때, 설치돼 있을 때만). 배포처: https://www.kopus.org/biz-electronic-font2/ · `references/design.md` "글꼴".
