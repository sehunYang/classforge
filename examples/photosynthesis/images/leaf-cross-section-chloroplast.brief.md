# 이미지 브리프 — leaf-cross-section-chloroplast

- role: concept
- ratio: 4:3 → 기본(subscription) codex size 1536x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: illustration
- brief: 나뭇잎 단면을 확대한 모습, 광합성이 일어나는 초록색 엽록체 세포층이 가득 보이고 위에서 햇빛이 비치는 순간, 얇은 잎맥도 함께 보인다

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `leaf-cross-section-chloroplast.prompt.txt`로 저장한다(끝은 `AR 4:3`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
