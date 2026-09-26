# 이미지 브리프 — season-step1-lamp

- role: step
- ratio: 4:3 → 기본(subscription) codex size 1536x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: photo
- brief: 어두운 교실 책상 위에서 초등학생 손이 흰색 탁상 전등의 스위치를 눌러 불을 켜는 순간, 전등 옆에 받침대에 꽂힌 작은 지구본이 놓여 있음
- purpose: apparatus
- state: 탁상 전등이 막 켜져 밝게 빛나고, 받침대에 꽂힌 지구본이 전등 옆에 놓여 있는 상태

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `season-step1-lamp.prompt.txt`로 저장한다(끝은 `AR 4:3`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
