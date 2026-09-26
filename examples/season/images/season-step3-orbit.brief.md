# 이미지 브리프 — season-step3-orbit

- role: step
- ratio: 4:3 → 기본(subscription) codex size 1536x1024(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)
- style: photo
- brief: 책상 위 원 모양 경로의 정중앙에 갓 없이 전구가 드러난 스탠드가 지구본과 같은 높이에서 옆으로 빛을 비추고, 초등학생 손이 자전축이 기울어진 지구본을 받침대째 들고 그 원형 경로를 따라 다음 자리로 옮기는 장면, 위에서 비스듬히 내려다본 구도
- purpose: apparatus
- state: 자전축이 같은 방향으로 기울어진 지구본이, 전구 중심과 지구본 중심이 같은 높이인 채로 전구 둘레 원형 경로 위를 옮겨지는 중
- mustShow: 전구 중심과 지구본 적도가 같은 높이(전구 꼭대기가 지구본 꼭대기보다 낮음), 같은 검은 책상

## 컴파일 방법
1. `references/images.md`를 읽는다.
2. `vendor/prompt-kit/skills/image-prompt/SKILL.md`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.
3. 완성 프롬프트를 lesson.json에서 이 요청의 `image.prompt` 필드에 넣거나, 이 폴더에 `season-step3-orbit.prompt.txt`로 저장한다(끝은 `AR 4:3`).
4. `node scripts/images.mjs <lesson.json> --compile-only`를 다시 실행해 검증을 통과시킨다.

## 참고 팔레트 (고정 팔레트 primary·secondary·accent(코럴)·paper)
#3B1E54 #7A5C9E #FF6F61 #F8F6FA
