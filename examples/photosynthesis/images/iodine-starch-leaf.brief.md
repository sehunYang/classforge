# 이미지 브리프 — iodine-starch-leaf

- role: scene
- ratio: 16:9 → 기본(subscription) codex size 1792x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: photo
- brief: 실험대 위에 놓인 콩잎 한 장, 잎의 절반은 은박지로 감쌌던 접힌 자국이 남아 그 부분은 색이 변하지 않은 채 밝은 빛깔이며, 나머지 절반은 진한 청람색으로 물든 아이오딘 반응 자국이 뚜렷한 모습, 옆에 작은 비커와 스포이트
- state: 탈녹말 후 절반만 빛에 노출하고 아이오딘 반응을 마친 상태 — 빛 받은 절반은 청람색, 가린 절반은 무색
- mustShow: 청람색으로 변한 잎 절반, 색이 변하지 않은 잎 절반

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `iodine-starch-leaf.prompt.txt`로 저장한다(끝은 `AR 16:9`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (교과 강조색 #0B7A6A 기준)
#0B7A6A #60A99E #B6D7D2 #FBFAF6
