// classforge images — lesson.json의 {image:{...}} 요청을 컴파일·검증하고 생성한다.
// 사용: node images.mjs <lesson.json> [--compile-only] [--force] [--concurrency N] [--route subscription|api] [--prune] [--only id1,id2]
//
// 두 경로:
//  - subscription(기본) — Codex CLI 내장 image_generation 도구, 사용자 ChatGPT 구독 쿼터. 모델 선택 불가(서버가 고름).
//  - api — lesson.json의 images.model(또는 CLASSFORGE_IMAGE_MODEL)로 모델을 강제 지정하고 싶을 때만.
//    OPENAI_API_KEY로 사용자의 OpenAI API 과금(구독 쿼터 아님)을 쓰며, OpenAI Images API
//    (POST https://api.openai.com/v1/images/generations)를 Node fetch로 직접 호출한다.
//    모델 문자열은 그대로 전달한다(치환 없음): API가 모델을 거부하면 그 에러 메시지 그대로 실패한다.
//
// 파이프라인:
//  1. lesson.json을 훑어(임의 깊이) 모든 {image:{id,brief,role,ratio,style,prompt?}}를 모은다.
//  2. prompt가 없으면 images/<id>.brief.md를 쓰고 "빠짐" 목록에 넣는다(작성자가 공냥 프롬프트 킷으로 채워야 함).
//  3. prompt가 있으면 교실 안전 문구를 붙이고(이미 있으면 건너뜀) vendor/prompt-kit의 check_prompt.mjs로 검증한다.
//  4. --compile-only면 여기서 끝: 빠짐·검증실패가 있으면 비정상 종료(체크리스트 출력).
//  5. 아니면 경로(subscription/api)를 정하고, 검증 통과한 요청만 생성(동시성 제한, 실패 시 1회 재시도) →
//     PNG 서명·크기·비율 확인 → 웹용 축소본(webp/jpeg, 긴 변 1600) 생성 →
//     images/manifest.json에 기록(프롬프트 해시로 캐시).
//
// 아래 순수 함수들(collect·classroomClause·ensureClassroomClause·runCheckPrompt·sha256)은 파일을 쓰지 않으므로
// gate.mjs의 I1 게이트가 그대로 import해서 "images.mjs가 만들 최종 프롬프트"를 메모리에서만 재현한다
// (게이트는 lesson.json을 절대 고치지 않는다 — CLI 본체는 main()에 있고 이 모듈을 import만 해서는 실행되지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SKILL, loadLesson, launch } from './lib.mjs';

// ── 바뀌지 않는 상수 ────────────────────────────────────────
const RATIOS = ['1:1', '16:9', '4:3', '3:4'];
// role별 기본 ratio — ratio를 안 쓰면 실측 칸 비율(design.md "칸 크기 실측")에 가장 가까운 지원 비율로 채운다.
// concept(792×582≈4:3)·steps(380×260≈3:2→4:3이 가장 가까움)는 4:3, diagram(1696×598≈3:1)은 지원 비율 중
// 가장 넓은 16:9로(칸보다 좁아 위아래가 object-fit:cover로 잘리지만 남는 4종 중 가장 가깝다).
const DEFAULT_RATIO_BY_ROLE = { cover: '4:3', hook: '16:9', concept: '4:3', diagram: '16:9', step: '4:3', scene: '4:3', background: '4:3' };
const ROLES = ['hook', 'concept', 'cover', 'background', 'step', 'scene'];
// 이 이미지가 화면에서 하는 일 — exit·summary처럼 "장식이 아니라 근거·적용을 보여줘야" 하는 자리를
// 게이트(impl-gates가 추가 예정)가 구분할 수 있게 하는 선택 필드(images.md 참고). 여기서는 형식만 검증한다.
const PURPOSES = ['scene', 'evidence', 'application', 'apparatus', 'concept'];
// subscription(codex 내장 도구)은 16:9 전용 버킷(1792x1024)이 있다. api 경로(gpt-image-2가 아닌
// 임의 모델)는 대부분의 GPT Image 모델이 지원을 보장하는 레거시 사이즈 4종(1024x1024·1536x1024·
// 1024x1536·auto)만 쓴다 — 16:9도 1536x1024(가장 가까운 가로 버킷)로 근사한다.
const RATIO_SIZE_SUBSCRIPTION = { '1:1': '1024x1024', '16:9': '1792x1024', '4:3': '1536x1024', '3:4': '1024x1536' };
const RATIO_SIZE_API = { '1:1': '1024x1024', '16:9': '1536x1024', '4:3': '1536x1024', '3:4': '1024x1536' };
const CHECK_PROMPT = path.join(SKILL, 'vendor', 'prompt-kit', 'skills', 'image-prompt', 'scripts', 'check_prompt.mjs');
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const CLASSROOM_MARK = 'CLASSROOM-SAFE-V1';
const TIMEOUT_MS = 8 * 60 * 1000;

// ── 색 도우미 (교과 강조색에서 보조 팔레트 파생) ───────────
const hexToRgb = h => { const m = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)); };
const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (hex, target, t) => { const a = hexToRgb(hex), b = hexToRgb(target); return rgbToHex(a.map((v, i) => v + (b[i] - v) * t)); };
const accentPalette = hex => [hex.toUpperCase(), mix(hex, '#FFFFFF', 0.35), mix(hex, '#FFFFFF', 0.7), '#FBFAF6'];

// ── lesson.json 전체에서 {image:{...}} 요청을 모은다(임의 깊이) ──
function collect(node, out) {
  if (Array.isArray(node)) { for (const v of node) collect(v, out); return out; }
  if (node && typeof node === 'object') {
    if (node.image && typeof node.image === 'object' && !Array.isArray(node.image)) out.push(node.image);
    for (const k of Object.keys(node)) collect(node[k], out);
  }
  return out;
}

// ── steps 슬라이드의 단계 상태 이어가기(state chain) ──────────
// 실험 절차 이미지(steps[].visual.image)는 이전 단계가 남긴 물리적 상태를 이어받아야 한다(예: 탈색 단계
// 다음 요오드 단계는 "하얗게 된 잎"에서 시작해야지 다시 초록 잎이면 안 된다). id → 바로 앞 단계의 state
// 텍스트를 매핑으로 계산해 둔다(lesson.json은 손대지 않는다 — req 객체에 직접 얹으면 saveLesson()이
// 그 필드까지 파일에 써 버린다). images.mjs·gate.mjs가 항상 이 함수로 같은 맵을 계산해야 프롬프트
// 해시가 어긋나지 않는다.
function stepChainPrevStates(lesson) {
  const map = new Map();
  for (const slide of lesson.slides || []) {
    if (slide.type !== 'steps' || !Array.isArray(slide.steps)) continue;
    let prevState = null;
    for (const step of slide.steps) {
      const img = step && typeof step === 'object' && step.visual && typeof step.visual === 'object' ? step.visual.image : null;
      if (img && typeof img === 'object' && img.id) {
        if (prevState) map.set(img.id, prevState);
        if (img.state) prevState = img.state;
      }
    }
  }
  return map;
}

// ── 이어가기 그룹(continuity group) ────────────────────────
// 한 그룹 = (a) 같은 steps 슬라이드의 단계 이미지들, 또는 (b) req.continuity(또는 그게 없으면
// images.subject)가 똑같은 이미지들. 그룹 안 어느 하나가 낡으면(캐시 불일치) 전부 같이 다시 만든다 —
// 하나만 갱신하면 이어지던 장면이 끊긴다(실제 사고: blind4-photo에서 continuity를 바꿨는데 4단계 중
// 1장만 다시 만들어 나머지 3장이 옛 continuity로 남음). union-find로 겹치는 그룹을 하나로 합친다.
// 반환: id → 그 id가 속한 그룹의 전체 id Set(자기 자신 포함).
function computeGroups(lesson, requests) {
  const allIds = new Set(requests.map(r => r.id).filter(Boolean));
  const parent = new Map();
  for (const id of allIds) parent.set(id, id);
  const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const slide of lesson.slides || []) {
    if (slide.type !== 'steps' || !Array.isArray(slide.steps)) continue;
    const ids = slide.steps.map(st => st?.visual?.image?.id).filter(id => id && allIds.has(id));
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  const byContinuity = new Map();
  for (const req of requests) {
    if (!req.id || !allIds.has(req.id)) continue;
    const cont = req.continuity || (lesson.images && lesson.images.subject) || null;
    if (!cont) continue;
    if (!byContinuity.has(cont)) byContinuity.set(cont, []);
    byContinuity.get(cont).push(req.id);
  }
  for (const ids of byContinuity.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  const rootMembers = new Map();
  for (const id of allIds) { const root = find(id); if (!rootMembers.has(root)) rootMembers.set(root, new Set()); rootMembers.get(root).add(id); }
  const idToGroup = new Map();
  for (const id of allIds) idToGroup.set(id, rootMembers.get(find(id)));
  return idToGroup;
}

// ── 브리프 근접 중복 경고 (컴파일 시점, 차단하지 않음) ──────
// 같은 수업 안에서 서로 다른 자리(예: 표지와 개념 설명)에 사실상 같은 장면을 또 그리라고 시키는
// 실수를 잡는다. 이어가기 그룹(위)끼리는 원래 비슷해야 정상이므로 비교에서 뺀다.
const BRIEF_STOPWORDS = new Set(['그리고', '있는', '있다', '하는', '하고', '에서', '으로', '에게', '것을',
  '모습', '장면', '사진', '순간', '클로즈업', '학생', '교실', '자연광']);
function briefTokens(text) {
  const toks = String(text || '').match(/[가-힣A-Za-z0-9]{2,}/g) || [];
  return new Set(toks.map(t => t.toLowerCase()).filter(t => !BRIEF_STOPWORDS.has(t)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
const DUP_THRESHOLD = 0.5;
const DUP_MIN_TOKENS = 3;
function findNearDuplicateBriefs(requests, idToGroup) {
  const found = [];
  for (let i = 0; i < requests.length; i++) {
    for (let j = i + 1; j < requests.length; j++) {
      const a = requests[i], b = requests[j];
      if (!a.id || !b.id || idToGroup.get(a.id)?.has(b.id)) continue;   // 같은 그룹은 비슷한 게 정상
      const ta = briefTokens(a.brief), tb = briefTokens(b.brief);
      if (ta.size < DUP_MIN_TOKENS || tb.size < DUP_MIN_TOKENS) continue;
      const sim = jaccard(ta, tb);
      if (sim >= DUP_THRESHOLD) found.push({ a: a.id, b: b.id, sim });
    }
  }
  return found;
}

// ── 생성 출처 확인(provenance) ──────────────────────────────
// codex 내장 이미지 도구는 결과물을 $CODEX_HOME/generated_images/<세션 id>/ 아래에 두고, 에이전트가
// 스스로 "방금 만든 파일"을 찾아 우리가 지정한 이름으로 복사한다. 이 탐색이 자기 세션 폴더로 좁혀지지
// 않고 그 폴더 전체(동시에 실행 중인 다른 세션 포함)를 뒤지면, 다른 요청의 파일을 자기 것으로 착각해
// 복사할 수 있다(실제 사고: blind5-photoelectric, pe-cover/pe-concept가 sha256까지 완전히 같은 파일로
// 나왔다 — pe-concept의 로그를 보면 자기 세션이 아니라 pe-cover의 세션 폴더에서 "요청 크기와 일치하는"
// 파일을 집어 복사했다). 에이전트가 실행한 셸 명령과 그 결과(Get-ChildItem·Copy-Item 등)는 이 codex CLI
// 버전에서 stdout이 아니라 **stderr**에 찍힌다(stdout에는 마지막 한 줄짜리 요약만 남는다 — blind5 로그로
// 실측 확인함). 그래서 호출부는 stdout과 stderr을 합쳐 넘긴다: "generated_images/<세션 id>/....png"
// 형태의 경로를 모두 찾아 **마지막** 것을 실제로 복사한 원본으로 보고, 그 세션 id가 이 시도 자신의 세션
// id(parseCodexSessionId)와 다르면 다른 세션의 파일을 가져온 것으로 판단한다. 그런 경로를 하나도 못
// 찾으면(sourceSessionId가 null) 판단을 보류한다 — "확인할 수 없음"이지 "문제없음"이 아니므로, 이 경우는
// 실패 처리하지 않고 기존 동작(성공 처리)을 그대로 따른다. generated_images 전체를 뒤지는 명령
// (Get-ChildItem ... -Recurse 등)이 눈에 띄면, 이번엔 결과가 맞았어도 위험한 습관이므로 별도로 표시한다
// (broadListing → manifest의 provenanceWarning).
function parseProvenance(combinedOutput, mySessionId) {
  const text = String(combinedOutput || '');
  // 구분자는 \ 하나가 아니라 \\(이스케이프된 두 글자)로 찍히는 경우가 실제로 있다(codex CLI가 실행한
  // PowerShell 명령 텍스트를 그대로 되읽어 주면서 백슬래시가 겹쳐 보임 — blind5 로그로 실측 확인함).
  // 그래서 \ 1개 이상 또는 / 로 구분자를 넉넉히 잡는다.
  const pathMatches = [...text.matchAll(/generated_images(?:\\+|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\\+|\/)[^\s'"]*?\.png/gi)];
  const last = pathMatches.length ? pathMatches[pathMatches.length - 1] : null;
  const sourceSessionId = last ? last[1] : null;
  const sourcePath = last ? last[0] : null;
  const broadListing = /generated_images/i.test(text) && /-recurse\b/i.test(text);
  const crossSession = !!(sourceSessionId && mySessionId && sourceSessionId.toLowerCase() !== String(mySessionId).toLowerCase());
  return { sourcePath, sourceSessionId, broadListing, crossSession };
}

// CRLF·트레일링 공백을 통일한다 — Windows git의 autocrlf가 images/<id>.prompt.txt를 체크아웃 시
// CRLF로 바꿔 놓아도(또는 lesson.json에 개행이 다르게 저장돼 있어도) 해시가 달라지지 않게 한다.
// images.mjs(생성)와 gate.mjs의 I1(검증)이 lesson.json/.prompt.txt에서 prompt 텍스트를 읽는 자리마다
// 반드시 이 함수를 거쳐야 두 경로가 항상 같은 문자열 → 같은 해시를 낸다.
function normalizePromptText(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').trim();
}

// ── 교실 안전 문구 + 프롬프트 검증 (순수 함수) ──────────────
function classroomClause(req, accent) {
  const pal = accentPalette(accent).join(' ');
  const noun = req.style === 'photo' ? '사진' : req.style === 'diagram-ish' ? '도해' : '삽화';
  return `Classroom constraints (${CLASSROOM_MARK}): 장면 안 모든 표면·간판·사물은 문자·숫자·기호 없이 매끈하게 두어 문자 없는 순수 ${noun} 장면이 되게 한다, clean brand-free copy-free finish; 등장인물은 실재 인물의 초상이 아닌 완전히 가상의 인물이며 저작권이 있는 캐릭터·브랜드와 무관한 독자적 디자인, 전 연령 교실 환경에 적합한 건전하고 단정한 표현. 보조 팔레트 힌트: ${pal}.`;
}
// 수업(lesson.json) 전체 일관성 — images.style(팔레트·조명·매체)과 요청별/레슨 공통 continuity(같은 인물·소재)를
// 한 절로 합쳐 붙인다. 한 수업의 이미지 여러 장이 한 세트처럼 보이게 하는 것이 목적(images.md 참고).
// 마커(STYLE_MARK)로 감싸 재실행 시 중복 추가되지 않게 한다(ensureClassroomClause와 같은 방식).
const STYLE_MARK = 'LESSON-STYLE-V1';
function styleAndContinuityClause(req, lessonImages) {
  const bits = [];
  const st = lessonImages && typeof lessonImages.style === 'object' ? lessonImages.style : null;
  if (st) {
    const b = [st.palette && `palette ${st.palette}`, st.lighting, st.medium].filter(Boolean);
    if (b.length) bits.push(`palette/lighting/medium: ${b.join(', ')}`);
  }
  const subject = req.continuity || (lessonImages && lessonImages.subject);
  if (subject) bits.push(`continuity: ${subject}`);
  if (!bits.length) return '';
  return `Lesson visual consistency (${STYLE_MARK}): ${bits.join(' — ')} — keep this same look across every image in this lesson.`;
}
// 물리적 상태 연속성 + 명시적 포함/배제 목록 — 실험 절차처럼 "이 장면이 정확히 어떤 상태여야 하는가"가
// 채점·이해에 들어가는 이미지에 쓴다(images.md "단계 상태 이어가기" 참고). "Must not show: X" 표현은
// 공냥 프롬프트 킷의 부정문 금지 목록(no/without/avoid/exclude/never/free of/devoid of/do not/don't)에
// 걸리지 않으면서도(정규식이 정확히 저 단어들만 잡는다) 렌더링 모델에게는 명확한 배제 지시로 읽힌다.
// 그래도 `state`/`mustShow`로 원하는 결과 상태를 먼저 긍정형으로 적는 것이 기본이고, `mustNotShow`는
// 그 위에 얹는 마지막 안전장치로만 쓴다(부정형은 이미지 생성 모델이 정확히 지키지 못할 수 있다).
const STATE_MARK = 'STEP-STATE-V1';
function stateContinuityClause(req, prevState) {
  const parts = [];
  if (prevState) parts.push(`Starts from this exact prior state: ${prevState}`);
  if (req.state) parts.push(`Must depict this exact state: ${req.state}`);
  if (Array.isArray(req.mustShow) && req.mustShow.length) parts.push(`Must show: ${req.mustShow.join(', ')}`);
  if (Array.isArray(req.mustNotShow) && req.mustNotShow.length) parts.push(`Must not show: ${req.mustNotShow.join(', ')}`);
  if (!parts.length) return '';
  return `Physical state continuity (${STATE_MARK}): ${parts.join(' | ')}.`;
}
// 마커가 있는 줄을 통째로 지운다(각 절은 줄바꿈 없는 한 줄이므로 줄 단위 필터로 충분하다) — 재컴파일마다
// 이 세 자동 절을 "있으면 건너뛰기"가 아니라 "지우고 최신 값으로 다시 붙이기"로 처리하기 위해 쓴다.
// continuity·state·mustShow/mustNotShow·images.style이 바뀌었는데 옛 블록이 프롬프트에 그대로 남아
// 조용히 낡아가는 사고(실제 버그 리포트, blind4-photo)를 막는다.
function stripMarked(body, mark) {
  return body.split('\n').filter(line => !line.includes(mark)).join('\n');
}
function ensureClassroomClause(text, req, accent, lessonImages, prevState) {
  let t = String(text).trim();
  const arMatch = t.match(/AR\s+(\d+\s*:\s*\d+)\s*$/i);
  const arToken = arMatch ? arMatch[1].replace(/\s+/g, '') : req.ratio;
  let body = arMatch ? t.slice(0, arMatch.index).trimEnd() : t;
  // 세 절을 전부 먼저 지운 뒤(순서와 무관하게 깨끗한 원문으로 되돌린 다음) 항상 같은 순서로 다시 붙인다 —
  // 하나씩 지우고 그 자리에 바로 다시 붙이면 나중 절이 앞 절보다 먼저 올 수 있어(줄 순서가 뒤바뀜)
  // 내용이 그대로인데도 문자열이 달라져 버린다. 내용이 정말 그대로면 이 재구성 후 문자열도 그대로다.
  body = stripMarked(body, STATE_MARK);
  body = stripMarked(body, STYLE_MARK);
  body = stripMarked(body, CLASSROOM_MARK);
  const stateExtra = stateContinuityClause(req, prevState);
  if (stateExtra) body = `${body}\n${stateExtra}`;
  const styleExtra = styleAndContinuityClause(req, lessonImages);
  if (styleExtra) body = `${body}\n${styleExtra}`;
  body = `${body}\n${classroomClause(req, accent)}`;
  return `${body}\nAR ${arToken}`.trim();
}
function runCheckPrompt(text) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CHECK_PROMPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', () => {
      try { resolve(JSON.parse(out)); }
      catch { resolve({ ok: false, errors: [{ code: 'E-RUNNER', msg: err.trim() || 'check_prompt.mjs 출력을 파싱하지 못함' }], warnings: [] }); }
    });
    child.on('error', e => resolve({ ok: false, errors: [{ code: 'E-RUNNER', msg: e.message }], warnings: [] }));
    child.stdin.write(text);
    child.stdin.end();
  });
}
const sha256 = s => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── --prune: lesson.json이 더 이상 참조하지 않는 이미지를 images/_unused/로 옮긴다 ──
// 지운다는 결정은 사람이 하도록(되돌릴 수 있게) 삭제 대신 격리한다. manifest에서도 그 항목을 뺀다.
function pruneUnused(imagesDir, manifest, usedIds) {
  const ids = Object.keys(manifest.images || {});
  const pruned = [];
  for (const id of ids) {
    if (usedIds.has(id)) continue;
    const unusedDir = path.join(imagesDir, '_unused');
    fs.mkdirSync(unusedDir, { recursive: true });
    const files = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir).filter(f => f === `${id}.png` || f.startsWith(`${id}.`)) : [];
    for (const f of files) {
      const src = path.join(imagesDir, f);
      if (!fs.statSync(src).isFile()) continue;
      const dst = path.join(unusedDir, f);
      if (fs.existsSync(dst)) fs.rmSync(dst);
      fs.renameSync(src, dst);
    }
    delete manifest.images[id];
    pruned.push(id);
  }
  return pruned;
}

export { CLASSROOM_MARK, STYLE_MARK, STATE_MARK, PURPOSES, collect, stepChainPrevStates, computeGroups, findNearDuplicateBriefs, classroomClause, ensureClassroomClause, runCheckPrompt, sha256, normalizePromptText, parseProvenance };

// ── CLI 본체 (isMain일 때만 실행 — import만으로는 아무 것도 하지 않는다) ──
async function main() {
  const args = process.argv.slice(2);
  const lessonPath = args.find(a => !a.startsWith('--'));
  const flag = name => args.includes(`--${name}`);
  const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  if (!lessonPath) {
    console.error('사용: node images.mjs <lesson.json> [--compile-only] [--force] [--concurrency N] [--route subscription|api] [--prune] [--only id1,id2]');
    process.exit(2);
  }
  const COMPILE_ONLY = flag('compile-only');
  const FORCE = flag('force');
  const CONCURRENCY = Math.max(1, Number(opt('concurrency', '2')) || 2);
  const ROUTE_FLAG = opt('route', null);
  // --only id1,id2: 지정한 id만 (캐시 여부와 무관하게) 강제로 다시 만든다. 플래그 없이 실행하면 낡은
  // 이미지를 전부 만드는 것이 기본 동작이다 — --only는 "이 몇 장만 콕 집어 다시" 만들 때만 쓴다.
  const ONLY_IDS = (() => { const v = opt('only', null); return v ? v.split(',').map(s => s.trim()).filter(Boolean) : null; })();

  const ctx = loadLesson(lessonPath);
  const { lesson: L, dir, accent } = ctx;
  const imagesDir = path.join(dir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const manifestPath = path.join(imagesDir, 'manifest.json');

  // ── 1. 요청 수집 + 형식 검증 ─────────────────────────────
  const requests = collect(L, []);

  // --prune: lesson.json에 남은 요청과 무관하게(0개여도) 실행 — 실제 생성·검증은 건드리지 않는다.
  if (flag('prune')) {
    const manifest = loadManifest();
    const usedIds = new Set(requests.map(r => r.id).filter(Boolean));
    const pruned = pruneUnused(imagesDir, manifest, usedIds);
    saveManifest(manifest);
    if (pruned.length) console.log(`정리(--prune): lesson.json에서 더 이상 참조하지 않는 이미지 ${pruned.length}개를 images/_unused/로 옮겼습니다: ${pruned.join(', ')}`);
    else console.log('정리(--prune): lesson.json에서 참조하지 않는 이미지가 없습니다 — 옮길 것 없음.');
    process.exit(0);
  }

  if (requests.length === 0) { console.log('lesson.json에 이미지 요청({image:{...}})이 없습니다.'); process.exit(0); }

  const seenIds = new Set();
  for (const req of requests) {
    if (!req.id) throw new Error(`이미지 요청에 id가 없습니다: ${JSON.stringify(req)}`);
    if (seenIds.has(req.id)) throw new Error(`이미지 id 중복: ${req.id}`);
    seenIds.add(req.id);
    if (!req.role || !ROLES.includes(req.role))
      throw new Error(`이미지 ${req.id}: role은 ${ROLES.join('|')} 중 하나여야 합니다.`);
    // ratio를 안 쓰면 role별 기본값을 채운다(design.md "칸 크기 실측"에 맞춘 근사) — 채운 값은
    // lesson.json에 그대로 저장되어(saveLesson) 다음부터는 작성자가 눈으로 보고 고칠 수 있다.
    if (!req.ratio) req.ratio = DEFAULT_RATIO_BY_ROLE[req.role] || '4:3';
    if (!RATIOS.includes(req.ratio))
      throw new Error(`이미지 ${req.id}: ratio는 ${RATIOS.join('|')} 중 하나여야 합니다.`);
    if (!req.style || !['photo', 'illustration', 'diagram-ish'].includes(req.style))
      throw new Error(`이미지 ${req.id}: style은 photo|illustration|diagram-ish 중 하나여야 합니다.`);
    if (!req.brief || !String(req.brief).trim())
      throw new Error(`이미지 ${req.id}: brief가 필요합니다(무엇을 보여 줄 그림인지 한두 문장).`);
    if (req.state !== undefined && typeof req.state !== 'string')
      throw new Error(`이미지 ${req.id}: state는 문자열이어야 합니다(그 장면이 보여야 할 물리적 상태).`);
    for (const key of ['mustShow', 'mustNotShow'])
      if (req[key] !== undefined && (!Array.isArray(req[key]) || req[key].some(v => typeof v !== 'string')))
        throw new Error(`이미지 ${req.id}: ${key}는 문자열 배열이어야 합니다.`);
    if (req.purpose !== undefined && !PURPOSES.includes(req.purpose))
      throw new Error(`이미지 ${req.id}: purpose는 ${PURPOSES.join('|')} 중 하나여야 합니다.`);
  }
  // steps 슬라이드의 단계별 이미지가 이어받을 "바로 앞 단계"의 state — id → 텍스트 맵(images.md "단계
  // 상태 이어가기"). lesson.json에는 저장하지 않는다(순수 계산, gate.mjs의 I1도 같은 함수로 재현).
  const prevStates = stepChainPrevStates(L);
  // 이어가기 그룹(steps 슬라이드·같은 continuity) — 생성 단계에서 "하나 낡으면 그룹 전체 재생성"에 쓴다.
  const idToGroup = computeGroups(L, requests);

  // 브리프 근접 중복 경고(차단하지 않음) — 예: 표지와 개념 이미지가 사실상 같은 장면
  for (const { a, b, sim } of findNearDuplicateBriefs(requests, idToGroup))
    console.warn(`  [DUP?] "${a}"와 "${b}"의 brief가 많이 겹칩니다(겹침 약 ${Math.round(sim * 100)}%) — 같은 장면을 두 번 그리는 것일 수 있습니다. 다른 장면·다른 각도로 바꾸는 것을 검토하세요.`);

  // ── 2. 브리프 파일 ───────────────────────────────────────
  function writeBrief(req) {
    const size = RATIO_SIZE_SUBSCRIPTION[req.ratio];
    const pal = accentPalette(accent);
    const md = `# 이미지 브리프 — ${req.id}\n\n` +
      `- role: ${req.role}\n- ratio: ${req.ratio} → 기본(subscription) codex size ${size}(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)\n- style: ${req.style}\n- brief: ${req.brief}\n` +
      (req.purpose ? `- purpose: ${req.purpose}\n` : '') +
      (req.state ? `- state: ${req.state}\n` : '') +
      (req.mustShow?.length ? `- mustShow: ${req.mustShow.join(', ')}\n` : '') +
      (req.mustNotShow?.length ? `- mustNotShow: ${req.mustNotShow.join(', ')}\n` : '') + `\n` +
      `## 컴파일 방법\n` +
      `1. \`references/images.md\`를 읽는다.\n` +
      `2. \`vendor/prompt-kit/skills/image-prompt/SKILL.md\`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.\n` +
      `3. 완성 프롬프트를 lesson.json에서 이 요청의 \`image.prompt\` 필드에 넣거나, 이 폴더에 \`${req.id}.prompt.txt\`로 저장한다(끝은 \`AR ${req.ratio}\`).\n` +
      `4. \`node scripts/images.mjs <lesson.json> --compile-only\`를 다시 실행해 검증을 통과시킨다.\n\n` +
      `## 참고 팔레트 (교과 강조색 ${accent} 기준)\n${pal.join(' ')}\n`;
    fs.writeFileSync(path.join(imagesDir, `${req.id}.brief.md`), md, 'utf8');
  }

  // ── 3. 컴파일·검증 단계 ─────────────────────────────────
  async function compilePhase() {
    const missing = [], invalid = [], ready = [];
    for (const req of requests) {
      const txtFile = path.join(imagesDir, `${req.id}.prompt.txt`);
      let source = null, text = null;
      if (typeof req.prompt === 'string' && req.prompt.trim()) { source = 'lesson'; text = normalizePromptText(req.prompt); }
      else if (fs.existsSync(txtFile)) { source = 'file'; text = normalizePromptText(fs.readFileSync(txtFile, 'utf8')); }
      if (!text) { missing.push(req); writeBrief(req); continue; }

      const finalText = ensureClassroomClause(text, req, accent, L.images, prevStates.get(req.id));
      const result = await runCheckPrompt(finalText);
      if (!result.ok) { invalid.push({ req, errors: result.errors, warnings: result.warnings }); continue; }

      if (source === 'lesson') req.prompt = finalText;
      // 소스가 무엇이든 항상 images/<id>.prompt.txt에 최종본을 미러링해 둔다 — 검수할 때 바로 열어 볼 수 있고,
      // gate.mjs의 I1이 lesson.json에 prompt가 없는 경우 이 파일에서 읽어 같은 검증을 재현할 수 있다.
      fs.writeFileSync(txtFile, finalText, 'utf8');
      ready.push({ req, text: finalText, hash: sha256(finalText) });
    }
    return { missing, invalid, ready };
  }

  function printChecklist(missing, invalid, ready) {
    console.log(`이미지 요청 ${requests.length}개 — 준비 ${ready.length} · 프롬프트 없음 ${missing.length} · 검증 실패 ${invalid.length}`);
    for (const req of missing)
      console.log(`  [MISSING] ${req.id} (${req.role}/${req.ratio}/${req.style}) → images/${req.id}.brief.md 작성 — brief: "${req.brief}"`);
    for (const { req, errors } of invalid) {
      console.log(`  [INVALID] ${req.id}:`);
      for (const e of errors) console.log(`      ${e.code}: ${e.msg}${e.hint ? ` → ${e.hint}` : ''}`);
    }
    for (const { req } of ready) console.log(`  [OK] ${req.id}`);
  }

  function saveLesson() { fs.writeFileSync(ctx.file, JSON.stringify(L, null, 2) + '\n', 'utf8'); }

  // ── 4. 생성 단계 (Codex CLI) ────────────────────────────
  function loadManifest() {
    if (fs.existsSync(manifestPath)) { try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* 새로 만듦 */ } }
    return { images: {} };
  }
  function saveManifest(m) { fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf8'); }

  function sniffImage(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    return null;
  }

  // codex exec가 stderr에 찍는 "session id: <uuid>" 줄을 그대로 읽는다 — 동시에 여러 이미지를 생성할 때
  // (기본 동시성 2) ~/.codex/generated_images의 "가장 최근 폴더"로 추측하면 두 프로세스가 거의 같은
  // 시각에 끝나 서로의 폴더를 가로채는 경합이 생긴다. 각 프로세스 자신의 출력에서 직접 읽으면 경합이 없다.
  function parseCodexSessionId(text) {
    const m = String(text || '').match(/session\s*id\s*[:=]\s*([0-9a-f-]{8,})/i);
    return m ? m[1] : null;
  }

  // 프롬프트는 커맨드라인 인자가 아니라 stdin으로 넘긴다("codex exec ... -" → PROMPT를 stdin에서 읽음).
  // 이렇게 하면 프롬프트 안의 특수문자(줄바꿈·괄호·& 등)가 쉘 파싱에 걸릴 위험이 없다.
  function runCodex(prompt, size, ratio, id) {
    const instruction = [
      'Use your built-in image generation tool (not the API/CLI fallback) to generate ONE image.',
      `Save the result into the current directory as exactly "${id}.png", then print its absolute path on the last line.`,
      `Target size ${size} (aspect ratio ${ratio}).`,
      'CRITICAL — provenance: use ONLY the image produced by YOUR OWN image-generation tool call in THIS session. Copy it using the exact output path that tool call itself returns to you.',
      'Do NOT search, list, or browse $CODEX_HOME/generated_images (or any of its subfolders) to find "the most recent" or "the matching size" file. Other sessions may be generating images at the same time in that same shared directory, and picking a file that way risks copying a different session’s image by mistake.',
      '',
      'PROMPT:',
      prompt,
    ].join('\n');
    return new Promise(resolve => {
      // codex는 Windows에 codex.cmd(배치 스크립트)로 설치되어 shell 없이는 직접 실행할 수 없어 shell:true가
      // 필요하다. 다만 shell:true에 별도 args 배열을 같이 넘기면 Node가 "인자가 이스케이프 없이 그대로
      // 이어 붙는다"는 DEP0190 경고를 낸다 — 여기 인자는 전부 고정 문자열이고(프롬프트는 인자가 아니라
      // stdin으로 넘긴다) 사용자 입력이 섞일 일이 없어 안전하므로, 배열 대신 우리가 직접 이어 붙인 완성된
      // 명령줄 문자열 하나를 넘겨 그 경고를 피한다(동작은 이전과 동일).
      const child = spawn('codex exec --skip-git-repo-check -s workspace-write -', {
        cwd: imagesDir, shell: true, windowsHide: true,
      });
      let stdout = '', stderr = '', settled = false;
      const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      const timer = setTimeout(() => { try { child.kill(); } catch { /* 이미 종료됨 */ } finish({ stdout, stderr: stderr + '\n[timeout]', error: new Error('timeout') }); }, TIMEOUT_MS);
      child.stdout.on('data', d => (stdout += d));
      child.stderr.on('data', d => (stderr += d));
      child.on('close', code => finish({ stdout, stderr, error: code ? new Error(`exit ${code}`) : null }));
      child.on('error', e => finish({ stdout, stderr, error: e }));
      child.stdin.write(instruction);
      child.stdin.end();
    });
  }

  // api 경로: OPENAI_API_KEY로 과금되는 OpenAI Images API를 Node fetch로 직접 호출한다.
  // 모델 문자열을 그대로 넘긴다 — 킷이 모르는 모델이어도 대체하지 않는다. API가 모델을 거부하면
  // 그 응답 본문의 에러 메시지를 그대로 stderr에 담아 반환한다(대체 모델로 넘어가지 않고 그대로 실패).
  // 반환 형태는 runCodex와 맞춰(stdout/stderr/error) generateOne의 공통 처리 로직을 그대로 쓸 수 있게 한다.
  // 키 값은 Authorization 헤더에만 쓰고 어디에도 기록하지 않는다.
  async function runApiImageGen(prompt, size, quality, model, id) {
    const pngPath = path.join(imagesDir, `${id}.png`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(OPENAI_IMAGES_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
          signal: controller.signal,
        });
      } catch (e) {
        return { stdout: '', stderr: `OpenAI Images API 요청 실패: ${e.name === 'AbortError' ? 'timeout' : e.message}`, error: e };
      }
      const raw = await res.text();
      let json = null;
      try { json = JSON.parse(raw); } catch { /* 비JSON 응답 — 아래서 raw 그대로 노출 */ }
      if (!res.ok) {
        const msg = json?.error?.message || raw || `HTTP ${res.status}`;
        const stderr = `OpenAI Images API 에러 (HTTP ${res.status}, model=${model}): ${msg}`;
        return { stdout: '', stderr, error: new Error(msg) };
      }
      const item = json?.data?.[0];
      if (!item) return { stdout: '', stderr: `응답에 data[]가 없음: ${raw.slice(0, 1000)}`, error: new Error('empty data[]') };

      let buf;
      if (item.b64_json) {
        buf = Buffer.from(item.b64_json, 'base64');
      } else if (item.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) return { stdout: '', stderr: `이미지 URL 다운로드 실패: HTTP ${imgRes.status}`, error: new Error('download failed') };
        buf = Buffer.from(await imgRes.arrayBuffer());
      } else {
        return { stdout: '', stderr: 'data[0]에 b64_json도 url도 없음', error: new Error('no image payload') };
      }
      fs.writeFileSync(pngPath, buf);
      return { stdout: `OpenAI Images API: ${buf.length} bytes 저장됨 → ${pngPath}`, stderr: '', error: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function rasterize(browser, pngPath, id) {
    const b64 = fs.readFileSync(pngPath).toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    const page = await browser.newPage();
    try {
      const result = await page.evaluate(async ({ dataUrl, maxLong, quality }) => {
        const img = new Image();
        const loaded = new Promise((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('decode-failed')); });
        img.src = dataUrl;
        await loaded;
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error('zero-size');
        const scale = Math.min(1, maxLong / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        let url = canvas.toDataURL('image/webp', quality), ext = 'webp';
        if (!url.startsWith('data:image/webp')) { url = canvas.toDataURL('image/jpeg', quality); ext = 'jpg'; }
        return { w, h, url, ext };
      }, { dataUrl, maxLong: 1600, quality: 0.85 });
      const webPath = path.join(imagesDir, `${id}.web.${result.ext}`);
      fs.writeFileSync(webPath, Buffer.from(result.url.split(',')[1], 'base64'));
      return { w: result.w, h: result.h, webExt: result.ext };
    } finally { await page.close(); }
  }

  async function generateOne(req, text, hash, manifest, browser, routeCtx) {
    const { ROUTE, forcedModel, quality, genState } = routeCtx;
    const size = (ROUTE === 'api' ? RATIO_SIZE_API : RATIO_SIZE_SUBSCRIPTION)[req.ratio];
    const pngPath = path.join(imagesDir, `${req.id}.png`);
    const logPath = path.join(imagesDir, `${req.id}.codex.log`);
    const log = s => fs.appendFileSync(logPath, s.endsWith('\n') ? s : s + '\n', 'utf8');
    const modelLabel = ROUTE === 'api' ? forcedModel : 'server-selected(subscription)';
    log(`\n==== ${new Date().toISOString()} classforge images.mjs — ${req.id} (route=${ROUTE}, model=${modelLabel}, ${size}, ${req.ratio}) ====`);

    for (let attempt = 1; attempt <= 2; attempt++) {
      log(`-- attempt ${attempt}/2 --`);
      // 이번 시도 전용 임시 이름으로 생성한다 — 검증을 전부 통과하기 전까지는 기존 최종 파일
      // (pngPath, 있다면 지난 성공분)을 절대 건드리지 않는다. 예전에는 시도 시작과 동시에 마지막으로
      // 성공한 파일을 rmSync로 지워버려서, 이번 시도가 실패하면 매니페스트는 성공을 가리키는데 실제
      // 파일은 사라지는 데이터 유실 사고가 났다(re-run 없이는 복구 불가). 모든 검사(시그니처·크기/비율·
      // provenance·중복 해시)를 통과한 뒤에만 renameSync로 최종 이름에 원자적으로 덮어쓴다.
      const tempId = `${req.id}.tmp-${attempt}-${crypto.randomBytes(4).toString('hex')}`;
      const tempPngPath = path.join(imagesDir, `${tempId}.png`);
      let tempWebPath = null;
      try {
        const { stdout, stderr, error } = ROUTE === 'api'
          ? await runApiImageGen(text, size, quality, forcedModel, tempId)
          : await runCodex(text, size, req.ratio, tempId);
        if (stdout) log(`stdout:\n${stdout}`);
        if (stderr) log(`stderr:\n${stderr}`);
        if (error) log(`error: ${error.message || error}`);

        // codex CLI가 WebSocket→HTTPS 폴백 중 401(Incorrect API key)을 내는 경우가 있다 — 이는 이
        // 이미지 하나만의 문제가 아니라 계정 인증 세션 자체가 갱신이 필요한 상태라서, 같은 실행에
        // 남은 다른 이미지들도 전부 같은 이유로 실패할 것이 거의 확실하다(관찰 사례: season-step3-orbit,
        // 유휴 시간이 길었던 뒤 재시도해도 몇 시간 동안 계속 401이다가 저절로 풀림). 이번 시도를 더
        // 재시도해 봐야 소용없으니 바로 포기하고, 실행 전체를 조기 종료하도록 상위(main)에 신호를 보낸다.
        if (ROUTE === 'subscription' && /401\b[\s\S]*?(Unauthorized|Incorrect API key)/i.test(`${stdout}\n${stderr}`)) {
          genState.authFailed = true;
          log('실패: Codex 인증 오류(401) — 이후 시도를 중단합니다.');
          break;
        }

        // codex exec 자신의 stderr에서 이 시도의 세션 id를 먼저 뽑아 둔다 — 아래 fallback 복사와 중복 검사
        // 둘 다 "동시에 실행 중인 다른 세션의 파일을 잘못 집었는지"를 세션 id로 가늠하는 데 쓴다.
        const mySessionId = ROUTE === 'subscription' ? parseCodexSessionId(stderr) : null;
        if (!fs.existsSync(tempPngPath)) {
          // 에이전트의 셸 명령·결과(경로가 나오는 자리)는 이 codex CLI 버전에서 stdout이 아니라 stderr에
          // 찍힌다(blind5 로그로 실측 확인 — 위 parseProvenance 설명 참고) — 그래서 둘 다 훑는다.
          const m = (`${stdout}\n${stderr}`).match(/[A-Za-z]:[\\/][^\r\n"]+?\.png|\/[^\r\n"]+?\.png/g) || [];
          const candidates = m.map(s => s.trim()).filter(p => fs.existsSync(p));
          // 내 세션 id가 경로에 들어간 후보를 우선한다 — 여러 png 경로가 언급될 수 있고(예: 에이전트가
          // 후보를 비교하며 다른 세션 폴더를 함께 나열), 세션 id 없이 첫 번째를 집으면 동시 실행 중인 다른
          // 요청의 파일을 잘못 가져올 수 있다(실제 사고: blind5-photoelectric, 아래 "중복 검사" 참고).
          const candidate = (mySessionId && candidates.find(p => p.includes(mySessionId))) || candidates[0];
          if (candidate) { fs.copyFileSync(candidate, tempPngPath); log(`경로 찾아 복사함: ${candidate}${mySessionId ? (candidate.includes(mySessionId) ? ' (세션 id 일치)' : ' (세션 id 불일치 — 경고)') : ''}`); }
        }
        if (!fs.existsSync(tempPngPath)) { log('실패: png 파일을 찾지 못함'); continue; }

        const buf = fs.readFileSync(tempPngPath);
        if (!sniffImage(buf)) { log('실패: PNG/JPEG 시그니처가 아님'); continue; }

        let dims;
        try { dims = await rasterize(browser, tempPngPath, tempId); }
        catch (e) { log(`실패: 이미지 디코드 실패 — ${e.message}`); continue; }
        tempWebPath = path.join(imagesDir, `${tempId}.web.${dims.webExt}`);

        // 목표 비율은 codex에 실제로 요청한 size(6종 사이즈락)의 비율로 잰다 — "4:3"·"3:4"는
        // 그 자체가 이미 codex가 낼 수 있는 가장 가까운 3:2/2:3 버킷의 근사 표기이기 때문이다
        // (vendor/prompt-kit의 AR_SIZE_MAP과 동일한 근사). 레이블 분수(4/3)와 비교하면 항상 ~12% 어긋나 오탐한다.
        const [tw, th] = size.split('x').map(Number);
        const targetRatio = tw / th, actualRatio = dims.w / dims.h;
        const longSide = Math.max(dims.w, dims.h);
        if (longSide < 1024) { log(`실패: 긴 변 ${longSide}px < 1024`); continue; }
        if (Math.abs(actualRatio / targetRatio - 1) > 0.10) {
          log(`실패: 비율 불일치 (요청 size ${size}, 실제 ${dims.w}x${dims.h})`); continue;
        }

        // ── 생성 출처 확인(provenance) ───────────────────────────
        // 이번 시도의 stdout에서 "실제로 복사한 원본이 어느 세션 폴더에 있었는지"를 역추적한다(위
        // parseProvenance 설명 참고). 다른 세션의 파일을 가져온 것으로 보이면 이번 시도는 실패로 치고
        // 다시 시도한다 — 재시도는 새 세션이라 같은 경합이 반복될 확률이 낮다. api 경로는 에이전트가 직접
        // HTTP로 받아오므로 이 문제 자체가 없다(검사하지 않는다).
        let provenanceWarning = false;
        if (ROUTE === 'subscription') {
          const prov = parseProvenance(`${stdout}\n${stderr}`, mySessionId);
          if (prov.broadListing) {
            provenanceWarning = true;
            log(`경고: 이번 시도의 stdout에 generated_images 전체를 훑는 명령(예: Get-ChildItem ... -Recurse)이 보임 — 이번엔 결과가 맞았더라도 위험한 습관(provenanceWarning)`);
          }
          if (prov.crossSession) {
            log(`실패: 복사 출처가 다른 세션(${prov.sourceSessionId})의 파일로 보임(내 세션 ${mySessionId}) — 경로: ${prov.sourcePath}. 다시 시도합니다.`);
            continue;
          }
        }

        // ── 중복 생성 검사(사후 가드) ────────────────────────────
        // codex의 내장 image_gen 도구는 자기 결과물을 $CODEX_HOME/generated_images/<세션 id>/에 두고,
        // 에이전트가 그중 "방금 만든 파일"을 스스로 찾아 우리가 지정한 이름으로 복사한다 — 이 탐색이
        // 세션 id로 좁혀지지 않고 그 폴더 전체(과거 세션 포함)를 뒤지는 경우가 있어, 동시에(--concurrency
        // ≥2) 실행 중인 다른 요청이 방금 막 써 놓은 파일을 자기 것으로 착각해 그대로 복사하는 사고가 실제로
        // 있었다(블라인드 테스트 blind5-photoelectric: pe-cover와 pe-concept이 sha256까지 완전히 같은 파일로
        // 나옴 — 로그를 보면 concept 쪽 에이전트가 자기 세션(…3cdc)이 아니라 cover의 세션(…3d7e) 폴더에서
        // "요청 크기와 정확히 일치하는" 파일을 집어 복사했다). 이미지 내용의 sha256이 이미 manifest에 있는
        // 다른 id와 완전히 같으면 그 사고로 보고 실패 처리해 재시도한다(위 세션 id 우선 로직과 함께 쓰면
        // 재시도에서는 다른 세션이 되어 대개 해소된다).
        const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
        const dupEntry = Object.values(manifest.images).find(e => e.id !== req.id && e.contentHash === contentHash);
        if (dupEntry) {
          log(`실패: 생성된 이미지가 "${dupEntry.id}"와 sha256까지 완전히 같음 — 동시 실행 중인 다른 요청의 파일을 잘못 가져온 것으로 의심됨. 다시 시도합니다.`);
          continue;
        }

        // ── 커밋: 모든 검사를 통과한 뒤에만 최종 이름으로 원자적 rename ──────────
        // fs.renameSync는 Windows에서도(libuv가 MoveFileExW를 MOVEFILE_REPLACE_EXISTING로 호출)
        // 목적지가 이미 있으면 그 자리에서 교체한다 — 별도 삭제 없이 원자적이다. 이전 성공분이 다른
        // 확장자(webp↔jpg 폴백)로 남아 있었다면 그 찌꺼기만 정리한다.
        for (const ext of ['webp', 'jpg']) {
          if (ext === dims.webExt) continue;
          const stale = path.join(imagesDir, `${req.id}.web.${ext}`);
          if (fs.existsSync(stale)) fs.rmSync(stale);
        }
        const finalWebPath = path.join(imagesDir, `${req.id}.web.${dims.webExt}`);
        fs.renameSync(tempPngPath, pngPath);
        fs.renameSync(tempWebPath, finalWebPath);
        tempWebPath = null; // 이미 최종 이름으로 옮겨졌으니 finally에서 지울 것이 없다

        manifest.images[req.id] = {
          id: req.id, promptHash: hash, contentHash, file: `images/${req.id}.png`, web: `images/${req.id}.web.${dims.webExt}`,
          width: dims.w, height: dims.h, bytes: buf.length, ratio: req.ratio, role: req.role, style: req.style,
          route: ROUTE, model: ROUTE === 'api' ? forcedModel : 'server-selected',
          quality: ROUTE === 'api' ? quality : null,
          codexSessionId: mySessionId,
          provenanceWarning,
          createdAt: new Date().toISOString(),
        };
        log(`성공: ${dims.w}x${dims.h}, ${buf.length} bytes, web=.${dims.webExt}`);
        return true;
      } finally {
        // 이번 시도가 실패해 continue하거나 도중에 예외가 나면, 이번 시도가 만든 임시 파일만 지운다
        // (이미 rename되어 사라졌다면 existsSync가 false라 안전하게 건너뜀). 최종 pngPath/web 파일 —
        // 즉 지난 성공분 — 은 이 블록에서 절대 건드리지 않는다.
        if (fs.existsSync(tempPngPath)) { try { fs.rmSync(tempPngPath); } catch { /* 정리 실패는 무시 */ } }
        if (tempWebPath && fs.existsSync(tempWebPath)) { try { fs.rmSync(tempWebPath); } catch { /* 정리 실패는 무시 */ } }
      }
    }
    return false;
  }

  async function pool(items, limit, worker) {
    let i = 0;
    const results = new Array(items.length);
    async function runner() { while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); } }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return results;
  }

  // ── 실행 ─────────────────────────────────────────────────
  const { missing, invalid, ready } = await compilePhase();
  printChecklist(missing, invalid, ready);
  saveLesson();

  if (missing.length || invalid.length) {
    console.error(`\n${missing.length + invalid.length}개 이미지가 준비되지 않았습니다. 위 안내(브리프·오류)를 따라 lesson.json 또는 images/<id>.prompt.txt를 고친 뒤 다시 실행하세요.`);
    process.exit(COMPILE_ONLY ? 2 : 1);
  }

  // ── 경로 선택: subscription(기본, Codex 내장 도구, 모델 선택 불가) vs api(모델 강제, OPENAI_API_KEY 과금) ──
  const forcedModel = (L.images && L.images.model) || process.env.CLASSFORGE_IMAGE_MODEL || null;
  const apiQuality = (L.images && L.images.quality) || 'high';
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  let ROUTE;
  if (ROUTE_FLAG === 'subscription' || ROUTE_FLAG === 'api') {
    ROUTE = ROUTE_FLAG;
    if (ROUTE === 'api' && !hasApiKey) {
      console.error('--route api 이지만 OPENAI_API_KEY가 설정되어 있지 않습니다. 환경변수를 설정하거나 --route subscription을 쓰세요.');
      process.exit(2);
    }
  } else if (forcedModel) {
    if (!hasApiKey) {
      console.error(
        `lesson.json의 images.model(또는 CLASSFORGE_IMAGE_MODEL) = "${forcedModel}" 이 설정되어 있지만 OPENAI_API_KEY가 없습니다.\n` +
        `이 모델은 api 경로(사용자의 OpenAI API 과금)에서만 강제할 수 있습니다 — Codex 내장 image_generation 도구(구독 쿼터)는 모델을 선택할 수 없습니다.\n` +
        `OPENAI_API_KEY를 설정해 강제 지정하거나, --route subscription으로 서버가 고른 모델(구독 쿼터)을 쓰세요.`
      );
      process.exit(2);
    }
    ROUTE = 'api';
  } else {
    ROUTE = 'subscription';
  }
  const genState = { authFailed: false };
  const routeCtx = { ROUTE, forcedModel, quality: apiQuality, genState };

  const manifest = loadManifest();
  // 캐시 키는 사실상 (promptHash, route, model[, quality]) 튜플이다 — 프롬프트가 그대로여도
  // 경로·강제 모델·품질이 바뀌면 다른 이미지가 나올 수 있으므로 캐시를 무효화하고 다시 생성한다.
  const isStale = ({ req, hash }) => {
    if (FORCE) return true;
    const cached = manifest.images[req.id];
    if (!cached || cached.promptHash !== hash || !fs.existsSync(path.join(imagesDir, `${req.id}.png`))) return true;
    // route가 없는 옛 manifest 항목은 이 기능 이전의 유일한 경로였던 subscription으로 간주한다
    // (그렇지 않으면 route 필드를 추가하는 것만으로 기존 캐시가 전부 무효화되어 조용히 재생성·재과금된다).
    const cachedRoute = cached.route || 'subscription';
    if (cachedRoute !== ROUTE) return true; // 경로가 바뀌면(subscription↔api) 같은 프롬프트여도 다시 생성
    if (ROUTE === 'api' && (cached.model !== forcedModel || cached.quality !== apiQuality)) return true; // 강제 모델·품질이 바뀌어도 다시 생성
    return false;
  };

  let toGenerate;
  if (ONLY_IDS) {
    // --only: 지정한 id만 캐시 여부와 무관하게 다시 만든다. 그 id가 속한 이어가기 그룹의 다른 멤버가
    // --only 목록에 없으면 경고만 하고(막지 않는다) 계속 진행 — 작성자가 "이 한 장만" 의도한 것일 수도 있다.
    const idSet = new Set(ONLY_IDS);
    const unknown = ONLY_IDS.filter(id => !ready.some(r => r.req.id === id));
    if (unknown.length) console.warn(`  [경고] --only에 준 id 중 준비된 이미지 요청에 없는 것: ${unknown.join(', ')}`);
    for (const id of ONLY_IDS) {
      const group = idToGroup.get(id);
      if (!group) continue;
      const missing = [...group].filter(gid => gid !== id && !idSet.has(gid));
      if (missing.length)
        console.warn(`  [경고] --only로 "${id}"만 지정했지만 같은 이어가기 그룹(steps 슬라이드 또는 같은 continuity)에 ${missing.join(', ')}이(가) 더 있습니다 — 이 이미지만 다시 만들면 나머지와 이어짐이 어긋날 수 있습니다. 그룹 전체를 같이 다시 만들려면 --only에 그 id들도 추가하거나 --only 없이 실행하세요.`);
    }
    toGenerate = ready.filter(({ req }) => idSet.has(req.id));
  } else {
    // 기본 동작: 낡은 이미지를 전부 다시 만든다. 그 중 하나라도 이어가기 그룹에 속하면(steps 슬라이드
    // 또는 같은 continuity) 그 그룹의 나머지 멤버도 함께 다시 만든다 — 그룹 절반만 새로 만들면 이어지던
    // 장면이 끊긴다(실제 사고: blind4-photo에서 continuity를 바꿨는데 4단계 중 1장만 다시 만듦).
    const staleIds = new Set(ready.filter(isStale).map(r => r.req.id));
    const expanded = new Set(staleIds);
    for (const id of staleIds) { const group = idToGroup.get(id); if (group) for (const gid of group) expanded.add(gid); }
    const addedByGroup = [...expanded].filter(id => !staleIds.has(id));
    if (addedByGroup.length)
      console.log(`이어가기 그룹 확장: 같은 그룹의 다른 이미지가 낡아 ${addedByGroup.join(', ')}도 함께 다시 만듭니다(순서를 지키기 위해 그룹째로 다시 만듭니다).`);
    toGenerate = ready.filter(({ req }) => expanded.has(req.id));
  }

  // --compile-only는 실제로 생성하지 않는다 — 대신 "지금 플래그 없이 실행하면 무엇을 다시 만들지"를
  // 미리 보여준다(그룹 확장 포함, 실제 codex 호출 없음). continuity를 바꾸고 --compile-only만 돌려도
  // 그룹 전체가 다시 만들어질 대상인지 바로 확인할 수 있다.
  if (COMPILE_ONLY) {
    console.log('\n모든 이미지 프롬프트가 컴파일·검증되었습니다.');
    if (toGenerate.length)
      console.log(`(dry-run) node scripts/images.mjs <lesson.json>을 실행하면 다시 만들 이미지 ${toGenerate.length}개: ${toGenerate.map(({ req }) => req.id).join(', ')}`);
    else console.log('(dry-run) 캐시가 모두 최신 상태 — 다시 만들 이미지 없음.');
    process.exit(0);
  }
  if (toGenerate.length === 0) { console.log('\n생성할 이미지 없음 — 캐시가 모두 최신 상태입니다.'); process.exit(0); }

  console.log(`\n${toGenerate.length}개 이미지를 생성합니다(경로 ${ROUTE}${ROUTE === 'api' ? `, 모델 ${forcedModel}, 품질 ${apiQuality}` : ''}, 동시성 ${CONCURRENCY})...`);
  const browser = await launch();
  const failures = [];
  try {
    await pool(toGenerate, CONCURRENCY, async ({ req, text, hash }) => {
      // 이미 다른 이미지에서 Codex 인증 오류(401)로 중단이 결정됐으면 — 같은 실행에서 남은 이미지도
      // 전부 같은 이유로 실패할 것이 거의 확실하므로 — 새로 시작하지 않고 바로 실패 처리한다(이미
      // 진행 중이던 요청까지 강제로 끊지는 않는다).
      if (genState.authFailed) {
        console.log(`  SKIP ${req.id} (인증 오류로 중단됨)`);
        failures.push(req.id);
        return;
      }
      const ok = await generateOne(req, text, hash, manifest, browser, routeCtx);
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${req.id}`);
      if (!ok) failures.push(req.id);
    });
  } finally {
    await browser.close();
    saveManifest(manifest);
  }

  if (genState.authFailed) {
    console.error(`\n실패/건너뜀: ${failures.join(', ')}`);
    console.error('Codex 인증 오류(401) — 잠시 뒤 다시 실행하거나 `codex login`으로 다시 로그인하세요. 기존 이미지는 그대로 남아 있습니다.');
    process.exit(1);
  }
  if (failures.length) {
    console.error(`\n실패한 이미지: ${failures.join(', ')} — images/<id>.codex.log를 확인하세요.`);
    process.exit(1);
  }
  console.log('\n모든 이미지 생성·검증 완료. images/manifest.json 참고.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
