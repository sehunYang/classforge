# 이미지 브리프 — pe-concept

- role: concept
- ratio: 4:3 → 기본(subscription) codex size 1536x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: photo
- brief: 실험대 위 유리 진공관 속 금속 판에 보랏빛 자외선이 닿는 클로즈업 사진, 학구적인 실험실 분위기

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `pe-concept.prompt.txt`로 저장한다(끝은 `AR 4:3`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
