# 이미지 브리프 — season-step2-tilt

- role: step
- ratio: 4:3 → 기본(subscription) codex size 1536x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: photo
- brief: 초등학생 두 손이 받침대에 꽂힌 지구본의 자전축을 한쪽으로 비스듬히 기울여 맞추는 장면, 옆에서 켜진 탁상 전등이 지구본을 비춤
- purpose: apparatus
- state: 지구본의 자전축 막대가 한쪽으로 비스듬히 기울어진 상태, 켜진 전등 빛이 지구본 한쪽 면을 밝힘

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `season-step2-tilt.prompt.txt`로 저장한다(끝은 `AR 4:3`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
