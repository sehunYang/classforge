// classforge gate — 수업 자료 품질 게이트. 정적 검사(S) 후 브라우저 실측(B). 하나라도 FAIL이면 exit 1.
// 사용: node gate.mjs <lesson.json>   (먼저 build.mjs로 out/을 만들어 둘 것)
// 리포트: out/gate-report.json  {ok, gates:[{id,name,ok,errors:[{code,msg,hint}],warnings:[...]}]}
import fs from 'node:fs';
import path from 'node:path';
import { loadLesson, launch, fileUrl, plain, SLIDE_TYPES, ITEM_TYPES } from './lib.mjs';
import { parseIntake, checkReflection } from './intake.mjs';
import { collect as collectImageRequests, ensureClassroomClause, runCheckPrompt, sha256 } from './images.mjs';

const lessonPath = process.argv[2];
if (!lessonPath) { console.error('사용: node gate.mjs <lesson.json>'); process.exit(2); }
const ctx = loadLesson(lessonPath);
const { lesson: L, out, rules, level, accent } = ctx;
const M = L.meta || {};
const gates = [];
function gate(id, name, fn) {
  const g = { id, name, ok: true, errors: [], warnings: [] };
  const err = (code, msg, hint) => g.errors.push({ code, msg, ...(hint ? { hint } : {}) });
  const warn = (code, msg) => g.warnings.push({ code, msg });
  return Promise.resolve().then(() => fn(err, warn)).catch(e => err('EXC', `게이트 실행 오류: ${e.message}`))
    .finally(() => { g.ok = g.errors.length === 0; gates.push(g); });
}
const slides = L.slides || [];
const W = L.worksheet || {};
const items = (W.sections || []).flatMap(s => s.items || []);
const questions = items.filter(i => !['concept', 'figure', 'passage'].includes(i.type));
const objs = L.objectives || [];
const stripSvg = s => String(s ?? '').replace(/<[^>]+>/g, ' ');
// $...$ 수식은 렌더링되면 훨씬 짧아 보인다 — 글자 수 "세는 값"에서만 접는다(원문 표시는 그대로 둔다).
// 백슬래시 명령(\alpha, \times…)은 렌더링되면 글자 1개이므로 1글자로, 중괄호·^·_는 화면에 안 보이므로 지운다.
const mathLen = s => String(s ?? '').replace(/\$([^$\n]+)\$/g, (_, e) => e.replace(/\\[A-Za-z]+/g, 'x').replace(/[{}^_]/g, ''));
const clen = s => plain(mathLen(s)).length;
// 화면에 글자로 나오는 값만 모은다. visual(삽화·그래프 설정)은 어느 깊이에 있든 뺀다.
const SKIP = new Set(['type', 'notes', 'reveal', 'hot', 'visual', 'answer', 'minutes', 'no', 'fact']);
const textOf = v => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(textOf).join(' ')
  : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => !SKIP.has(k)).map(([, x]) => textOf(x)).join(' ') : '';
const slideText = s => textOf(s);
// 슬라이드 안 모든 visual (SVG 문자열 또는 bars 값)
const visualsOf = v => Array.isArray(v) ? v.flatMap(visualsOf) : v && typeof v === 'object'
  ? Object.entries(v).flatMap(([k, x]) => k === 'visual' ? [x] : visualsOf(x)) : [];
// 슬라이드/활동지 문항이 쓸 수 있는 필드 목록 — 오타 경고(S1-UNKNOWN/S1-WS-UNKNOWN)용. lesson-schema.md와 맞춘다.
const SLIDE_COMMON_KEYS = ['type', 'notes', 'kicker', 'reveal'];
const SLIDE_KEYS = {
  cover: ['title', 'subtitle', 'visual'], goals: ['items', 'title', 'question'],
  hook: ['question', 'visual', 'lead', 'caption'], chapter: ['title', 'no', 'sub'],
  concept: ['title', 'points', 'lead', 'visual', 'caption'], compare: ['title', 'left', 'right', 'note'],
  steps: ['title', 'steps', 'hot'], diagram: ['title', 'visual', 'caption'],
  bignum: ['value', 'label', 'fact', 'unit', 'caption', 'source', 'visual'], quiz: ['question', 'answer', 'choices', 'explain'],
  activity: ['title', 'steps', 'minutes', 'mode', 'worksheetRef', 'output'], vocab: ['terms', 'title'],
  timeline: ['title', 'events'], summary: ['title', 'items', 'next'], exit: ['question', 'hint'], passage: ['title', 'chunks', 'note'],
};
const ITEM_COMMON_KEYS = ['type', 'obj', 'points'];
const ITEM_KEYS = {
  concept: ['text'], choice: ['q', 'choices', 'answer', 'explain', 'cols'], short: ['q', 'lines', 'answer', 'explain'],
  ox: ['q', 'rows'], match: ['q', 'left', 'right', 'answer'], table: ['q', 'head', 'rows'],
  draw: ['q', 'height', 'model', 'placeholder', 'base', 'answer'], figure: ['svg', 'image', 'visual', 'caption', 'height'],
  passage: ['text', 'title', 'source', 'start'],
};

// ── S1 구조 ────────────────────────────────────────────
await gate('S1', '레슨 구조', (err, warn) => {
  for (const k of ['title', 'subject', 'grade', 'level', 'unit', 'minutes']) if (!M[k]) err('S1-META', `meta.${k} 없음`, 'lesson.schema.md의 meta 항목을 채우세요');
  if (!(M.level in { elem: 1, middle: 1, high: 1 })) err('S1-LEVEL', `meta.level은 elem|middle|high 중 하나여야 함 (현재 ${M.level})`);
  if (objs.length < 1 || objs.length > 3) err('S1-OBJ-N', `학습 목표 ${objs.length}개 — 1~3개`, '한 차시에 확인 가능한 목표만 남기세요');
  objs.forEach((o, i) => { if (!/수 있다\.?$/.test(o.trim())) err('S1-OBJ-FORM', `학습 목표 ${i + 1}이 "~할 수 있다."로 끝나지 않음: ${o}`, '관찰 가능한 행동 동사 + "수 있다."'); });
  if (slides.length < 8 || slides.length > 20) err('S1-SLIDES-N', `슬라이드 ${slides.length}장 — 8~20장`);
  if (slides[0]?.type !== 'cover') err('S1-FIRST', '첫 슬라이드는 cover여야 함');
  if (!['exit', 'summary'].includes(slides.at(-1)?.type)) err('S1-LAST', '마지막 슬라이드는 summary 또는 exit');
  const need = { goals: 1, quiz: 1, activity: 1, summary: 1 };
  for (const [t, n] of Object.entries(need)) if (slides.filter(s => s.type === t).length < n) err('S1-NEED', `${t} 슬라이드가 없음`, '도입(목표)·확인(quiz)·활동(activity)·정리(summary)는 필수');
  if (!slides.some(s => s.visual || s.left?.visual || s.steps?.some?.(p => p.visual))) err('S1-VISUAL', '삽화(visual)가 있는 슬라이드가 하나도 없음', 'hook/concept/diagram 중 1장 이상에 SVG 삽화를 넣으세요');
  const sameRun = slides.reduce((a, s, i) => (i && s.type === slides[i - 1].type ? a + 1 : 0) > 1 ? Math.max(a, 2) : a, 0);
  let run = 1; for (let i = 1; i < slides.length; i++) { run = slides[i].type === slides[i - 1].type ? run + 1 : 1; if (run >= 3) err('S1-RUN', `${i - 1}~${i + 1}번 슬라이드가 같은 유형(${slides[i].type})으로 3장 연속`, '유형을 섞어 리듬을 만드세요'); }
  void sameRun;
  slides.forEach((s, i) => {
    const n = i + 1;
    if (!SLIDE_TYPES.includes(s.type)) return err('S1-TYPE', `${n}번 슬라이드 유형 ${s.type} 없음`, SLIDE_TYPES.join(', '));
    const knownSlideKeys = new Set([...SLIDE_COMMON_KEYS, ...(SLIDE_KEYS[s.type] || [])]);
    Object.keys(s).forEach(k => { if (!knownSlideKeys.has(k)) warn('S1-UNKNOWN', `${n}번(${s.type}) 알 수 없는 필드 "${k}" — 오타 확인. 이 유형이 쓰는 필드: ${[...knownSlideKeys].join(', ')}`); });
    if (!s.notes || plain(s.notes).length < 20) err('S1-NOTES', `${n}번 슬라이드 발표자 노트가 없거나 20자 미만`, '교사가 말할 핵심·발문을 적으세요');
    const req = { hook: ['question', 'visual'], concept: ['title', 'points'], compare: ['title', 'left', 'right'], steps: ['title', 'steps'], diagram: ['title', 'visual'],
      bignum: ['value', 'label', 'fact'], quiz: ['question', 'answer'], activity: ['title', 'steps', 'minutes'], vocab: ['terms'], timeline: ['title', 'events'],
      summary: ['title', 'items'], exit: ['question'], chapter: ['title'], passage: ['title', 'chunks'] }[s.type] || [];
    for (const k of req) if (s[k] === undefined || s[k] === '') err('S1-FIELD', `${n}번(${s.type})에 ${k} 없음`);
    const cnt = { passage: ['chunks', 1, 4], concept: ['points', 1, rules.pointsMax], steps: ['steps', 3, 5], vocab: ['terms', 2, 4], timeline: ['events', 3, 5], summary: ['items', 2, 3] }[s.type];
    if (cnt && Array.isArray(s[cnt[0]]) && (s[cnt[0]].length < cnt[1] || s[cnt[0]].length > cnt[2])) err('S1-COUNT', `${n}번(${s.type}) ${cnt[0]} ${s[cnt[0]].length}개 — ${cnt[1]}~${cnt[2]}개`);
    if (s.type === 'quiz' && s.choices && !(s.answer >= 1 && s.answer <= s.choices.length)) err('S1-QUIZ', `${n}번 quiz answer가 선택지 번호(1~${s.choices.length})가 아님`);
  });
  const secs = W.sections || [];
  if (secs.length < 2) err('S1-WS-SEC', `활동지 섹션 ${secs.length}개 — 2개 이상`);
  if (questions.length < 5 || questions.length > 14) err('S1-WS-Q', `활동지 문항 ${questions.length}개 — 5~14개`);
  items.forEach((it, i) => {
    if (!ITEM_TYPES.includes(it.type)) return err('S1-WS-TYPE', `활동지 문항 유형 ${it.type} 없음`, ITEM_TYPES.join(', '));
    const knownItemKeys = new Set([...ITEM_COMMON_KEYS, ...(ITEM_KEYS[it.type] || [])]);
    Object.keys(it).forEach(k => { if (!knownItemKeys.has(k)) warn('S1-WS-UNKNOWN', `활동지 문항(${it.type}) 알 수 없는 필드 "${k}" — 오타 확인. 이 유형이 쓰는 필드: ${[...knownItemKeys].join(', ')}`); });
    if (it.type === 'figure' && !it.svg && !it.image && !it.visual) err('S1-WS-FIGEMPTY', `figure 문항(${it.caption ? plain(it.caption).slice(0, 20) + '…' : i + 1 + '번째'})에 svg/image/visual이 모두 없음 — 빈 자료 칸만 나감`, 'visual(또는 예전 이름 svg/image)에 <svg> 문자열·{plot}/{bars}·{image:{...}} 중 하나를 넣으세요');
    if (it.type === 'choice' && !(it.answer >= 1 && it.answer <= it.choices?.length)) err('S1-WS-ANS', `활동지 선택형 문항(${plain(it.q).slice(0, 20)}…) answer 오류`);
    if (it.type === 'short' && !it.answer) err('S1-WS-ANS', `서술형 문항(${plain(it.q).slice(0, 20)}…)에 answer(모범 답안) 없음`);
    if (it.type === 'draw' && !it.model) err('S1-WS-ANS', `그리기 문항(${plain(it.q).slice(0, 20)}…)에 model(채점 기준) 없음`);
    if (it.type === 'draw' && /좌표평면|그래프를 그|그래프로 나타|지도에|지도 위|백지도/.test(plain(it.q)) && !it.base) err('S1-WS-BASE', `그리기 문항 "${plain(it.q).slice(0, 24)}…"에 바탕 그림(base: 좌표평면 plot 또는 백지도 SVG)이 없음`, '학생이 그 위에 그릴 수 있게 base를 넣고, 정답지용 answer도 넣으세요');
    if (it.type === 'draw' && it.base?.plot && !it.answer) err('S1-WS-BASE', `좌표평면 그리기 문항 "${plain(it.q).slice(0, 24)}…"에 정답 그래프(answer)가 없음`, '정답지에 그려질 answer: {plot: …}를 넣으세요');
    if (it.type === 'match' && (!it.answer || it.answer.length !== it.left?.length)) err('S1-WS-ANS', '선 잇기 answer 쌍 수가 왼쪽 항목 수와 다름');
    if (it.type === 'match' && it.answer?.length > 1 && it.answer.every(([a, b]) => a === b)) warn('S1-MATCH-ID', `선 잇기 answer가 항등 대응(1-1, 2-2, …)임 — 왼쪽·오른쪽 순서를 섞어 실제로 짝을 찾게 하세요`);
    if (it.type === 'ox' && it.rows?.some(r => typeof r.a !== 'boolean')) err('S1-WS-ANS', 'OX 문항 rows[].a는 true/false');
    if (it.type === 'concept' && !/\{\{.+?\}\}/.test(it.text)) err('S1-WS-BLANK', '개념 정리(concept)에 {{빈칸}}이 없음');
    if (it.type === 'table' && !it.rows?.flat().some(c => /^\{\{.*\}\}$/.test(c))) err('S1-WS-BLANK', '표 문항에 {{빈칸}} 칸이 없음');
  });
  const P = L.plan || {};
  const stages = [...new Set((P.flow || []).map(r => r.stage))];
  if (stages.join('>') !== '도입>전개>정리') err('S1-PLAN-STAGE', `지도안 단계 순서가 도입>전개>정리가 아님 (${stages.join('>')})`);
  const sum = (P.flow || []).reduce((a, r) => a + (r.minutes || 0), 0);
  if (sum !== M.minutes) err('S1-PLAN-MIN', `지도안 시간 합 ${sum}분 ≠ 차시 ${M.minutes}분`);
  (P.flow || []).forEach((r, i) => { if (!r.teacher?.length || !r.student?.length) err('S1-PLAN-ACT', `지도안 ${i + 1}행에 교사/학생 활동이 모두 있어야 함`); });
  const actMin = slides.filter(s => s.type === 'activity').reduce((a, s) => a + (s.minutes || 0), 0);
  if (actMin > M.minutes * 0.6) warn('S1-ACT-MIN', `활동 슬라이드 시간 합 ${actMin}분이 차시의 60%를 넘음`);
  if (!P.checkpoint) err('S1-PLAN-CHECK', '지도안 checkpoint(다음으로 넘어가도 되는 기준 1문장) 없음');
  if (!P.evaluation?.length) err('S1-PLAN-EVAL', '지도안 평가 계획(evaluation) 없음');
});

// ── S2 글자 수 예산 ─────────────────────────────────────
await gate('S2', '글자 수 예산', (err, warn) => {
  slides.forEach((s, i) => {
    const n = i + 1;
    const t = plain(s.title || s.question || '');
    const tmax = ['quiz', 'exit', 'hook', 'goals'].includes(s.type) ? rules.titleMax * 2 : ['cover', 'chapter'].includes(s.type) ? rules.titleMax + 6 : rules.titleMax;
    const tlen = clen(s.title || s.question || '');
    if (tlen > tmax) err('S2-TITLE', `${n}번 제목/질문 ${tlen}자 > ${tmax}자: "${t}"`, '핵심 메시지만 남기고 설명은 노트로');
    const bullets = [...(s.points || []).flatMap(p => [p.h]), ...(s.steps || []).map(p => p.h || p), ...(s.items || []), ...(s.left?.items || []), ...(s.right?.items || []), ...(s.choices || [])];
    bullets.forEach(b => { const len = clen(b); if (len > rules.bulletMax) err('S2-BULLET', `${n}번 항목 ${len}자 > ${rules.bulletMax}자: "${plain(b)}"`, '두 항목으로 나누거나 줄이세요'); });
    [...(s.points || []), ...(s.steps || [])].forEach(p => { if (p.t && clen(p.t) > rules.bulletMax * 1.7) err('S2-DESC', `${n}번 설명 ${clen(p.t)}자 > ${Math.round(rules.bulletMax * 1.7)}자`); });
    const total = plain(mathLen(stripSvg(slideText(s)))).replace(/[\s{}[\]",:]/g, '').length;
    const cap = s.type === 'passage' ? rules.slideChars * 3 : rules.slideChars;
    if (s.type === 'passage') { if (total > cap) err('S2-TOTAL', `${n}번(passage) 지문 ${total}자 > ${cap}자`, '지문을 두 장으로 나누세요'); return; }
    if (total > rules.slideChars) err('S2-TOTAL', `${n}번(${s.type}) 화면 글자 ${total}자 > ${rules.slideChars}자`, '슬라이드를 둘로 나누거나 설명을 노트로 옮기세요');
    else if (total > rules.slideChars * 0.85) warn('S2-TOTAL', `${n}번 화면 글자 ${total}자 (한계 ${rules.slideChars}자에 근접)`);
  });
});

// ── S3 목표-평가 연결 ───────────────────────────────────
await gate('S3', '학습 목표와 평가의 연결', (err) => {
  questions.forEach(q => { if (!(q.obj >= 1 && q.obj <= objs.length)) err('S3-OBJ', `활동지 문항 "${plain(q.q).slice(0, 24)}…"의 obj(목표 번호) 없음/범위 밖`, '각 문항이 몇 번 학습 목표를 확인하는지 obj로 표시'); });
  objs.forEach((o, i) => {
    const k = i + 1;
    if (!questions.some(q => q.obj === k)) err('S3-COVER', `학습 목표 ${k}을(를) 확인하는 활동지 문항이 없음`, `"${plain(o)}"를 확인하는 문항 추가`);
  });
  if (!slides.some(s => s.type === 'quiz')) err('S3-QUIZ', '수업 중 이해 확인(quiz) 슬라이드 없음');
});

// ── S4 수치 근거 (사실 대조) ─────────────────────────────
await gate('S4', '수치·사실 근거', (err) => {
  const facts = L.facts || [];
  facts.forEach(f => { if (!f.id || !f.text || !f.source) err('S4-FACT', `facts 항목에 id/text/source가 모두 있어야 함: ${JSON.stringify(f).slice(0, 60)}`); });
  const factText = [...facts.map(f => plain(f.text)), M.grade, M.unit, M.lesson, M.title, M.short, String(M.minutes)].join(' | ').replace(/\s+/g, '');
  const NUM = /\d+(?:[.,]\d+)*(?:\s*(?:%|퍼센트|℃|°|도|km|㎞|cm|㎝|mm|㎜|kg|㎏|mL|ml|L|m|g|년|세기|만|억|조|배|시간|일|개월|원|명|곳|개국))?/g;
  const scan = (label, text) => {
    for (const m of plain(stripSvg(text)).matchAll(NUM)) {
      const raw = m[0].replace(/\s+/g, '');
      const digits = raw.match(/\d+(?:[.,]\d+)*/)[0];
      const hasUnit = raw.length > digits.length;
      if (!hasUnit && digits.length < 2 && !/[.,]/.test(digits)) continue;   // 한 자리 셈(3가지 등)은 제외
      if (/^0\d$/.test(digits)) continue;                                   // 01, 02 같은 번호
      if (!factText.includes(raw) && !factText.includes(digits)) err('S4-NUM', `${label}의 수치 "${raw}"가 facts에 없음`, 'facts에 출처와 함께 추가하거나 수치를 빼세요 (교과서·공공기관 자료만)');
    }
  };
  const barsText = v => (v?.bars?.items || []).map(it => `${it.value}${v.bars.unit || ''}`).join(' ');
  slides.forEach((s, i) => scan(`${i + 1}번 슬라이드`, slideText(s) + ' ' + visualsOf(s).map(v => typeof v === 'string' ? v : barsText(v)).join(' ')));
  items.forEach(it => scan('활동지', textOf({ ...it, obj: 0, lines: 0, height: 0, cols: 0, points: 0, svg: typeof it.svg === 'string' ? it.svg : barsText(it.svg), answer: typeof it.answer === 'string' ? it.answer : '' })));
  slides.filter(s => s.type === 'bignum').forEach(s => { if (!facts.some(f => f.id === s.fact)) err('S4-BIGNUM', `bignum 슬라이드의 fact "${s.fact}"가 facts에 없음`); });
});

// ── S5 문체 ────────────────────────────────────────────
await gate('S5', '문체와 표현', (err, warn) => {
  const all = JSON.stringify({ slides, W, plan: L.plan, objs });
  const emoji = all.match(/\p{Extended_Pictographic}/gu);
  if (emoji) err('S5-EMOJI', `이모지 ${emoji.length}개 사용 (${[...new Set(emoji)].join('')})`, '이모지 대신 SVG 삽화나 강조 표시를 쓰세요');
  objs.forEach((o, i) => {
    if (/(이해|알|인식|깨달)(할|을)? ?수 있다/.test(o)) warn('S5-VERB', `학습 목표 ${i + 1}의 동사가 관찰하기 어려움("이해/알다"): ${o} — 설명할/구분할/찾을/그릴 수 있다 권장`);
    if (/않|말고|없이/.test(o)) err('S5-NEG', `학습 목표 ${i + 1}에 부정 표현: ${o}`, '결과를 긍정형으로 서술');
  });
  slides.forEach((s, i) => { if (s.title && /[?？]$/.test(plain(s.title)) && !['hook', 'quiz', 'exit', 'cover', 'chapter'].includes(s.type)) warn('S5-TITLE', `${i + 1}번 제목이 질문형 — 개념 슬라이드는 핵심 메시지형 제목 권장`); });
});

// ── S6 성취기준 ─────────────────────────────────────────
await gate('S6', '성취기준', (err, warn) => {
  const st = M.standards || [];
  if (!st.length) err('S6-NONE', 'meta.standards 없음', '교사에게 받은 성취기준을 넣거나 verified:false로 표시');
  // 교사가 성취기준을 못 줬을 때 쓰는 정식 플레이스홀더 — 문장을 지어내는 대신 이 표시만 쓴다(SKILL.md 1단계)
  const PLACEHOLDER = '(교사 입력 필요)';
  st.forEach(s => {
    const isPlaceholder = s.text === PLACEHOLDER;
    if (!isPlaceholder && /확인 필요|추정|전달받지|아직|초안|임시|가칭|TODO/i.test(s.text || '')) err('S6-NOTE', `성취기준 text에 메모 문장이 있음: "${plain(s.text).slice(0, 30)}…"`, `text에는 성취기준 문장만. 원문을 못 받았으면 지어내지 말고 "${PLACEHOLDER}"만 쓰고 verified:false로 두세요`);
    if (s.verified === false) warn('S6-VERIFY', isPlaceholder ? '성취기준을 교사가 아직 주지 않음(플레이스홀더) — 지도안에 그대로 표시됨' : `성취기준 "${s.code || plain(s.text).slice(0, 20)}"은(는) 원문 확인이 필요함 (지도안에 표시됨)`);
    if (s.code && !/^\[\d{1,2}[가-힣]{1,4}[\d가-힣ⅠⅡ-]*-?\d{2}(-\d{2})?\]$/.test(s.code)) warn('S6-CODE', `성취기준 코드 형식 확인: ${s.code}`);
  });
});

// ── S7 설계서 반영 ───────────────────────────────────────
// meta.intake(수업설계서.md 경로, lesson.json 기준 상대 경로)가 있을 때만 검사한다. references/intake.md 참고.
await gate('S7', '설계서 반영', (err, warn) => {
  if (!M.intake) { warn('S7-NONE', '설계서 없음'); return; }
  const formPath = path.resolve(ctx.dir, M.intake);
  if (!fs.existsSync(formPath)) return err('S7-FILE', `meta.intake 경로에 파일 없음: ${M.intake}`);
  const intake = parseIntake(fs.readFileSync(formPath, 'utf8'));
  intake.warnings.forEach(w => warn('S7-' + w.code, w.msg));
  const report = checkReflection(intake, L, out);
  for (const it of report.items)
    if (it.status === 'missing' || it.status === 'violated') err('S7-ITEM', `${it.key}: ${it.evidence}`, it.hint);
});

// ── E1 증거 중심 (meta.profile==="evidence"일 때만 검사, references/pedagogy.md §10) ──
await gate('E1', '증거 중심', (err, warn) => {
  if (M.profile !== 'evidence') { warn('E1-NONE', 'profile:evidence 아님'); return; }
  slides.forEach((s, i) => {
    const n = i + 1;
    // (a) 개념 슬라이드 한 장에 정의 하나 — points가 2개 이상이면 정의를 욱여넣은 것으로 본다
    if (s.type === 'concept' && (s.points || []).length > 1)
      err('E1-ONEDEF', `${n}번 concept에 정의(포인트) ${s.points.length}개 — 한 장에 정의 하나`, '슬라이드를 나누거나 포인트를 하나로 합치고 나머지는 lead·notes로 옮기세요');
    // (b) 대립 설명은 대칭으로 놓고 다음 장에서 실험으로 판정 — compare 바로 다음 장이 근거 제시 유형이어야 한다
    if (s.type === 'compare') {
      const nextType = slides[i + 1]?.type;
      if (!['diagram', 'steps', 'quiz', 'bignum'].includes(nextType))
        err('E1-JUDGE', `${n}번 compare 다음 장(${nextType || '없음'})이 diagram/steps/quiz/bignum이 아님`, '대립 설명 바로 다음 장에서 실험 결과로 판정하세요');
    }
    // (c) 공식 앞뒤에 증거를 붙인다 — 수식이 있는 슬라이드는 diagram/steps/timeline과 바로 붙어야 한다.
    // diagram/steps/timeline 자신은 이미 근거 슬라이드이므로 제외한다(연쇄 요구를 막기 위함).
    if (!['diagram', 'steps', 'timeline'].includes(s.type) && /\$[^$\n]+\$/.test(slideText(s))) {
      const neighbors = [slides[i - 1]?.type, slides[i + 1]?.type];
      if (!neighbors.some(t => ['diagram', 'steps', 'timeline'].includes(t)))
        err('E1-EVIDENCE', `${n}번 슬라이드에 수식이 있는데 앞뒤(${neighbors.map(t => t || '없음').join('/')})에 diagram/steps/timeline이 없음`, '실험·역사적 근거를 보여주는 슬라이드를 바로 앞이나 뒤에 붙이세요');
    }
  });

  // (d) 오개념은 역사로 (경고) — 설계서에 misconceptions가 있거나 발표자 노트에 "오개념"이 언급되면
  // hook·concept·compare 중 하나는 역사 서사 단서(연도·당시·과학자·실험이·무너)를 담아야 한다.
  let hasMisconceptions = slides.some(s => /오개념/.test(s.notes || ''));
  if (!hasMisconceptions && M.intake) {
    try {
      const formPath = path.resolve(ctx.dir, M.intake);
      if (fs.existsSync(formPath)) hasMisconceptions = parseIntake(fs.readFileSync(formPath, 'utf8')).misconceptions.length > 0;
    } catch { /* 파싱 실패는 S7이 이미 알린다 */ }
  }
  if (hasMisconceptions) {
    const CUE = /\d{4}|당시|과학자|실험이|무너/;
    const narrated = slides.some(s => ['hook', 'concept', 'compare'].includes(s.type) && CUE.test(`${s.notes || ''} ${s.note || ''}`));
    if (!narrated) warn('E1-HISTORY', '오개념이 있는데 역사 서사 단서(연도·당시·과학자·실험이·무너)가 hook/concept/compare 어디에도 없음 — "그 시대엔 합리적이었지만 이 실험이 무너뜨렸다" 식으로 노트에 서사를 넣으세요');
  }

  // (e) 스포일러 금지 — compare(대립 판정) 앞에 나오는 timeline이 마지막 사건에서 이미 결론을 말해버리면
  // 뒤에 올 대립 구도의 긴장이 사라진다. 결론(해결·설명)은 판정 슬라이드 뒤에 와야 한다(pedagogy.md 10번).
  const firstCompareIdx = slides.findIndex(s => s.type === 'compare');
  if (firstCompareIdx > 0) {
    slides.slice(0, firstCompareIdx).forEach((s, i) => {
      const last = s.type === 'timeline' && s.events?.length && s.events[s.events.length - 1];
      if (last && /설명|해결|밝혀/.test(plain(last.what || '')))
        warn('E1-SPOILER', `${i + 1}번 timeline의 마지막 사건이 이미 결론을 말함("${plain(last.what).slice(0, 24)}…") — ${firstCompareIdx + 1}번 compare의 판정보다 앞서 스포일러됨`);
    });
  }

  // (f) 좌표평면에는 축 이름이 있어야 한다 — 어떤 양인지 모르면 그래프가 증거가 되지 못한다
  const collectPlots = (node, out) => {
    if (Array.isArray(node)) { node.forEach(n => collectPlots(n, out)); return out; }
    if (node && typeof node === 'object') {
      if (node.plot && typeof node.plot === 'object') out.push(node.plot);
      for (const k of Object.keys(node)) collectPlots(node[k], out);
    }
    return out;
  };
  collectPlots(L, []).forEach((pl, idx) => {
    if (!(pl.xLabel || pl.axes?.x) || !(pl.yLabel || pl.axes?.y))
      err('E1-AXIS', `그래프(${idx + 1}번째, x:${JSON.stringify(pl.x || '기본')} y:${JSON.stringify(pl.y || '기본')})에 xLabel/yLabel이 없음 — 어떤 양의 그래프인지 알 수 없다`, 'plot에 xLabel/yLabel(예: "시간(초)", "거리(m)")을 추가하세요');
  });
});

// ── I1 이미지 ────────────────────────────────────────────
// lesson.json 어디든 있는 {image:{...}} 요청마다 프롬프트 검증·manifest 캐시 일치·파일 존재·해상도를 확인한다.
// 게이트는 입력을 절대 고치지 않는다 — images.mjs의 CLI(--compile-only)를 스폰하는 대신, images.mjs가
// export하는 순수 함수(ensureClassroomClause·runCheckPrompt·sha256)로 "images.mjs가 만들 최종 프롬프트"를
// 메모리에서만 재현해 검사한다. lesson.json·images/*는 어떤 경우에도 쓰지 않는다.
await gate('I1', '이미지', async (err, warn) => {
  const requests = collectImageRequests(L, []);
  if (requests.length === 0) { warn('I1-NONE', '이미지 요청 없음'); return; }

  const manifestPath = path.join(ctx.dir, 'images', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return err('I1-MANIFEST', 'images/manifest.json이 없음', '먼저 node scripts/images.mjs <lesson.json>을 실행하세요');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const forcedModel = (L.images && L.images.model) || process.env.CLASSFORGE_IMAGE_MODEL || null;
  const expectRoute = forcedModel && process.env.OPENAI_API_KEY ? 'api' : 'subscription';

  for (const req of requests) {
    const txtFile = path.join(ctx.dir, 'images', `${req.id}.prompt.txt`);
    let text = null;
    if (typeof req.prompt === 'string' && req.prompt.trim()) text = req.prompt;
    else if (fs.existsSync(txtFile)) text = fs.readFileSync(txtFile, 'utf8');
    if (!text) { err('I1-NOPROMPT', `이미지 "${req.id}"에 프롬프트가 없음(images/${req.id}.brief.md 작성 필요)`, '먼저 node scripts/images.mjs <lesson.json> --compile-only를 실행하세요'); continue; }

    const finalText = ensureClassroomClause(text, req, accent);
    const check = await runCheckPrompt(finalText);
    if (!check.ok) { err('I1-PROMPT', `이미지 "${req.id}" 프롬프트 검증 실패: ${check.errors.map(e => e.msg).join('; ')}`, check.errors[0]?.hint); continue; }

    const entry = manifest.images?.[req.id];
    if (!entry) { err('I1-MISSING', `이미지 "${req.id}"가 manifest에 없음`, '먼저 node scripts/images.mjs <lesson.json>을 실행하세요'); continue; }
    if (entry.promptHash !== sha256(finalText)) err('I1-STALE', `이미지 "${req.id}" 캐시가 최신 프롬프트와 다름`, '먼저 node scripts/images.mjs <lesson.json>을 실행하세요');
    const cachedRoute = entry.route || 'subscription';
    if (cachedRoute !== expectRoute) err('I1-ROUTE', `이미지 "${req.id}" 캐시 경로(${cachedRoute})가 현재 설정(${expectRoute})과 다름`, '먼저 node scripts/images.mjs <lesson.json>을 실행하세요');
    else if (expectRoute === 'api' && entry.model !== forcedModel) err('I1-MODEL', `이미지 "${req.id}" 캐시 모델(${entry.model})이 images.model(${forcedModel})과 다름`);
    const filePath = entry.file && path.resolve(ctx.dir, entry.file);
    const webPath = entry.web && path.resolve(ctx.dir, entry.web);
    if (!filePath || !fs.existsSync(filePath)) err('I1-FILE', `이미지 "${req.id}" 원본 파일 없음: ${entry.file || '(manifest에 file 없음)'}`);
    if (!webPath || !fs.existsSync(webPath)) err('I1-WEB', `이미지 "${req.id}" 축소본 파일 없음: ${entry.web || '(manifest에 web 없음)'}`);
    if (Math.max(entry.width || 0, entry.height || 0) < 1024) err('I1-SIZE', `이미지 "${req.id}" 긴 변 ${Math.max(entry.width || 0, entry.height || 0)}px < 1024px`);
  }
});

// ── 브라우저 실측 ───────────────────────────────────────
const need = ['slides.html', 'worksheet.html', 'answer-key.html', 'lesson-plan.html'];
const missing = need.filter(f => !fs.existsSync(path.join(out, f)));
if (missing.length) {
  await gate('B0', '빌드 산출물', err => err('B0-MISSING', `out/에 ${missing.join(', ')} 없음`, '먼저 node build.mjs <lesson.json>'));
} else {
  const browser = await launch();
  const consoleErrs = [];
  const open = async (f, vp, q = '') => {
    const p = await browser.newPage({ viewport: vp });
    p.on('console', m => { if (m.type() === 'error') consoleErrs.push(`${f}: ${m.text()}`); });
    p.on('pageerror', e => consoleErrs.push(`${f}: ${e.message}`));
    await p.goto(fileUrl(path.join(out, f)) + q);
    await p.evaluate(() => document.fonts.ready);
    return p;
  };
  try {
    const deck = await open('slides.html', { width: 1920, height: 1080 }, '?shot=1');
    const n = await deck.evaluate(() => window.__deck.count);
    const per = [];
    for (let i = 0; i < n; i++) {
      await deck.evaluate(k => window.__deck.show(k), i);
      await deck.waitForTimeout(30);
      per.push(await deck.evaluate(([src, k]) => { (0, eval)(src); return (0, eval)('(' + window.__ms + ')')(k); }, [`window.svgTextChecks = ${svgTextChecks.toString()}; window.segsOf = ${segsOf.toString()}; window.hitRect = ${hitRect.toString()}; window.__ms = ${JSON.stringify(measureSlide.toString())}`, i]));
    }

    await gate('B1', '슬라이드 넘침·겹침', err => {
      per.forEach(m => {
        m.clipped.forEach(c => err('B1-CLIP', `${m.n}번 슬라이드: 내용이 영역을 넘침 (${c})`, '글을 줄이거나 슬라이드를 나누세요'));
        m.outside.forEach(c => err('B1-OUT', `${m.n}번 슬라이드: 안전 영역 밖 요소 (${c})`));
        m.overlap.forEach(c => err('B1-OVERLAP', `${m.n}번 슬라이드: 글자끼리 겹침 (${c})`));
      });
    });
    await gate('B2', '글자 크기 하한', (err, warn) => {
      per.forEach(m => {
        m.small.forEach(c => err('B2-SMALL', `${m.n}번 슬라이드: ${c} < ${rules.minSmall}px`, '뒷자리 학생 기준 최소 크기'));
        m.bodySmall.forEach(c => err('B2-BODY', `${m.n}번 슬라이드 본문 ${c} < ${rules.minBody}px`));
        m.svgSmall.forEach(c => (c.tiny ? err : warn)('B2-SVG', `${m.n}번 삽화 라벨 ${c.msg}`, c.tiny ? '그래프·삽화의 viewBox를 들어갈 칸 크기에 맞게 줄이세요(라벨이 커짐)' : undefined));
        (m.svgLong || []).forEach(c => err('B2-SVGTEXT', `${m.n}번 삽화 안에 긴 글: ${c}`, '두 줄 이상 글은 SVG에 넣지 말고 passage 유형(지문)이나 concept 포인트로 쓰세요'));
        (m.crossed || []).forEach(c => err('B2-CROSS', `${m.n}번 삽화 라벨을 선/테두리가 관통: ${c}`, '라벨을 선(또는 테두리 있는 사각형)에서 떨어뜨리세요(위쪽·바깥쪽)'));
        (m.thin || []).forEach(c => err('B2-THINBAR', `${m.n}번 삽화의 얇은 막대(벽·슬릿 등)가 라벨과 겹침: ${c}`, '막대와 라벨 사이를 띄우거나 막대를 라벨에서 먼 쪽으로 옮기세요'));
        m.invisible.forEach(c => err('B2-STROKE', `${m.n}번 삽화의 선이 보이지 않음: ${c}`, '선에는 v-accent-s, v-ink-s, v-line만 쓰세요(v-mid·v-soft·v-muted는 채움 전용)'));
      });
    });
    await gate('B3', '명암 대비', err => {
      per.forEach(m => m.lowContrast.forEach(c => err('B3-CONTRAST', `${m.n}번 슬라이드: ${c}`, '본문 4.5:1, 큰 글자 3:1 이상')));
      per.forEach(m => m.svgContrast.forEach(c => err('B3-SVG', `${m.n}번 삽화 글자가 아래 도형과 구분되지 않음: ${c}`, '글자 아래 도형은 연한 채움(v-soft·v-mid·v-paper2·v-paper3)만, 진한 채움(v-accent·v-ink) 위에는 글자를 두지 마세요')));
    });
    await gate('B4', '글꼴 탑재', async err => {
      const ok = await deck.evaluate(() => [...document.fonts].some(f => f.family.includes('CF Pretendard') && f.status === 'loaded'));
      if (!ok) err('B4-FONT', '내장 글꼴(CF Pretendard)이 로드되지 않음', 'build.mjs가 fonts.py로 글꼴을 넣었는지 확인');
      const tofu = await deck.evaluate(() => {
        const txt = [...new Set(document.body.innerText.replace(/\s/g, ''))];
        const c = document.createElement('canvas').getContext('2d');
        const miss = [];
        for (const ch of txt) { c.font = "40px 'CF Pretendard', serif"; const a = c.measureText(ch).width; c.font = '40px serif'; const b = c.measureText(ch).width; c.font = "40px 'CF Pretendard', monospace"; const d = c.measureText(ch).width; if (a === b && b !== d && /[가-힣]/.test(ch)) miss.push(ch); }
        return miss.slice(0, 10).join('');
      });
      if (tofu) err('B4-GLYPH', `내장 글꼴에 없는 글자: ${tofu}`);
    });
    await gate('B5', '화면 밀도', (err, warn) => {
      per.forEach(m => {
        if (['cover', 'chapter', 'exit', 'bignum'].includes(m.type)) return;
        if (m.cover < 0.30) err('B5-EMPTY', `${m.n}번(${m.type}) 내용이 차지하는 면적 ${(m.cover * 100).toFixed(0)}% < 30%`, '삽화를 넣거나 내용 배치를 넓히세요');
        // profile:evidence는 절제된 배치상 하단 여백이 의도적으로 남을 수 있어 이 경고를 내지 않는다
        if (m.reach < 0.55 && M.profile !== 'evidence') warn('B5-REACH', `${m.n}번(${m.type}) 내용이 위쪽 ${(m.reach * 100).toFixed(0)}%에만 몰림`);
        m.tinyVisual.forEach(c => err('B5-VISUAL', `${m.n}번(${m.type}) 삽화가 작게 그려짐: ${c}`, 'viewBox를 그림 크기에 맞게 줄이세요(여백 포함 그림이 viewBox의 20% 이상)'));
      });
    });
    await deck.close();

    // A4 문서
    const docs = {};
    for (const f of ['worksheet.html', 'answer-key.html', 'lesson-plan.html']) {
      const p = await open(f, { width: 1300, height: 1000 });
      await p.waitForFunction(() => window.__paged === true, null, { timeout: 15000 });
      docs[f] = await p.evaluate((src) => { (0, eval)(src); return (0, eval)('(' + window.__md + ')')(); }, `window.svgTextChecks = ${svgTextChecks.toString()}; window.segsOf = ${segsOf.toString()}; window.hitRect = ${hitRect.toString()}; window.__md = ${JSON.stringify(measureDoc.toString())}`);
      await p.close();
    }
    await gate('B6', 'A4 쪽 구성', (err, warn) => {
      const lim = { 'worksheet.html': 4, 'answer-key.html': 5, 'lesson-plan.html': 3 };
      for (const [f, d] of Object.entries(docs)) {
        if (d.overflow) err('B6-OVER', `${f}: 한 쪽보다 큰 블록 ${d.overflow}개`, '문항을 나누거나 그리기 칸 높이를 줄이세요');
        if (d.pages > lim[f]) err('B6-PAGES', `${f}: ${d.pages}쪽 > ${lim[f]}쪽`, '문항 수를 줄이세요');
        d.fill.forEach((r, i) => {
          const last = i === d.fill.length - 1;
          if (!last && r < 0.62) err('B6-FILL', `${f} ${i + 1}쪽 채움 ${(r * 100).toFixed(0)}% < 62% (다음 블록이 커서 통째로 다음 쪽으로 밀림)`, '앞 섹션에 짧은 문항(ox·choice)을 더하거나, 다음 쪽으로 밀린 표·그리기 칸을 줄이거나 문항 순서를 바꾸세요');
          if (last && r < 0.18) warn('B6-LAST', `${f} 마지막 쪽 채움 ${(r * 100).toFixed(0)}% — 거의 빈 쪽`);
        });
        d.tinyText.forEach(t => err('B6-TYPO', `${f}: 글자 ${t}`, '인쇄물 최소 8pt'));
        (d.fig || []).forEach(t => err('B6-FIG', `${f}: ${t}`, '그림은 칸을 채우게(draw height를 그림에 맞게), 라벨은 선에서 떼고 연한 채움 위에'));
        d.lowContrast.forEach(t => err('B6-CONTRAST', `${f}: ${t}`));
      }
      if (docs['worksheet.html'].qMin < rules.wsMinPt - 0.05) err('B6-QSIZE', `활동지 문항 글자 ${docs['worksheet.html'].qMin}pt < ${rules.wsMinPt}pt`);
    });
    await gate('B7', '정답 분리', err => {
      const w = docs['worksheet.html'], k = docs['answer-key.html'];
      if (w.leak.length) err('B7-LEAK', `학생용 활동지에 정답 흔적: ${w.leak.join(', ')}`, '빌드 템플릿 확인');
      if (k.emptyBlanks) err('B7-KEY', `정답지에 빈 빈칸 ${k.emptyBlanks}개`);
      if (k.blanks !== w.blanks) err('B7-KEY', `빈칸 수 불일치 (활동지 ${w.blanks}, 정답지 ${k.blanks})`);
      if (k.qs !== w.qs) err('B7-KEY', `문항 수 불일치 (활동지 ${w.qs}, 정답지 ${k.qs})`);
    });
    await gate('B8', '실행 오류', err => {
      consoleErrs.forEach(e => err('B8-CONSOLE', e));
      for (const f of need) {
        const html = fs.readFileSync(path.join(out, f), 'utf8');
        const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
        const dup = [...new Set(ids.filter((x, k) => ids.indexOf(x) !== k))];
        if (dup.length) err('B8-DUPID', `${f}: 같은 id가 여러 번 쓰임 (${dup.slice(0, 5).join(', ')})`, '삽화 SVG 안 id(clipPath·gradient 등)를 슬라이드마다 다르게');
      }
    });
  } finally { await browser.close(); }
}

// ── 결과 ────────────────────────────────────────────────
const ok = gates.every(g => g.ok);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'gate-report.json'), JSON.stringify({ ok, level, lesson: M.title, at: new Date().toISOString(), gates }, null, 2));
console.log(`\n classforge gate — ${M.title} (${level})\n`);
for (const g of gates) {
  console.log(` ${g.ok ? 'PASS' : 'FAIL'}  ${g.id.padEnd(3)} ${g.name}${g.warnings.length ? `  (경고 ${g.warnings.length})` : ''}`);
  for (const e of g.errors.slice(0, 12)) console.log(`        ✗ [${e.code}] ${e.msg}${e.hint ? `\n            → ${e.hint}` : ''}`);
  if (g.errors.length > 12) console.log(`        … 외 ${g.errors.length - 12}건`);
  for (const w of g.warnings.slice(0, 6)) console.log(`        ! [${w.code}] ${w.msg}`);
}
console.log(`\n ${ok ? 'ALL PASS' : 'FAIL'} — ${gates.filter(g => g.ok).length}/${gates.length} 게이트 통과. 리포트: ${path.join(out, 'gate-report.json')}\n`);
process.exit(ok ? 0 : 1);

// ── 브라우저 안에서 실행되는 측정 함수 ─────────────────────
function measureSlide(i) {
  // rgb()/rgba() 또는 color(srgb r g b / a) → [r,g,b,a] (0~255, a 0~1)
  // 어떤 색 표기(rgb, color(srgb), oklab, lab…)든 캔버스에 칠해 실제 sRGB 값을 읽는다
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgbOf = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const s = document.querySelectorAll('.slide')[i];
  const body = s.querySelector('.body');
  const sr = s.getBoundingClientRect(), br = body.getBoundingClientRect();
  const lum = c => { const m = rgbOf(c); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
  const alpha = c => rgbOf(c)[3];
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (alpha(c) > .5) return c; } return 'rgb(255,255,255)'; };
  const label = el => (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()) + ` "${el.textContent.trim().slice(0, 14)}"`;
  const leaves = [...s.querySelectorAll('.body *')].filter(e => !(e instanceof SVGElement) && !e.closest('[data-deco]') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length);
  const vis = e => { const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && Number(cs.opacity) > .05; };
  const BODY_ROLES = '.lead,.points .t,.term .d,.what,.ans .e,.cap,.subtitle,.s-compare li,.s-activity ol li,.goals li span,.sum li span,.choices li span,.s-steps .t';
  const res = { n: i + 1, type: s.dataset.type, bodySmall: [], invisible: [], tinyVisual: [], svgContrast: [], clipped: [], outside: [], overlap: [], small: [], svgSmall: [], lowContrast: [], bodyMedian: 0, cover: 0, reach: 0 };
  if (body.scrollHeight > body.clientHeight + 2) res.clipped.push(`본문 높이 ${body.scrollHeight}px > ${body.clientHeight}px`);
  for (const e of body.querySelectorAll('.grow,.visual,.cols .l,.cols .r,.side,.st,.track,.vs')) if (e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflow !== 'visible') res.clipped.push(label(e));
  const sizes = [];
  const rects = [];
  for (const e of leaves) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e), fs = parseFloat(cs.fontSize);
    if (r.left < br.left - 4 || r.right > br.right + 4 || r.top < br.top - 4 || r.bottom > br.bottom + 4) res.outside.push(label(e));
    if (fs < 0) continue;
    if (fs + .5 < document.body.dataset.minSmall) res.small.push(`${label(e)} ${fs}px`);
    if (e.matches(BODY_ROLES) && fs + .5 < document.body.dataset.minBody) res.bodySmall.push(`${label(e)} ${fs}px`);
    sizes.push(fs);
    const ratio = (Math.max(lum(cs.color), lum(bgOf(e))) + .05) / (Math.min(lum(cs.color), lum(bgOf(e))) + .05);
    const large = fs >= 48 || (fs >= 37 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) res.lowContrast.push(`${label(e)} 대비 ${ratio.toFixed(2)}:1`);
    for (const rr of e.getClientRects()) rects.push({ e, r: rr });
  }
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const A = rects[a], B = rects[b];
    if (A.e === B.e || A.e.contains(B.e) || B.e.contains(A.e)) continue;
    const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left), oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
    if (ox > 6 && oy > Math.min(A.r.height, B.r.height) * .35) res.overlap.push(`${label(A.e)} ↔ ${label(B.e)}`);
  }
  res.overlap = [...new Set(res.overlap)].slice(0, 5);
  // 삽화 선: 채움 전용 클래스를 선에 쓰면 선이 사라진다 / 배경과 구분 안 되는 선
  for (const el of body.querySelectorAll('.visual svg line, .visual svg polyline')) {
    const cs = getComputedStyle(el);
    if (cs.stroke === 'none' || parseFloat(cs.strokeWidth) === 0) { res.invisible.push(`<${el.tagName} class="${el.getAttribute('class') || ''}"> 선 색 없음`); continue; }
    const op = Number(cs.opacity) * Number(cs.strokeOpacity || 1);
    const bgc = bgOf(el.closest('.visual'));
    const sc = rgbOf(cs.stroke), bc = rgbOf(bgc);
    const mix = sc.slice(0, 3).map((v, k) => v * op + bc[k] * (1 - op));
    const ratio = (Math.max(lum(`rgb(${mix})`), lum(bgc)) + .05) / (Math.min(lum(`rgb(${mix})`), lum(bgc)) + .05);
    if (ratio < 1.25 && parseFloat(cs.strokeWidth) >= 2) res.invisible.push(`<${el.tagName} class="${el.getAttribute('class') || ''}"> 배경과 대비 ${ratio.toFixed(2)}:1`);
  }
  res.invisible = [...new Set(res.invisible)].slice(0, 4);
  // 삽화가 자기 영역에 비해 너무 작게 그려졌는지 (viewBox 대비 실제 그림 크기)
  for (const svg of body.querySelectorAll('.visual svg')) {
    const vb = svg.viewBox.baseVal; if (!vb || !vb.width) continue;
    let bb; try { bb = svg.getBBox(); } catch { continue; }
    const fill = (bb.width * bb.height) / (vb.width * vb.height);
    // viewBox 비율이 칸과 다르면 여백이 생긴다: 칸 안에 실제로 그려지는 비율
    const box = svg.getBoundingClientRect(), k = Math.min(box.width / vb.width, box.height / vb.height);
    const shown = box.width && box.height ? (vb.width * k * vb.height * k) / (box.width * box.height) : 1;
    if (fill < 0.2) res.tinyVisual.push(`그림이 viewBox의 ${(fill * 100).toFixed(0)}%만 차지`);
    else if (svg.closest('.st') && svg.hasAttribute('data-plot') && vb.width * k < box.width * 0.5) res.tinyVisual.push(`단계 칸 그래프 폭이 칸의 ${(vb.width * k / box.width * 100).toFixed(0)}% — x 범위를 넓히거나 y 범위를 줄이세요`);
    else if (fill * shown < 0.3 && !svg.closest('.st')) res.tinyVisual.push(`그림이 칸의 ${(fill * shown * 100).toFixed(0)}%만 차지(viewBox 비율이 칸과 다름 — 그래프면 x·y 범위 비율을 칸 비율에 맞추세요)`);
  }
  // 삽화 글자: 글자 아래에 실제로 칠해진 도형(rect·circle·path…)의 색과 대비를 잰다
  for (const t of body.querySelectorAll('.visual svg text')) {
    const r = t.getBoundingClientRect(); if (!r.width) continue;
    const tcs = getComputedStyle(t);
    if (tcs.paintOrder.startsWith('stroke') && parseFloat(tcs.strokeWidth) >= 6 && tcs.stroke !== 'none') continue;   // 글자 테두리(halo)가 배경을 만든다
    let under = null;
    for (const e of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
      if (e === t || t.contains(e)) continue;
      if (e instanceof SVGGeometryElement && !(e instanceof SVGTextElement)) {
        const cs = getComputedStyle(e);
        if (cs.fill !== 'none' && Number(cs.fillOpacity) * Number(cs.opacity) > .5) { under = cs.fill; break; }
        continue;
      }
      if (!(e instanceof SVGElement)) { under = bgOf(e); break; }
    }
    if (!under) continue;
    const ratio = (Math.max(lum(tcs.fill), lum(under)) + .05) / (Math.min(lum(tcs.fill), lum(under)) + .05);
    const need = t.getBoundingClientRect().height / 1.2 >= 37 ? 3 : 4.5;
    if (ratio < need) res.svgContrast.push(`"${t.textContent.trim().slice(0, 12)}" 대비 ${ratio.toFixed(2)}:1 (기준 ${need}:1)`);
  }
  res.svgContrast = [...new Set(res.svgContrast)].slice(0, 4);
  const sv = svgTextChecks(body);
  res.svgLong = sv.long; res.crossed = sv.crossed; res.thin = sv.thin;
  for (const t of body.querySelectorAll('svg text')) {
    const h = t.getBoundingClientRect().height;
    const px = h / 1.2;
    if (h && px < document.body.dataset.minSmall * .8) res.svgSmall.push({ tiny: px < document.body.dataset.minSmall * .75, msg: `"${t.textContent.trim().slice(0, 10)}" 약 ${Math.round(px)}px` });
  }
  sizes.sort((a, b) => a - b);
  res.bodyMedian = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  // 내용 면적: 보이는 잎 요소 + 삽화의 합집합 상자
  const boxes = [...leaves.filter(vis).map(e => e.getBoundingClientRect()), ...[...body.querySelectorAll('.visual svg,.visual img')].map(e => e.getBoundingClientRect())].filter(r => r.width && r.height);
  if (boxes.length) {
    const cell = 24, W = Math.ceil(br.width / cell), H = Math.ceil(br.height / cell), grid = new Uint8Array(W * H);
    for (const r of boxes) for (let y = Math.max(0, Math.floor((r.top - br.top) / cell)); y < Math.min(H, Math.ceil((r.bottom - br.top) / cell)); y++)
      for (let x = Math.max(0, Math.floor((r.left - br.left) / cell)); x < Math.min(W, Math.ceil((r.right - br.left) / cell)); x++) grid[y * W + x] = 1;
    // 행 단위로 가장 왼쪽~오른쪽 사이를 채운 것으로 본다(글줄 사이 여백은 내용으로 취급)
    let covered = 0;
    for (let y = 0; y < H; y++) { let l = -1, rgt = -1; for (let x = 0; x < W; x++) if (grid[y * W + x]) { if (l < 0) l = x; rgt = x; } if (l >= 0) covered += rgt - l + 1; }
    const minTop = Math.min(...boxes.map(r => r.top)), maxBottom = Math.max(...boxes.map(r => r.bottom));
    res.cover = covered / (W * H);
    res.reach = (maxBottom - br.top) / br.height;
    void minTop; void sr;
  }
  return res;
}

function measureDoc() {
  // rgb()/rgba() 또는 color(srgb r g b / a) → [r,g,b,a] (0~255, a 0~1)
  // 어떤 색 표기(rgb, color(srgb), oklab, lab…)든 캔버스에 칠해 실제 sRGB 값을 읽는다
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgbOf = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const pages = [...document.querySelectorAll('.page')];
  const pt = px => Math.round(px * 0.75 * 10) / 10;
  const lum = c => { const m = rgbOf(c); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (rgbOf(c)[3] > .5) return c; } return 'rgb(255,255,255)'; };
  const res = { pages: pages.length, fill: [], overflow: document.querySelectorAll('[data-overflow]').length, tinyText: [], lowContrast: [], leak: [], blanks: 0, emptyBlanks: 0, qs: 0, qMin: 99 };
  for (const p of pages) {
    const inner = p.querySelector('.pg-inner'), ir = inner.getBoundingClientRect();
    const last = [...inner.children].at(-1);
    res.fill.push(last ? (last.getBoundingClientRect().bottom - ir.top) / ir.height : 0);
  }
  const seen = new Set();
  for (const e of document.querySelectorAll('.page *')) {
    if (!(e instanceof HTMLElement) || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || !e.getClientRects().length) continue;
    const cs = getComputedStyle(e); const fs = pt(parseFloat(cs.fontSize));
    if (cs.color === 'rgba(0, 0, 0, 0)' || cs.visibility === 'hidden') continue;
    if (fs < 7.9 && !e.closest('sup')) { const k = `${fs}pt "${e.textContent.trim().slice(0, 12)}"`; if (!seen.has(k)) { seen.add(k); res.tinyText.push(k); } }
    const ratio = (Math.max(lum(cs.color), lum(bgOf(e))) + .05) / (Math.min(lum(cs.color), lum(bgOf(e))) + .05);
    if (ratio < 4.5 && !(fs >= 14 && Number(cs.fontWeight) >= 700)) res.lowContrast.push(`"${e.textContent.trim().slice(0, 12)}" 대비 ${ratio.toFixed(2)}:1`);
  }
  for (const q of document.querySelectorAll('.q .qt')) res.qMin = Math.min(res.qMin, pt(parseFloat(getComputedStyle(q).fontSize)));
  res.qs = document.querySelectorAll('.q').length;
  const blanks = [...document.querySelectorAll('.blank')];
  res.blanks = blanks.length;
  res.emptyBlanks = blanks.filter(b => !b.textContent.replace(/^\d+/, '').replace(/ /g, '').trim()).length;
  if (!document.body.classList.contains('key')) {
    if (blanks.some(b => b.textContent.replace(/^\d+/, '').replace(/ /g, '').trim())) res.leak.push('빈칸에 글자');
    for (const sel of ['.lines .ans', '.explain', '.draw .model', '.choices li.ok', '.ox .box.on', '.tbl td.fill:not(:empty)']) if (document.querySelector(sel)) res.leak.push(sel);
    if ([...document.querySelectorAll('.match svg line')].length) res.leak.push('선 잇기 정답선');
  }
  res.lowContrast = [...new Set(res.lowContrast)].slice(0, 6);
  // 활동지·정답지 그림(좌표평면·지도·자료)
  res.fig = [];
  for (const svg of document.querySelectorAll('.page .draw svg, .page .fig svg')) {
    for (const t of svg.querySelectorAll('text')) {
      const h = t.getBoundingClientRect().height; if (!h) continue;
      const p = Math.round(h / 1.2 * 0.75 * 10) / 10;
      if (p < 8) res.fig.push(`그림 글자 "${t.textContent.trim().slice(0, 10)}" ${p}pt < 8pt`);
    }
    const box = svg.closest('.draw') || svg.parentElement, br = box.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    if (svg.closest('.draw') && vb && vb.width) {
      const k = Math.min(br.width / vb.width, br.height / vb.height);
      if (vb.height * k < br.height * 0.8 && vb.width * k < br.width * 0.8) res.fig.push(`그리기 칸 그림이 칸의 ${Math.round(vb.width * k / br.width * 100)}%×${Math.round(vb.height * k / br.height * 100)}%만 차지`);
    }
  }
  const sv = svgTextChecks(document.body, true);
  res.fig.push(...sv.long.map(c => `그림 안 긴 글: ${c}`), ...sv.crossed.map(c => `라벨을 선/테두리가 관통: ${c}`), ...sv.contrast.map(c => `그림 글자 대비: ${c}`), ...sv.thin.map(c => `그림 안 얇은 막대가 라벨과 겹침: ${c}`));
  res.fig = [...new Set(res.fig)].slice(0, 8);
  return res;
}

// SVG 글자 공통 검사: 긴 글(여러 줄 문단), 선이 라벨을 관통, (doc 모드) 아래 도형과의 대비
function svgTextChecks(root, doc) {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgbOf = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = c => { const m = rgbOf(c); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
  const out = { long: [], crossed: [], contrast: [], thin: [] };
  for (const svg of root.querySelectorAll('svg')) {
    const texts = [...svg.querySelectorAll('text')].filter(t => t.getBoundingClientRect().width);
    const generated = svg.hasAttribute('data-plot') || svg.hasAttribute('data-bars');   // 빌드가 그린 그래프는 라벨 배치를 이미 계산했다
    if (generated) continue;
    // 얇은 채움 막대(슬릿·벽 등, 화면에 렌더링된 두 변 중 짧은 쪽이 14px 미만인 rect·polygon)가
    // 라벨과 겹치는지 — 선이 아니라 채움이라 segsOf(관통 검사)로는 못 잡으므로 상자 겹침으로 본다.
    const bars = [...svg.querySelectorAll('rect, polygon')].filter(el => {
      const cs = getComputedStyle(el);
      if (cs.fill === 'none' || cs.visibility === 'hidden' || Number(cs.fillOpacity) * Number(cs.opacity) <= .5) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < 14;
    });
    for (const bar of bars) {
      const br = bar.getBoundingClientRect();
      for (const t of texts) {
        const tr = t.getBoundingClientRect();
        const ox = Math.min(br.right, tr.right) - Math.max(br.left, tr.left);
        const oy = Math.min(br.bottom, tr.bottom) - Math.max(br.top, tr.top);
        if (ox > 2 && oy > 2) out.thin.push(`"${t.textContent.trim().slice(0, 12)}"`);
      }
    }
    // 긴 글: 한 요소에 40자 초과, 또는 같은 x에서 줄 간격이 촘촘한 3줄 이상
    for (const t of texts) if (t.textContent.trim().length > 40) out.long.push(`"${t.textContent.trim().slice(0, 16)}…" ${t.textContent.trim().length}자`);
    const byX = {};
    for (const t of texts) { const r = t.getBoundingClientRect(); const k = Math.round(r.left / 4); (byX[k] ||= []).push(r); }
    for (const rs of Object.values(byX)) {
      rs.sort((a, b) => a.top - b.top);
      let run = 1;
      for (let i = 1; i < rs.length; i++) { run = rs[i].top - rs[i - 1].top < rs[i].height * 1.35 ? run + 1 : 1; if (run >= 3) { out.long.push('촘촘한 여러 줄 글(문단)'); break; } }
    }
    for (const t of texts) {
      const cs = getComputedStyle(t);
      const halo = cs.paintOrder.startsWith('stroke') && parseFloat(cs.strokeWidth) >= 6 && cs.stroke !== 'none';
      if (halo) continue;
      const r = t.getBoundingClientRect();
      // 선 관통: 선(line·polyline·열린 path)의 실제 좌표를 화면 좌표로 바꿔 글자 상자와 교차하는지 계산(점선 빈틈과 무관)
      const rb = { l: r.left + 2, r: r.right - 2, t: r.top + r.height * .1, b: r.bottom - r.height * .12 };
      if (segsOf(svg).some(sg => hitRect(rb, sg))) out.crossed.push(`"${t.textContent.trim().slice(0, 12)}"`);
      if (doc) {   // 인쇄물: 글자 아래 도형과의 대비
        let under = null;
        for (const e of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
          if (e === t || t.contains(e)) continue;
          if (e instanceof SVGGeometryElement && !(e instanceof SVGTextElement)) { const c2 = getComputedStyle(e); if (c2.fill !== 'none' && Number(c2.fillOpacity) * Number(c2.opacity) > .5) { under = c2.fill; break; } continue; }
          if (!(e instanceof SVGElement)) { under = getComputedStyle(e).backgroundColor; if (rgbOf(under)[3] < .5) under = '#fff'; break; }
        }
        if (under) { const ratio = (Math.max(lum(cs.fill), lum(under)) + .05) / (Math.min(lum(cs.fill), lum(under)) + .05); if (ratio < 4.5) out.contrast.push(`"${t.textContent.trim().slice(0, 12)}" ${ratio.toFixed(2)}:1`); }
      }
    }
  }
  out.long = [...new Set(out.long)].slice(0, 4); out.crossed = [...new Set(out.crossed)].slice(0, 5); out.contrast = [...new Set(out.contrast)].slice(0, 5);
  out.thin = [...new Set(out.thin)].slice(0, 5);
  return out;
}

// SVG 안 선들의 화면 좌표 선분 (라벨 관통 검사용) — line·polyline·열린 path에 더해,
// 테두리(stroke)가 있는 rect도 네 변을 선분으로 넣는다(채움 rect의 테두리가 라벨을 가로지르는 경우까지 잡는다).
function segsOf(svg) {
  if (svg.__segs) return svg.__segs;
  const segs = [];
  for (const e of svg.querySelectorAll('line, polyline, path')) {
    const cs = getComputedStyle(e);
    if (cs.stroke === 'none' || parseFloat(cs.strokeWidth) < 1.2 || cs.visibility === 'hidden' || Number(cs.opacity) < .15) continue;
    if (e.tagName !== 'line' && cs.fill !== 'none') continue;
    const m = e.getScreenCTM(); if (!m) continue;
    let pts = [];
    if (e.tagName === 'line') pts = [[e.x1.baseVal.value, e.y1.baseVal.value], [e.x2.baseVal.value, e.y2.baseVal.value]];
    else { const L = e.getTotalLength(); for (let i = 0; i <= 48; i++) { const q = e.getPointAtLength(L * i / 48); pts.push([q.x, q.y]); } }
    const sp = pts.map(([x, y]) => { const q = new DOMPoint(x, y).matrixTransform(m); return [q.x, q.y]; });
    for (let i = 1; i < sp.length; i++) segs.push([sp[i - 1], sp[i]]);
  }
  for (const e of svg.querySelectorAll('rect')) {
    const cs = getComputedStyle(e);
    if (cs.stroke === 'none' || parseFloat(cs.strokeWidth) < 1.2 || cs.visibility === 'hidden' || Number(cs.opacity) < .15) continue;
    const m = e.getScreenCTM(); if (!m) continue;
    const x = e.x.baseVal.value, y = e.y.baseVal.value, w = e.width.baseVal.value, h = e.height.baseVal.value;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => { const q = new DOMPoint(px, py).matrixTransform(m); return [q.x, q.y]; });
    for (let i = 0; i < 4; i++) segs.push([corners[i], corners[(i + 1) % 4]]);
  }
  return (svg.__segs = segs);
}
function hitRect(b, [p, q]) {
  const inb = ([x, y]) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;
  if (inb(p) || inb(q)) return true;
  const o = (a, c, d) => Math.sign((c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]));
  const cross = (a, c, d, e) => o(a, c, d) !== o(a, c, e) && o(d, e, a) !== o(d, e, c);
  const E = [[[b.l, b.t], [b.r, b.t]], [[b.r, b.t], [b.r, b.b]], [[b.r, b.b], [b.l, b.b]], [[b.l, b.b], [b.l, b.t]]];
  return E.some(([d, e]) => cross(p, q, d, e));
}
