# 이미지 브리프 — pe-step3

- role: step
- ratio: 4:3 → 기본(subscription) codex size 1536x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: photo
- brief: 학생 손이 다이얼을 천천히 돌리고, 옆 계기 바늘이 오른쪽에서 서서히 0을 향해 내려가는 클로즈업
- state: 역전압이 점점 커지면서 계기 바늘이 서서히 0을 향해 되돌아가는 상태
- mustShow: 0을 향해 내려가는 계기 바늘, 다이얼을 돌리는 손

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `pe-step3.prompt.txt`로 저장한다(끝은 `AR 4:3`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
