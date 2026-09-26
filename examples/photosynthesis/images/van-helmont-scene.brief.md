# 이미지 브리프 — van-helmont-scene

- role: hook
- ratio: 16:9 → 기본(subscription) codex size 1792x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: illustration
- brief: 17세기 유럽 정원, 큰 화분에 어린 버드나무 묘목을 심고 물주전자로 물을 주는 학자풍 인물의 뒷모습, 옆에는 흙이 담긴 화분과 오래된 책 한 권
- state: 실험을 막 시작하는 장면 — 결과는 아직 보이지 않는다
- mustNotShow: 자란 나무, 실험 결과를 보여주는 저울이나 숫자

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `van-helmont-scene.prompt.txt`로 저장한다(끝은 `AR 16:9`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
