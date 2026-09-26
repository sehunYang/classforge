// classforge gate — 수업 자료 품질 게이트. 정적 검사(S) 후 브라우저 실측(B). 하나라도 FAIL이면 exit 1.
// 사용: node gate.mjs <lesson.json>   (먼저 build.mjs로 out/을 만들어 둘 것)
// 리포트: out/gate-report.json  {ok, gates:[{id,name,ok,errors:[{code,msg,hint}],warnings:[...]}]}
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { loadLesson, launch, fileUrl, plain, SLIDE_TYPES, ITEM_TYPES } from './lib.mjs';
import { parseIntake, checkReflection } from './intake.mjs';
import { collect as collectImageRequests, stepChainPrevStates, ensureClassroomClause, samePromptExceptPalette, runCheckPrompt, sha256, normalizePromptText } from './images.mjs';
import { compileCurve } from './visuals.mjs';
import { toTikzSpec } from './diagrams.mjs';

const lessonPath = process.argv[2];
if (!lessonPath) { console.error('사용: node gate.mjs <lesson.json>'); process.exit(2); }
const ctx = loadLesson(lessonPath);
const { lesson: L, out, rules, level } = ctx;
const M = L.meta || {};
// R1(도메인 검토) 신선함을 mtime이 아니라 내용 해시로 판정하는 데 쓴다(N4) — 파일을 읽어 sha256 hex를
// 낸다, 읽기 실패(없는 파일)는 null.
const fileHash = p => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };
// `node gate.mjs <lesson> --review-stamp` — 게이트를 돌리지 않고, 지금 lesson.json·참조 이미지의
// sha256을 계산해 찍는다(review.json이 있으면 그 파일의 `stamp` 필드에 바로 써 넣는다). 검토
// 서브에이전트가 review.json에 verdict를 다 쓴 뒤 "마지막 단계"로 실행한다 — 그래야 stamp가 검토
// 시점의 내용을 정확히 가리킨다(references/review-schema.md 참고). `reviewedAt`도 이 시점의 실제
// UTC 시각으로 함께 채운다 — 검토자가 KST 등 현지 시각에 "Z"(UTC) 접미사를 잘못 붙여 손으로 적으면
// 미래 시각처럼 보여 R1-STALE(미래 시각 경고)이 뜨는 사고를 막는다. reviewedAt은 이제 정보용일
// 뿐이지만(N4, 신선함은 stamp가 판정) 값 자체는 정확해야 하므로 손으로 적지 않는다.
if (process.argv.includes('--review-stamp')) {
  const imageIds = collectImageRequests(L, []).map(r => r.id);
  const images = {};
  const manifestPath = path.join(ctx.dir, 'images', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const id of imageIds) {
        const entry = manifest.images?.[id];
        if (entry?.file) { const h = fileHash(path.join(ctx.dir, entry.file)); if (h) images[id] = h; }
      }
    } catch (e) { console.error(`images/manifest.json 파싱 실패: ${e.message}`); }
  }
  const stamp = { lesson: fileHash(ctx.file), images };
  const reviewedAt = new Date().toISOString();
  const reviewPath = path.join(ctx.dir, 'review.json');
  if (fs.existsSync(reviewPath)) {
    let review;
    try { review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')); }
    catch (e) { console.error(`review.json 파싱 실패: ${e.message}`); process.exit(2); }
    review.stamp = stamp;
    review.reviewedAt = reviewedAt;
    fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    console.log(`review.json에 stamp·reviewedAt(${reviewedAt})을 기록했습니다: ${reviewPath}`);
  }
  console.log(JSON.stringify({ ...stamp, reviewedAt }, null, 2));
  process.exit(0);
}
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
const facts = L.facts || [];
const stripSvg = s => String(s ?? '').replace(/<[^>]+>/g, ' ');
// $...$ 수식은 렌더링되면 훨씬 짧아 보인다 — 글자 수 "세는 값"에서만 접는다(원문 표시는 그대로 둔다).
// 백슬래시 명령(\alpha, \times…)은 렌더링되면 글자 1개이므로 1글자로, 중괄호·^·_는 화면에 안 보이므로 지운다.
// $$...$$(디스플레이 핵심 공식)도 똑같이 접는다 — $$ 먼저 시도해야 한다(안 그러면 홑$ 패턴이 여는/닫는
// $$ 중 한 글자씩만 델리미터로 먹어 접힌 결과 양옆에 낱개 $가 그대로 남는다).
const foldMath = e => e.replace(/\\[A-Za-z]+/g, 'x').replace(/[{}^_]/g, '');
const mathLen = s => String(s ?? '')
  .replace(/\$\$([^$\n]+?)\$\$/g, (_, e) => foldMath(e))
  .replace(/\$([^$\n]+)\$/g, (_, e) => foldMath(e));
// "이 텍스트에 수식이 있나?"(E1-EVIDENCE·E1-VERIFY) — $...$든 $$...$$든 상관없이 하나라도 있으면 참.
const HAS_FORMULA_RE = /\$\$[^$\n]+?\$\$|\$[^$\n]+\$/;
const clen = s => plain(mathLen(s)).length;
// 화면에 글자로 나오는 값만 모은다. visual(삽화·그래프 설정)은 어느 깊이에 있든 뺀다.
// evidence는 facts id 문자열이라 화면 글자 수·기호 대조에 섞이면 안 된다(fact와 같은 이유).
const SKIP = new Set(['type', 'notes', 'reveal', 'hot', 'visual', 'answer', 'minutes', 'no', 'fact', 'evidence']);
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
  // kind: "rival"(기본, 대립 가설 — 다음 장에서 판정) | "contrast"(둘 다 참인 대비 — 판정 대상 아님, pedagogy.md §10)
  concept: ['title', 'points', 'lead', 'visual', 'caption'], compare: ['title', 'left', 'right', 'note', 'kind'],
  // evidence: compare 바로 다음 판정 슬라이드에서 어떤 facts로 판정하는지(E1-JUDGE-EVIDENCE, pedagogy.md §10)
  steps: ['title', 'steps', 'hot', 'evidence'], diagram: ['title', 'visual', 'caption', 'evidence'],
  bignum: ['value', 'label', 'fact', 'unit', 'caption', 'source', 'visual', 'evidence'], quiz: ['question', 'answer', 'choices', 'explain', 'evidence'],
  activity: ['title', 'steps', 'minutes', 'mode', 'worksheetRef', 'output', 'visual'], vocab: ['terms', 'title'],
  timeline: ['title', 'events'], summary: ['title', 'items', 'next', 'visual'], exit: ['question', 'hint', 'visual'], passage: ['title', 'chunks', 'note'],
};
// 최상위 s.visual을 실제로 렌더링하는 유형 — build.mjs의 R[type] 렌더러가 s.visual을 직접 읽는 유형만.
// compare·steps는 visual을 받지만 중첩 자리(left.visual/right.visual, steps[].visual)에만 있어야 렌더링되고,
// 최상위 s.visual은 그 렌더러가 아예 읽지 않아 조용히 사라진다 — S1-VISUAL-IGNORED가 이 사고를 잡는다.
const VISUAL_TOPLEVEL_TYPES = new Set(['cover', 'hook', 'concept', 'diagram', 'bignum', 'activity', 'exit', 'summary']);
const ITEM_COMMON_KEYS = ['type', 'obj', 'points'];
const ITEM_KEYS = {
  concept: ['text'], choice: ['q', 'choices', 'answer', 'explain', 'cols'], short: ['q', 'lines', 'answer', 'explain'],
  ox: ['q', 'rows'], match: ['q', 'left', 'right', 'answer'], table: ['q', 'head', 'rows'],
  draw: ['q', 'height', 'model', 'placeholder', 'base', 'answer'], figure: ['svg', 'image', 'visual', 'caption', 'height'],
  passage: ['text', 'title', 'source', 'start'],
};

// ── 공용: plot 수집 · 수식 기호 정규화 (S4-DATA, E1-VERIFY, E1-SYMBOL이 함께 쓴다) ──
// lesson.json 어디든(슬라이드·활동지·지도안) 있는 {plot:{...}}를 전부 모은다.
function collectPlots(node, out = []) {
  if (Array.isArray(node)) { node.forEach(n => collectPlots(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.plot && typeof node.plot === 'object') out.push(node.plot);
    for (const k of Object.keys(node)) collectPlots(node[k], out);
  }
  return out;
}
// 슬라이드 하나 안의 모든 visual(문자열 SVG 또는 {plot}/{bars}/{image}) — 위치 상관없이 모은다
function slideVisuals(s) {
  const out = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (node.visual !== undefined && node.visual !== null) out.push(node.visual);
      for (const k of Object.keys(node)) if (k !== 'visual') walk(node[k]);
    }
  };
  walk(s);
  return out;
}
const plotDataPointCount = v => v && typeof v === 'object' && v.plot && Array.isArray(v.plot.data)
  ? v.plot.data.reduce((a, d) => a + (d.points?.length || 0), 0) : 0;
const plotDataFacts = v => v && typeof v === 'object' && v.plot && Array.isArray(v.plot.data) ? v.plot.data.map(d => d.fact) : [];
// evidence: 문자열 id(하위 호환) 또는 {fact, refutes:"left"|"right"} 객체, 그 배열도 받는다.
// E1(JUDGE-EVIDENCE/DISCRIM/PRESPOILER)과 V1(JUDGEIMG)이 함께 쓰도록 최상위에 둔다.
function normEvidence(ev) {
  return (Array.isArray(ev) ? ev : ev !== undefined && ev !== null ? [ev] : [])
    .map(e => typeof e === 'string' ? { fact: e, refutes: undefined, bare: true } : { fact: e?.fact, refutes: e?.refutes, bare: false });
}
// 판정 슬라이드가 근거로 삼는 facts id 전체(evidence 필드 + 그 슬라이드 안 plot.data.fact 전부).
function judgeFactIds(judge) {
  const ids = new Set(normEvidence(judge.evidence).map(e => e.fact).filter(Boolean));
  slideVisuals(judge).forEach(v => plotDataFacts(v).forEach(fid => { if (fid) ids.add(fid); }));
  return ids;
}
const NUM_TOK = /\d+(?:[.,]\d+)*/g;
const KEY_TOK = /[가-힣A-Za-z]{2,}/g;
// statesObservation 전용 — "아주"·"오래"처럼 짧고 흔한 화제어까지 낱말로 세면 hook의 열린 질문도
// 우연히 겹쳐 스포일러로 오탐한다. 3글자 이상만 "그 관찰 특유의 낱말"로 본다.
const OBS_KEY_TOK = /[가-힣A-Za-z]{3,}/g;
// fact 하나의 관찰이 어떤 텍스트에 이미 나와 있는지 — 두 자리 이상 수치 하나, 또는 서로 다른 낱말
// (3글자 이상) 5개 이상이 겹쳐야 "그 관찰을 말했다"고 본다(E1-PRESPOILER, V1-JUDGEIMG 확장이 함께
// 쓴다). 겹치는 게 서너 개뿐이면 "실험 방법(측정 도구)만 설명하고 결과는 아직 안 밝힘"(예: 아이오딘
// 반응 색 변화로 측정한다는 설명)이나 "누가 무엇을 실험했는지"만 말하는 역사 서술에서도 흔히 나오므로
// 넘긴다 — 5는 실제 사례(광전 효과 blind 테스트는 6개 겹침, 효소 실험 방법 설명은 4개 겹침)로 맞춘 값이다.
// "1648년"의 "1648"처럼 연도로 쓰인 숫자나 "17세기"의 "17"처럼 세기로 쓰인 숫자는 관찰(수치 결과)이
// 아니라 "언제 일어났는지"일 뿐이므로 뺀다(hook·역사 서술은 연도·세기를 밝혀도 괜찮고, "1850년 푸코의
// 실험" 같은 순수 정성적 사실이 연도 하나만으로 E1-JUDGE-DATA에 걸리지도 않는다) — matchAll로 실제
// 위치를 잡아 뒤에 "년"·"세기"가 오는지 직접 보고 빼야 한다(정규식 lookahead만 쓰면 \d+가 짧게
// 물러나 "1648" 대신 "164"가 통과하는 backtrack 사고가 난다). "출간"처럼 그 앞에 출판 맥락어가 붙어
// "년"이 안 붙은 채 나오는 연도(예: "...출간 1687")도 같은 이유로 뺀다(실제 사고: 반 헬몬트 fact의
// "17세기 전반"이 hook lead에도 그대로 있어 "17"을 진짜 측정값으로 오인해 E1-PRESPOILER가 오탐함).
// E1-PRESPOILER·V1-JUDGEIMG·E1-JUDGE-DATA가 모두 이 정의로 "진짜 측정값"을 가른다 — lb·g·kg 등 단위가
// 붙은 숫자는 이 예외에 안 걸리므로 그대로 측정값으로 센다.
const YEAR_OR_CENTURY_SUFFIX = /^\s*(년|세기)/;
const YEAR_CONTEXT_PREFIX = /(출간|발간|출판|발표)\D{0,6}$/;
function realNumbers(factText) {
  const ft = String(factText ?? '');
  return [...ft.matchAll(/\d+(?:[.,]\d+)*/g)]
    .filter(m => !YEAR_OR_CENTURY_SUFFIX.test(ft.slice(m.index + m[0].length)) && !YEAR_CONTEXT_PREFIX.test(ft.slice(0, m.index)))
    .map(m => m[0])
    .filter(n => n.replace(/[.,]/g, '').length >= 2);
}
function statesObservation(text, factText) {
  const t = plain(text);
  const nums = realNumbers(factText);
  if (nums.some(n => t.includes(n))) return true;
  const kws = [...new Set(String(factText ?? '').match(OBS_KEY_TOK) || [])];
  return kws.filter(k => t.includes(k)).length >= 5;
}
// plot(또는 svg 문자열)에서 축 이름·라인/커브/데이터/점 라벨, <text> 내용을 모아 기호 검사용 텍스트로 만든다
function visualText(v) {
  if (typeof v === 'string') return [...v.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, '')).join(' ');
  if (v && typeof v === 'object' && v.plot) {
    const p = v.plot;
    return [p.xLabel, p.yLabel, ...(p.lines || []).map(l => l.label), ...(p.curves || []).map(c => c.label),
      ...(p.data || []).map(d => d.label), ...(p.points || []).map(pt => pt.label)].filter(Boolean).join(' ');
  }
  // {tikz}/{refraction}/{circuit}/{particles}/{geometry}/{vectors} — 실제 <text>는 diagrams.mjs가 빌드 때 만들지만
  // 그 전에 lesson.json만 보고도 같은 라벨 글자를 얻을 수 있어야(S4-NUM·E1-SYMBOL) toTikzSpec을 그대로 쓴다.
  const spec = toTikzSpec(v);
  if (spec) return (spec.labels || []).map(l => l.text).filter(Boolean).join(' ');
  return '';
}
// $\theta_i$ ↔ θᵢ ↔ θ_i, $n_1$ ↔ n₁, E_k ↔ Eₖ 같은 표기를 같은 기호로 보기 위한 정규화(E1-SYMBOL).
const GREEK_TO_NAME = { θ: 'theta', λ: 'lambda', Δ: 'Delta', μ: 'mu', π: 'pi', α: 'alpha', β: 'beta', γ: 'gamma', ω: 'omega', φ: 'phi', ε: 'epsilon', ν: 'nu', ρ: 'rho', σ: 'sigma', τ: 'tau',
  Θ: 'Theta', Λ: 'Lambda', Μ: 'Mu', Π: 'Pi', Α: 'Alpha', Β: 'Beta', Γ: 'Gamma', Ω: 'Omega', Φ: 'Phi', Ε: 'Epsilon', Ν: 'Nu', Ρ: 'Rho', Σ: 'Sigma', Τ: 'Tau' };
const SUB_UNI = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', ᵢ: 'i', ⱼ: 'j', ₖ: 'k', ₗ: 'l', ₘ: 'm', ₙ: 'n', ₒ: 'o', ₚ: 'p', ᵣ: 'r', ₛ: 's', ₜ: 't', ᵤ: 'u', ᵥ: 'v', ₓ: 'x', ₐ: 'a', ₑ: 'e', ₕ: 'h' };
const SUB_UNI_CLASS = Object.keys(SUB_UNI).join('');
const SYMBOL_EXCLUDE = new Set(['O']);   // 원점 라벨처럼 변수가 아닌 단독 글자
// 단위 낱말 — E1-SYMBOL이 변수 기호로 오인하면 안 되고("전류 I (A)"의 A), E1-AXIS는 반대로
// 이 목록에 있어야 "단위가 붙었다"고 인정한다. 두 게이트가 같은 목록을 쓰도록 한 곳에 둔다.
const UNIT_NAMES = 'kPa|atm|eV|Hz|nm|μm|mm|cm|km|kg|mL|°C|℃|℉|V|A|Ω|W|Pa|N|J|L|g|%';
const canonSymbol = (base, sub) => { const name = GREEK_TO_NAME[base] || base; return sub ? `${name}_${sub}` : name; };
const MATH_FN = /\\(sin|cos|tan|log|ln|sqrt|times|cdot|approx|le|ge|neq|pm|quad|text|mathrm|propto|infty|sum|int|lim|to)\b/g;
const GREEK_CMD = 'theta|lambda|Delta|mu|pi|alpha|beta|gamma|omega|phi|epsilon|nu|rho|sigma|tau|Theta|Lambda|Mu|Pi|Alpha|Beta|Gamma|Omega|Phi|Epsilon|Nu|Rho|Sigma|Tau';
// $...$ 수식(과 $$...$$ 디스플레이 수식) 안의 변수 기호를 뽑는다(연산자·함수 명령은 먼저 지운다).
// $$부터 시도해야 한다 — 홑$ 패턴만 쓰면 여는/닫는 $$의 한 글자씩만 델리미터로 먹어 어긋난다.
function formulaSymbols(text) {
  const out = new Set();
  const re = new RegExp(`\\\\(${GREEK_CMD})(?:_\\{([A-Za-z0-9]+)\\}|_([A-Za-z0-9]))?|([A-Za-z])(?:_\\{([A-Za-z0-9]+)\\}|_([A-Za-z0-9]))?`, 'g');
  for (const m of String(text ?? '').matchAll(/\$\$([^$\n]+?)\$\$|\$([^$\n]+)\$/g)) {
    const body = (m[1] ?? m[2]).replace(MATH_FN, ' ');
    for (const mm of body.matchAll(re)) {
      const base = mm[1] || mm[4], sub = mm[2] || mm[3] || mm[5] || mm[6];
      if (!base || SYMBOL_EXCLUDE.has(base)) continue;
      out.add(canonSymbol(base, sub));
    }
  }
  return out;
}
// 그림 라벨·SVG 텍스트에서 "단독 글자"만 변수 후보로 뽑는다 — Hz·cm 같은 두 글자 이상 단위·낱말은 무시한다
// (그리스 문자는 sinθ처럼 라틴 글자에 바로 붙어도 그 자체로 온전한 기호이므로 이 격리 조건을 두지 않는다).
// "공기 (n₁)"처럼 괄호 안에 기호를 덧적는 표기도 있으므로 괄호를 미리 지우지 않는다 — 괄호 자체가
// 글자가 아니라서 격리 조건(앞뒤에 다른 라틴 글자가 없어야 함)은 괄호 안에서도 그대로 성립한다.
// 다만 V·A·W·N·J·L·g처럼 "단위 하나가 글자 하나"인 경우는 격리 조건만으로 변수와 못 가른다 — 축 이름
// 끝의 "(A)"(E1-AXIS가 붙이라고 권한 바로 그 단위)나 "0.40A"처럼 숫자 뒤에 붙은 단위는 먼저 지운다.
const stripUnits = text => String(text ?? '')
  .replace(new RegExp(`\\(\\s*(?:${UNIT_NAMES})\\s*\\)`, 'g'), ' ')                    // "(A)", "(kPa)" — 단위만 있는 괄호
  .replace(new RegExp(`([0-9])\\s*(?:${UNIT_NAMES})(?![A-Za-z])`, 'g'), '$1');    // "0.40A", "101 kPa" — 숫자 뒤 단위(뒤에 조사가 와도 됨)
function figureSymbols(text) {
  const out = new Set();
  const re = new RegExp(`[Α-Ωα-ω](?:[${SUB_UNI_CLASS}]+|_\\{?[A-Za-z0-9]+\\}?)?|(?<![A-Za-z])[A-Za-z](?:[${SUB_UNI_CLASS}]+|_\\{?[A-Za-z0-9]+\\}?)?(?![A-Za-z])`, 'g');
  for (const m of stripUnits(text).matchAll(re)) {
    const base = m[0][0];
    if (SYMBOL_EXCLUDE.has(base)) continue;
    let sub = m[0].slice(1);
    if (sub.startsWith('_')) sub = sub.replace(/^_\{?|\}?$/g, '');
    else if (sub) sub = [...sub].map(c => SUB_UNI[c] ?? c).join('');
    out.add(canonSymbol(base, sub || undefined));
  }
  return out;
}

// ── S1-SHAPE: 배열 필드 원소의 모양(문자열 vs 객체) ─────────────────────
// 슬라이드·활동지 유형별로 배열 필드가 담아야 할 원소 모양을 표로 적어 둔다. 'string'이면
// 원소가 문자열이어야 하고, 객체 스펙({key:required})이면 원소가 그 키를 가진 객체여야 한다.
// 예전에 activity.steps에 {h,t} 객체를 넣어 화면에 "[object Object]"가 그대로 찍힌 사고가
// 있었다 — 그 반대(steps.steps에 문자열)도 같은 사고를 낸다. 이 표 하나로 양쪽을 다 잡는다.
const SLIDE_SHAPES = {
  concept: { points: { h: true, t: false } },
  steps: { steps: { h: true, t: false, visual: false } },
  activity: { steps: 'string' },
  quiz: { choices: 'string' },
  compare: { 'left.items': 'string', 'right.items': 'string' },
  vocab: { terms: { term: true, def: true, en: false } },
  timeline: { events: { when: true, what: true } },
  summary: { items: 'string' },
  goals: { items: 'string' },
  passage: { chunks: { label: true, text: true, hot: false } },
};
// 'string[]'는 "행 배열의 배열"(표의 head/rows처럼) — 각 칸이 문자열이어야 한다.
const ITEM_SHAPES = {
  choice: { choices: 'string' },
  ox: { rows: { s: true, a: true } },
  match: { left: 'string', right: 'string' },
  table: { head: 'string', rows: 'string[]' },
};
const checkShapes = (obj, shapes, tag, err) => {
  const spec = shapes[obj.type];
  if (!spec) return;
  for (const [field, fieldSpec] of Object.entries(spec)) {
    const val = field.split('.').reduce((o, k) => o?.[k], obj);
    if (val === undefined || val === null) continue;
    if (!Array.isArray(val)) {
      // 배열이어야 할 자리에 숫자 키 객체({"0":"주","1":"사",…})가 들어간 경우 — 문자열을 배열 자리에
      // 그대로 펼쳐 넣은 사고(스프레드 문자열)다. 화면엔 "주사기" 같은 글자가 그럭저럭 나올 수도 있어
      // (B1/B6-RENDER가 못 잡을 수 있음) 여기서 정적으로 막는다.
      if (typeof val === 'object') err('S1-SHAPE', `${tag} ${field}은(는) 배열이어야 하는데 객체임: ${JSON.stringify(val).slice(0, 40)}`, `${field}는 문자열(또는 객체) 배열이어야 합니다 — 문자열 하나를 배열 자리에 그대로 펼쳐 넣지 않았는지 확인하세요`);
      continue;
    }
    if (fieldSpec === 'string[]') {
      val.forEach((row, i) => {
        if (!Array.isArray(row)) { err('S1-SHAPE', `${tag} ${field}[${i}]은(는) 행(배열)이어야 하는데 ${row === null ? 'null' : typeof row}임`, `${field}는 행 배열의 배열이어야 합니다`); return; }
        row.forEach((cell, j) => { if (typeof cell !== 'string') err('S1-SHAPE', `${tag} ${field}[${i}][${j}]은(는) 문자열이어야 하는데 ${cell === null ? 'null' : typeof cell}임`, `${field}의 각 칸에는 문자열만 넣으세요`); });
      });
      continue;
    }
    val.forEach((el, i) => {
      if (fieldSpec === 'string') {
        if (typeof el !== 'string') err('S1-SHAPE', `${tag} ${field}[${i}]은(는) 문자열이어야 하는데 ${el === null ? 'null' : typeof el}임`, `${field}에는 문자열만 넣으세요`);
      } else if (typeof el !== 'object' || el === null || Array.isArray(el)) {
        err('S1-SHAPE', `${tag} ${field}[${i}]은(는) {${Object.keys(fieldSpec).join(',')}} 객체여야 하는데 ${el === null ? 'null' : typeof el}임`, `${field}[${i}]를 ${JSON.stringify(Object.fromEntries(Object.keys(fieldSpec).map(k => [k, '…'])))} 형태로 바꾸세요`);
      } else {
        for (const [k, required] of Object.entries(fieldSpec)) if (required && (el[k] === undefined || el[k] === '')) err('S1-SHAPE', `${tag} ${field}[${i}]에 ${k} 없음`, `${field}[${i}]에 ${k} 필드를 넣으세요`);
      }
    });
  }
};

// ── S1 구조 ────────────────────────────────────────────
// {{ }} 빈칸 안에 진짜 정답 대신 이런 자리표시자 낱말 자체를 그대로 써 넣는 사고를 잡는다(S1-BLANK-LITERAL).
const PLACEHOLDER_BLANK = /^(정답|답|빈칸|모범\s*답안|answer|blank|\.{2,}|_{2,})$/i;
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
    // 최상위 visual이 있는데 이 유형의 렌더러가 그 자리를 읽지 않으면 화면에서 조용히 사라진다 —
    // S1-UNKNOWN은 경고일 뿐이라 이 사고는 FAIL로 따로 잡는다(build.mjs의 R[type] 렌더러와 짝 맞춰 관리).
    if (s.visual !== undefined && s.visual !== null && s.visual !== '' && !VISUAL_TOPLEVEL_TYPES.has(s.type))
      err('S1-VISUAL-IGNORED', `${n}번(${s.type})에 최상위 visual이 있지만 이 유형은 화면에 그리지 않음 — 조용히 사라짐`,
        s.type === 'compare' ? 'compare는 left.visual/right.visual에 넣으세요'
        : s.type === 'steps' ? 'steps는 각 단계(steps[].visual)에 넣으세요'
        : '이 유형은 시각 자료를 지원하지 않습니다 — 필드를 지우세요');
    if (!s.notes || plain(s.notes).length < 20) err('S1-NOTES', `${n}번 슬라이드 발표자 노트가 없거나 20자 미만`, '교사가 말할 핵심·발문을 적으세요');
    const req = { hook: ['question', 'visual'], concept: ['title', 'points'], compare: ['title', 'left', 'right'], steps: ['title', 'steps'], diagram: ['title', 'visual'],
      bignum: ['value', 'label', 'fact'], quiz: ['question', 'answer'], activity: ['title', 'steps', 'minutes'], vocab: ['terms'], timeline: ['title', 'events'],
      summary: ['title', 'items'], exit: ['question'], chapter: ['title'], passage: ['title', 'chunks'] }[s.type] || [];
    for (const k of req) if (s[k] === undefined || s[k] === '') err('S1-FIELD', `${n}번(${s.type})에 ${k} 없음`);
    const cnt = { passage: ['chunks', 1, 4], concept: ['points', 1, rules.pointsMax], steps: ['steps', 3, 5], vocab: ['terms', 2, 4], timeline: ['events', 3, 5], summary: ['items', 2, 3] }[s.type];
    if (cnt && Array.isArray(s[cnt[0]]) && (s[cnt[0]].length < cnt[1] || s[cnt[0]].length > cnt[2])) err('S1-COUNT', `${n}번(${s.type}) ${cnt[0]} ${s[cnt[0]].length}개 — ${cnt[1]}~${cnt[2]}개`);
    if (s.type === 'quiz' && s.choices && !(s.answer >= 1 && s.answer <= s.choices.length)) err('S1-QUIZ', `${n}번 quiz answer가 선택지 번호(1~${s.choices.length})가 아님`);
    checkShapes(s, SLIDE_SHAPES, `${n}번(${s.type})`, err);
  });
  const secs = W.sections || [];
  if (secs.length < 2) err('S1-WS-SEC', `활동지 섹션 ${secs.length}개 — 2개 이상`);
  if (questions.length < 5 || questions.length > 14) err('S1-WS-Q', `활동지 문항 ${questions.length}개 — 5~14개`);
  items.forEach((it, i) => {
    if (!ITEM_TYPES.includes(it.type)) return err('S1-WS-TYPE', `활동지 문항 유형 ${it.type} 없음`, ITEM_TYPES.join(', '));
    const knownItemKeys = new Set([...ITEM_COMMON_KEYS, ...(ITEM_KEYS[it.type] || [])]);
    Object.keys(it).forEach(k => { if (!knownItemKeys.has(k)) warn('S1-WS-UNKNOWN', `활동지 문항(${it.type}) 알 수 없는 필드 "${k}" — 오타 확인. 이 유형이 쓰는 필드: ${[...knownItemKeys].join(', ')}`); });
    checkShapes(it, ITEM_SHAPES, `활동지 ${i + 1}번째(${it.type})`, err);
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
    // {{ }} 안에 실제 정답 대신 "정답"이라는 자리표시자 낱말 자체를 그대로 써 넣은 사고 — 정답지에
    // 진짜 답 대신 "정답"이라는 글자가 그대로 찍힌다(blind3-pe에서 실제로 있었던 사고).
    for (const m of JSON.stringify(it).matchAll(/\{\{\s*(.*?)\s*\}\}/g)) {
      if (PLACEHOLDER_BLANK.test(m[1].trim()))
        err('S1-BLANK-LITERAL', `활동지 ${i + 1}번째(${it.type}) 문항의 빈칸 {{${m[1]}}}이 자리표시자 낱말 그대로임 — 실제 정답 텍스트가 아님`,
          '{{ }} 안에는 그 빈칸의 실제 정답 텍스트를 쓰세요(예: {{높다}}) — "정답"이라는 글자 자체를 쓰지 마세요');
    }
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
  // {tikz}/{refraction}/{circuit}/{particles}/{geometry}/{vectors}의 라벨 글자(각도·눈금 등 수치가 들어갈 수 있다)도
  // 대조 대상에 넣는다 — visualsOf()가 뽑는 건 lesson.json 원본 visual 객체라 toTikzSpec으로 같은 라벨을 얻는다.
  const visualScanText = v => typeof v === 'string' ? v : `${barsText(v)} ${visualText(v)}`;
  slides.forEach((s, i) => scan(`${i + 1}번 슬라이드`, slideText(s) + ' ' + visualsOf(s).map(visualScanText).join(' ')));
  // draw.base(좌표평면 {plot}·백지도 SVG·도해 엔진 객체)도 svg/visual과 같은 "그림 형태" 필드라 원본
  // 좌표·범위 숫자(예: geometry의 점 x,y)가 그대로 새면 안 된다 — svg와 같은 방식으로 라벨 글자만 남긴다.
  items.forEach(it => scan('활동지', textOf({ ...it, obj: 0, lines: 0, height: 0, cols: 0, points: 0, svg: typeof it.svg === 'string' ? it.svg : visualScanText(it.svg), base: typeof it.base === 'string' ? it.base : visualScanText(it.base), answer: typeof it.answer === 'string' ? it.answer : '' })));
  slides.filter(s => s.type === 'bignum').forEach(s => { if (!facts.some(f => f.id === s.fact)) err('S4-BIGNUM', `bignum 슬라이드의 fact "${s.fact}"가 facts에 없음`); });
  // 그래프의 data(실측값) 시리즈 — fact로 연결돼 있어야 하고, 점 값 자체가 그 fact.text에 있어야 한다
  // (지어낸 "측정값"이 그래프에만 있고 출처는 없는 상황을 막는다).
  collectPlots(L).forEach((pl, idx) => {
    (pl.data || []).forEach(d => {
      const tag = `그래프(${idx + 1}번째) data "${d.label || ''}"`;
      if (!d.fact) return err('S4-DATA', `${tag}에 fact 연결이 없음`, 'facts의 id를 data.fact에 넣으세요');
      const f = facts.find(x => x.id === d.fact);
      if (!f) return err('S4-DATA', `${tag}의 fact "${d.fact}"가 facts에 없음`);
      const ftext = plain(f.text).replace(/\s+/g, '');
      (d.points || []).forEach(([x, y]) => {
        [x, y].forEach(v => { if (!ftext.includes(String(v))) err('S4-DATA', `${tag}의 값 ${v}가 연결된 fact("${d.fact}")의 text에 없음`, 'facts.text에 실제 실험값을 적거나 값을 facts와 맞추세요'); });
      });
    });
  });
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

  // 문체 통일 — meta.tone이 해요체/합쇼체면 학생이 읽는 문장의 종결어미가 그 문체를 따라야 한다(pedagogy.md 9번).
  // 대상: slides[].lead/caption/subtitle/explain, points[].t, 활동지 섹션 lead·tip — 모두 학생에게 그대로 보이는
  // "완성된 문장"이다. compare의 label·items, points[].h, 제목, OX·활동지 문항 진술·선택지, notes(교사용), 지도안은
  // 성격이 다르거나(명사구·짧은 항목) 교사만 보는 글이라 문체를 맞출 대상이 아니므로 여기서 뺀다.
  if (M.tone === '해요체' || M.tone === '합쇼체') {
    // 마침표(.!?) 단위로 문장을 자른다. 문장이 없어도(끝에 구두점이 없어도) 한 줄 전체를 봐준다.
    const sentencesOf = t => String(t ?? '').split(/\n+/).flatMap(line => plain(line).match(/[^.!?]+[.!?]/g) || (plain(line).trim() ? [plain(line).trim()] : []));
    // "…읍시다/…ㅂ시다"(청유형, "확인해 봅시다")는 평서형이 아니라 존대 수준이 같으므로 위반으로 보지 않는다.
    const isPlainDa = s => /다\.\s*$/.test(s) && !/(니다|시다)\.\s*$/.test(s);
    const isNida = s => /니다[.!?]?\s*$/.test(s);
    const isYo = s => /(아요|어요|여요|해요|예요|이에요|네요|죠|나요|가요|와요|봐요|줘요|돼요)[.!?]?\s*$/.test(s);
    const check = (label, text) => {
      for (const s of sentencesOf(text)) {
        const t = s.trim();
        if (isPlainDa(t)) err('S5-TONE', `${label}이(가) 평서형 "…다."로 끝남(높임 문체 아님): "${t}"`, M.tone === '해요체' ? '"…어요/해요"체로 고치세요' : '"…습니다"체로 고치세요');
        else if (M.tone === '해요체' && isNida(t)) warn('S5-TONE-MIX', `${label}이(가) meta.tone(해요체)과 다른 "…니다"체: "${t}"`);
        else if (M.tone === '합쇼체' && isYo(t)) warn('S5-TONE-MIX', `${label}이(가) meta.tone(합쇼체)과 다른 "…요"체: "${t}"`);
      }
    };
    slides.forEach((s, i) => {
      const n = `${i + 1}번(${s.type})`;
      if (s.subtitle) check(`${n} subtitle`, s.subtitle);
      if (s.lead) check(`${n} lead`, s.lead);
      if (s.caption) check(`${n} caption`, s.caption);
      if (s.explain) check(`${n} explain`, s.explain);
      (s.points || []).forEach((p, k) => { if (p.t) check(`${n} points[${k + 1}].t`, p.t); });
    });
    (W.sections || []).forEach((sec, i) => { if (sec.lead) check(`활동지 섹션 ${i + 1}(${plain(sec.title || '')}) lead`, sec.lead); });
    if (W.tip) check('활동지 tip', W.tip);
  }

  // 선택지·진술문이 오개념 문장 그대로("…생각한다"/"…여긴다"/"…믿는다")면 "옳은 것은?" 같은 발문의
  // 답으로 쓸 수 없다 — 오개념을 오답 선택지로 쓰려면 그 오개념을 단정문(주장)으로 고쳐 써야 한다(intake.md 참고).
  const BELIEF_END = /(생각한다|여긴다|믿는다)\.?\s*$/;
  slides.forEach((s, i) => {
    if (s.type === 'quiz') (s.choices || []).forEach((c, k) => { if (BELIEF_END.test(plain(c).trim())) err('S5-CHOICE-BELIEF', `${i + 1}번 quiz 선택지 ${k + 1}("${plain(c)}")이 "…생각한다/여긴다/믿는다"로 끝남 — 답이 될 수 없는 서술`, '오개념을 단정문으로 고쳐 쓰세요(예: "…라고 생각한다" → "…이다")'); });
  });
  items.forEach((it, i) => {
    if (it.type === 'choice') (it.choices || []).forEach((c, k) => { if (BELIEF_END.test(plain(c).trim())) err('S5-CHOICE-BELIEF', `활동지 ${i + 1}번째 문항 선택지 ${k + 1}("${plain(c)}")이 "…생각한다/여긴다/믿는다"로 끝남`, '오개념을 단정문으로 고쳐 쓰세요'); });
    if (it.type === 'ox') (it.rows || []).forEach((r, k) => { if (BELIEF_END.test(plain(r.s || '').trim())) err('S5-CHOICE-BELIEF', `활동지 ${i + 1}번째 OX 문항 진술 ${k + 1}("${plain(r.s)}")이 "…생각한다/여긴다/믿는다"로 끝남`, '오개념을 단정문으로 고쳐 쓰세요'); });
  });

  // 범주 낱말 혼동(경고) — "필요한 물질이 아닌 것은?"에서 선택지에 에너지/빛/열이 있으면 그 선택지도
  // "물질이 아니"어서(빛에너지는 물질이 아니라 에너지다) 정답이 여럿으로 보일 수 있다 — 실제로 이 문제로
  // 정답이 두 개가 된 사고가 있었다(빛에너지가 광합성에 필요한 것은 맞지만 "물질"은 아니어서, 그 문항의
  // 취지("광합성에 필요하지 않은 것")와 "물질이 아닌 것" 사이에 범주가 어긋난다).
  const CATEGORY_MISMATCH = /물질이 아닌/;
  const ENERGY_WORD = /에너지|빛|열/;
  const scanCategory = (label, question, choices) => {
    if (!CATEGORY_MISMATCH.test(plain(question || ''))) return;
    const hit = (choices || []).filter(c => ENERGY_WORD.test(plain(c)));
    if (hit.length) warn('S5-CHOICE-CATEGORY', `${label} "물질이 아닌 것은?" 발문에 선택지 "${hit.join(', ')}"가 있음 — 그 자체도 물질이 아니라 에너지/빛/열이라 정답이 여럿으로 보일 수 있음`,
      '범주가 겹치지 않는 선택지로 바꾸거나("물질" 후보끼리만 비교), 발문을 "필요하지 않은 것은?"처럼 범주를 섞어도 되는 표현으로 고치세요');
  };
  slides.forEach((s, i) => { if (s.type === 'quiz') scanCategory(`${i + 1}번 quiz`, s.question, s.choices); });
  items.forEach((it, i) => { if (it.type === 'choice') scanCategory(`활동지 ${i + 1}번째 문항`, it.q, it.choices); });
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

// ── S8 안전 (하자드 문구 → 필요한 안전 문구, references/pedagogy.md §11) ──
await gate('S8', '안전', (err, warn) => {
  const FLAMMABLE = /에탄올|알코올/;
  const HEAT = /가열|중탕|끓|데우|따뜻/;
  const WATERBATH = /물중탕/;
  const FIRE_NOTE = /화기|불꽃|인화/;
  const CIRCUIT_NOTE = /합선|단락|과열/;
  slides.forEach((s, i) => {
    const visible = plain(slideText(s));   // 학생이 보는 화면 전체(제목·단계·캡션·선택지 등)
    const notes = plain(s.notes || '');
    const combined = `${visible} ${notes}`;
    // 가연성 액체(에탄올/알코올)를 가열(중탕·끓임·데움 포함)과 함께 언급하면, 물중탕과 화기 주의 문구가
    // 학생이 보는 화면(steps 등)이나 notes에 함께 있어야 한다 — 없으면 직접 가열로 오인되기 쉽다.
    if (FLAMMABLE.test(combined) && HEAT.test(combined)) {
      const hasWaterbath = WATERBATH.test(visible) || WATERBATH.test(notes);
      const hasFireNote = FIRE_NOTE.test(visible) || FIRE_NOTE.test(notes);
      if (!hasWaterbath || !hasFireNote)
        err('S8-SAFETY', `${i + 1}번(${s.type})이 가연성 액체(에탄올/알코올) 가열을 언급하는데 물중탕·화기 주의 문구가 없음`,
          '직접 가열 대신 "물중탕(수욕)"으로 데우고, "화기 주의"·"불꽃 근처에 두지 않는다" 같은 문구를 steps나 notes에 넣으세요');
    }
    // 전원장치·전지 + 도선(회로 실험)은 합선·과열 주의 문구가 없으면 경고(감전·화상 위험이 낮아 FAIL은 아님)
    if (/전원장치|전지/.test(combined) && /도선/.test(combined) && !CIRCUIT_NOTE.test(combined))
      warn('S8-CIRCUIT', `${i + 1}번(${s.type})이 전원장치/전지와 도선을 쓰는데 합선·과열 주의 문구가 없음`,
        '"도선이 서로 닿아 합선(단락)되지 않게 한다", "뜨거워지면 즉시 전원을 끈다" 같은 문구를 넣으세요');
  });
  // 활동지 문항에도 같은 기준을 적용한다(실험 절차 서술이 문항 본문에 있을 수 있음)
  items.forEach((it, i) => {
    const text = plain(JSON.stringify(it));
    if (FLAMMABLE.test(text) && HEAT.test(text) && !(WATERBATH.test(text) && FIRE_NOTE.test(text)))
      err('S8-SAFETY', `활동지 ${i + 1}번째 문항이 가연성 액체 가열을 언급하는데 물중탕·화기 주의 문구가 없음`,
        '물중탕(수욕)으로 데우고 화기 주의 문구를 넣으세요');
    if (/전원장치|전지/.test(text) && /도선/.test(text) && !CIRCUIT_NOTE.test(text))
      warn('S8-CIRCUIT', `활동지 ${i + 1}번째 문항이 전원장치/전지와 도선을 쓰는데 합선·과열 주의 문구가 없음`, '합선·과열 주의 문구를 넣으세요');
  });

  // ── S8-TRAP: 교과별 실험 함정(references/pedagogy.md §11 표를 그대로 코드화) ──
  // 행 하나 = 함정 하나: trigger(문제될 만한 절차 언급)에 걸리고 satisfies(그 함정을 실제로 피한
  // 처리·문구)가 없으면 level(err/warn, evidenceEscalate면 evidence 프로파일에서 err로 올라감)로
  // 보고한다. 표 형태라 새 함정은 이 배열에 행만 추가하면 된다.
  //
  // 범위(N3): 절차가 실제로 있는 자리(steps·activity·diagram 슬라이드+그 notes, hook 시범, 활동지의
  // 절차성 문항)만 온전히(레슨 전체와 무관하게 그 자리 글만 보고) 검사한다. 결과만 되풀이하는 자리
  // (summary·quiz·exit 슬라이드, 활동지의 표(table) 문항)는 그 자리 글만으로 트리거되더라도, 레슨
  // 어딘가의 절차 자리가 이미 이 함정을 피했으면(satisfies) 봐준다 — 안 그러면 저자가 정리 슬라이드나
  // 결과표에서 핵심 낱말만 지워 게이트를 피하는 나쁜 유인이 생긴다(실제로 있었던 사고).
  const TRAP_PROCEDURE_SLIDE_TYPES = ['steps', 'activity', 'diagram', 'hook'];
  const TRAP_RESTATEMENT_SLIDE_TYPES = ['summary', 'quiz', 'exit'];
  const TRAP_RESTATEMENT_ITEM_TYPES = ['table'];
  const TRAP_DURATION = /(하루|24\s*시간|전날|하룻밤|하루\s*이상)/;
  const TRAP_DARK = /(어둠|어두운\s*곳|암실|빛\s*차단)/;
  const TRAP_ROWS = [
    {
      code: 'STARCH-CONTROL', level: 'err',
      trigger: t => /(녹말|아이오딘|요오드)/.test(t) && /(빛|광|명)\s*(을|이)?\s*(차단|가리|막)|호일|포일|알루미늄\s*(호일|포일)|명암\s*대조|대조군.{0,10}(빛|어둠|명암)/.test(t),
      satisfies: t => /탈녹말/.test(t) || (TRAP_DURATION.test(t) && TRAP_DARK.test(t)),
      msg: (n, type) => `${n}번(${type})이 녹말·아이오딘 반응을 빛/어둠(또는 포일) 대조군과 함께 쓰는데, 실험 전 탈녹말(하루 이상 어둠에 두어 잎의 녹말을 없앰) 처리 언급이 없음`,
      hint: '실험 시작 전 "하루(24시간) 이상 어두운 곳에 두어 탈녹말한다"는 문구를 넣거나, 이미 탈녹말된 잎임을 명시하세요',
    },
    {
      code: 'BUBBLE-OXYGEN', level: 'warn',
      trigger: t => /(기포는\s*산소|산소가\s*발생)/.test(t),
      satisfies: t => /(꺼져\s*가는\s*불씨|향불|불씨)/.test(t),
      msg: (n, type) => `${n}번(${type})이 "기포=산소"를 단정하는데 확인 절차(꺼져 가는 불씨/향불) 언급이 없음`,
      hint: '"꺼져 가는 불씨(향불)를 가까이 대면 다시 타오른다" 같은 확인 절차를 덧붙이세요',
    },
    {
      code: 'IODINE-NO-BLEACH', level: 'err',
      trigger: t => /(잎|잎사귀)/.test(t) && /(아이오딘|요오드)/.test(t),
      satisfies: t => /(에탄올|알코올).{0,10}(탈색|중탕)|탈색/.test(t),
      msg: (n, type) => `${n}번(${type})이 잎에 아이오딘 반응을 보는데 엽록소 제거(에탄올 탈색) 언급이 없음`,
      hint: '"에탄올(알코올)로 물중탕하여 탈색한 뒤" 같은 문구를 넣으세요 — 엽록소 초록색 때문에 아이오딘 반응 색이 가려짐',
    },
    // N2: 향불(꺼져 가는 불씨·성냥불)로 기체를 확인하려면 그 기체를 먼저 모아야(거꾸로 세운 시험관·
    // 깔때기로 포집) 불씨를 댈 수 있다 — 수용액 속에서 올라오는 기포에 그냥 불씨를 대는 것은 물리적으로
    // 안 된다. 모으는 절차가 있어도 활동 시간이 10분 미만이면(포집엔 시간이 걸린다) 여전히 부족하다고
    // 본다. 교사 시범이나 미리 모아 둔 기체로 확인하는 경우는 학생이 직접 그 짧은 시간에 포집하는 게
    // 아니므로 예외로 둔다. 기본은 경고(성급한 결론이지 위험하지는 않다)지만 evidence 프로파일은 FAIL로
    // 올린다(증거 중심 수업은 그 근거 절차 자체가 성립해야 한다).
    {
      code: 'GAS-CHECK-NO-COLLECT', level: 'warn', evidenceEscalate: true,
      trigger: t => /향불|꺼져\s*가는\s*불씨|성냥불/.test(t),
      satisfies: (t, ctx) => /교사\s*시범|시범\s*실험|교사가\s*(미리\s*)?(시범|시연)/.test(t)
        || /미리\s*(모아|포집|준비)|사전에\s*(모아|포집|준비)|이미\s*모아\s*둔/.test(t)
        || (/거꾸로\s*세운|깔때기|포집|모은\s*기체/.test(t) && !(typeof ctx?.minutes === 'number' && ctx.minutes < 10)),
      msg: (n, type) => `${n}번(${type})이 향불(꺼져 가는 불씨/성냥불)로 기체를 확인하는데 기체를 모으는(포집) 절차가 없거나, 있어도 활동 시간이 10분 미만이라 실제로 모을 시간이 부족함`,
      hint: '거꾸로 세운 시험관·깔때기로 기체를 모으는 절차를 넣고 10분 이상 시간을 배정하거나, 교사 시범이나 미리 모아 둔 기체임을 명시하세요',
    },
  ];
  const combinedTextOf = s => `${plain(slideText(s))} ${plain(s.notes || '')}`;
  const primaryTexts = [
    ...slides.filter(s => TRAP_PROCEDURE_SLIDE_TYPES.includes(s.type)).map(combinedTextOf),
    ...items.filter(it => !TRAP_RESTATEMENT_ITEM_TYPES.includes(it.type)).map(it => plain(JSON.stringify(it))),
  ];
  const runTrapRow = (row, text, n, type, ctx, isRestatement) => {
    if (!row.trigger(text) || row.satisfies(text, ctx)) return;
    if (isRestatement && primaryTexts.some(t => row.satisfies(t, {}))) return;   // 절차 자리가 레슨 어딘가 이미 이 함정을 피했으면 결과 되풀이 자리는 봐준다
    const fn = (row.level === 'err' || (row.evidenceEscalate && M.profile === 'evidence')) ? err : warn;
    fn(`S8-TRAP-${row.code}`, row.msg(n, type), row.hint);
  };
  slides.forEach((s, i) => {
    const isPrimary = TRAP_PROCEDURE_SLIDE_TYPES.includes(s.type);
    const isRestatement = TRAP_RESTATEMENT_SLIDE_TYPES.includes(s.type);
    if (!isPrimary && !isRestatement) return;   // 절차도 결과 되풀이도 아닌 자리(concept·compare·goals 등)는 대상 아님
    const text = combinedTextOf(s);
    TRAP_ROWS.forEach(row => runTrapRow(row, text, i + 1, s.type, s, isRestatement));
  });
  items.forEach((it, i) => {
    const isRestatement = TRAP_RESTATEMENT_ITEM_TYPES.includes(it.type);
    const text = plain(JSON.stringify(it));
    TRAP_ROWS.forEach(row => runTrapRow(row, text, i + 1, '활동지 문항', it, isRestatement));
  });
});

// ── E1 증거 중심 (meta.profile==="evidence"일 때만 검사, references/pedagogy.md §10) ──
await gate('E1', '증거 중심', (err, warn) => {
  if (M.profile !== 'evidence') { warn('E1-NONE', 'profile:evidence 아님'); return; }
  slides.forEach((s, i) => {
    const n = i + 1;
    // (a) 개념 슬라이드 한 장에 정의 하나 — points가 2개 이상이면 정의를 욱여넣은 것으로 본다
    if (s.type === 'concept' && (s.points || []).length > 1)
      err('E1-ONEDEF', `${n}번 concept에 정의(포인트) ${s.points.length}개 — 한 장에 정의 하나`, '슬라이드를 나누거나 포인트를 하나로 합치고 나머지는 lead·notes로 옮기세요');
    // (b) 대립 설명은 대칭으로 놓고 다음 장에서 실험으로 판정 — compare 바로 다음 장이 근거 제시 유형이어야 한다.
    // kind:"contrast"(둘 다 참인 대비, 예: "세기를 늘리면" vs "진동수를 높이면")는 판정 대상이 아니므로 뺀다.
    if (s.type === 'compare' && s.kind !== 'contrast') {
      const nextType = slides[i + 1]?.type;
      if (!['diagram', 'steps', 'quiz', 'bignum'].includes(nextType))
        err('E1-JUDGE', `${n}번 compare 다음 장(${nextType || '없음'})이 diagram/steps/quiz/bignum이 아님`, '대립 설명 바로 다음 장에서 실험 결과로 판정하세요');
    }
    // (c) 공식 앞뒤에 증거를 붙인다 — 수식이 있는 슬라이드는 diagram/steps/timeline과 바로 붙어야 한다.
    // diagram/steps/timeline 자신은 이미 근거 슬라이드이므로 제외한다(연쇄 요구를 막기 위함).
    if (!['diagram', 'steps', 'timeline'].includes(s.type) && HAS_FORMULA_RE.test(slideText(s))) {
      const neighbors = [slides[i - 1]?.type, slides[i + 1]?.type];
      if (!neighbors.some(t => ['diagram', 'steps', 'timeline'].includes(t)))
        err('E1-EVIDENCE', `${n}번 슬라이드에 수식이 있는데 앞뒤(${neighbors.map(t => t || '없음').join('/')})에 diagram/steps/timeline이 없음`, '실험·역사적 근거를 보여주는 슬라이드를 바로 앞이나 뒤에 붙이세요');
    }
  });

  // (b2) 판정은 근거로, 그것도 "구별력 있는" 근거로 한다 — compare 다음 장(위 (b)가 유형을 이미 확인한
  // 그 슬라이드)이 "주장만으로" 판정하면 안 되고(E1-JUDGE-EVIDENCE), 그 근거가 왜 반대쪽이 틀렸는지까지
  // 갈라 말해야 한다(E1-JUDGE-DISCRIM) — "기체는 쉽게 압축된다"는 "입자가 작아진다"와 "입자 사이 공간이
  // 줄어든다" 둘 다 예측하므로 판정 근거가 못 된다(pedagogy.md 10번). "반대쪽 설명도 이 관찰을 예측하는가?
  // 그렇다면 근거가 아니다"를 항상 되묻는다.
  // NUM_TOK·KEY_TOK·normEvidence는 최상위(V1도 함께 쓴다)로 옮겼다.
  const mentionsObservation = (text, factText) => {
    const t = plain(text);
    const nums = String(factText ?? '').match(NUM_TOK) || [];
    if (nums.some(n => t.includes(n))) return true;
    const keys = String(factText ?? '').match(KEY_TOK) || [];
    return keys.some(k => t.includes(k));
  };
  const DISCRIM_CUE = /예측하지 못|설명하지 못|맞지 않|틀렸|기각|반대|달리/;
  slides.forEach((s, i) => {
    if (s.type !== 'compare' || s.kind === 'contrast') return;   // contrast는 판정 대상이 아니다
    const judge = slides[i + 1];
    if (!judge) return;   // 다음 장이 아예 없음은 위 (b) E1-JUDGE가 이미 잡는다
    const n = i + 2;
    const hasPlotData = slideVisuals(judge).some(v => v && typeof v === 'object' && v.plot && Array.isArray(v.plot.data) && v.plot.data.length);
    const evList = normEvidence(judge.evidence);
    const judgeText = plain(`${slideText(judge)} ${judge.notes || ''}`);

    if (!hasPlotData && !evList.length) {
      err('E1-JUDGE-EVIDENCE', `${n}번(${judge.type}) 판정 슬라이드에 실험·관찰·데이터가 없음 — 주장만으로 판정함`,
        'plot에 data 시리즈를 넣거나 evidence에 {fact, refutes}를 달고, 본문(explain·caption 등)에 그 관찰 내용(수치나 특징 낱말)을 적으세요');
      return;
    }
    let refutesSides = [];
    if (evList.length) {
      const bare = evList.filter(e => !e.refutes);
      if (bare.length) err('E1-JUDGE-EVIDENCE', `${n}번 판정 슬라이드의 evidence가 어느 설명을 기각하는지(refutes) 밝히지 않음`,
        'evidence를 {fact:"fN", refutes:"left"|"right"} 형태로 쓰세요(배열도 가능)');
      const missing = evList.filter(e => e.fact && !facts.some(f => f.id === e.fact));
      if (missing.length) err('E1-JUDGE-EVIDENCE', `${n}번 판정 슬라이드의 evidence "${missing.map(e => e.fact).join(', ')}"가 facts에 없음`);
      const withFact = evList.filter(e => e.fact && facts.some(f => f.id === e.fact));
      const unmentioned = withFact.filter(e => !mentionsObservation(judgeText, facts.find(f => f.id === e.fact)?.text));
      if (unmentioned.length)
        err('E1-JUDGE-EVIDENCE', `${n}번 판정 슬라이드가 evidence(${unmentioned.map(e => e.fact).join(', ')})를 달았지만 본문에 그 관찰 내용(수치·특징 낱말)이 안 보임`,
          '그 fact.text에 있는 수치나 낱말을 explain·caption 등 학생이 보는 글에 실제로 적으세요');
      refutesSides = [...new Set(evList.map(e => e.refutes).filter(Boolean))];
    }

    // (b3) E1-JUDGE-DISCRIM: refutes를 지정했으면 그 쪽을, plot data만으로 판정했으면(evidence 없이도
    // 통과한 경우) 좌우 어느 한쪽이라도 이름을 걸고 부정해야 한다.
    const sidesToCheck = refutesSides.length ? refutesSides : ['left', 'right'];
    const sideTokens = side => {
      const sideObj = s[side]; if (!sideObj) return [];
      return [plain(sideObj.label || ''), ...(sideObj.items || []).flatMap(it => plain(it).match(KEY_TOK) || [])].filter(Boolean);
    };
    const mentionsSide = side => sideTokens(side).some(tok => tok.length >= 2 && judgeText.includes(tok));
    const hasCue = DISCRIM_CUE.test(judgeText);
    const namedSide = sidesToCheck.some(mentionsSide);
    if (!hasCue || !namedSide)
      err('E1-JUDGE-DISCRIM', `${n}번 판정 슬라이드가 어느 설명이 왜 틀렸는지 갈라 말하지 않음(기각된 쪽의 이름/키워드나 반대 표현이 안 보임)`,
        '기각된 쪽의 라벨이나 키워드를 "예측하지 못했다/맞지 않다/틀렸다/기각" 같은 반대 표현과 함께 적으세요 — 반대쪽 설명도 같은 관찰을 예측한다면 그 근거는 구별력이 없습니다(pedagogy.md 10번)');
  });

  // (b3a) E1-JUDGE-ANSWER: quiz 판정 슬라이드의 "정답"(answer)이 evidence의 결론과 어긋나면 안 된다.
  // 질문 극성(무엇을 묻는지)을 먼저 읽는다 — "이 결과가 기각하는 설명은?"(기각되는 쪽을 물음)과 "이
  // 결과가 지지하는 설명은?"(살아남은 쪽을 물음)은 정반대의 정답을 요구한다. 실제 사고: 질문이 "지지"를
  // 물었는데 게이트는 늘 "정답 = 기각 안 된 쪽"만 가정해 정답이 기각된 쪽 낱말과 안 겹치는지만 봤다 —
  // 우연히 안 걸렸을 뿐, 극성이 반대인 질문이었다면 실제로는 못 잡았을 사고다.
  const JUDGE_ASK_REJECT = /기각(하|되)는|맞지\s*않는|틀린|반박(되|하)는|설명하지\s*못하는|예측과\s*다른/;
  const JUDGE_ASK_SUPPORT = /지지(하|되)는|맞는|설명하는|옳은|살아남는/;
  const JUDGE_ASK_NEGATE = /아닌\s*것|아니다|않는\s*것/;   // "…것이 아닌 것은?"처럼 뒤에 부정이 붙으면 극성을 뒤집는다
  const judgeQuestionPolarity = q => {
    const t = plain(q || '');
    let base = JUDGE_ASK_REJECT.test(t) ? 'reject' : JUDGE_ASK_SUPPORT.test(t) ? 'support' : null;
    if (base && JUDGE_ASK_NEGATE.test(t)) base = base === 'reject' ? 'support' : 'reject';
    return base;   // null이면 극성 불명 — 기존처럼 보수적으로 다룬다
  };
  // 좌/우를 부르는 짧은 이름(예: "빛은 파동이다(파동설)"→"파동설")을 label 끝 괄호에서 뽑는다 —
  // explain·notes가 items 문장을 그대로 베끼기보다 이 짧은 이름으로 어느 쪽인지 말하는 경우가 많다.
  const judgeSideTerm = side => { const m = String(side?.label || '').match(/\(([^)]+)\)\s*$/); return (m ? m[1] : side?.label || '').trim(); };
  const JUDGE_SUPPORT_CUE = /들어맞|일치|지지|타당|맞습니다|맞다\b/;
  slides.forEach((s, i) => {
    if (s.type !== 'compare' || s.kind === 'contrast') return;
    const judge = slides[i + 1];
    if (!judge || judge.type !== 'quiz' || !Array.isArray(judge.choices) || !(judge.answer >= 1)) return;
    const n = i + 2;
    const evList = normEvidence(judge.evidence).filter(e => e.fact && e.refutes);
    if (!evList.length) return;   // refutes 없는 evidence는 E1-JUDGE-EVIDENCE가 이미 잡는다
    const itemTokens = side => new Set((s[side]?.items || []).flatMap(it => plain(it).match(KEY_TOK) || []));
    const leftItemKws = itemTokens('left'), rightItemKws = itemTokens('right');
    const overlapCount = (text, kws) => (String(text ?? '').match(KEY_TOK) || []).filter(k => kws.has(k)).length;
    // 저자가 이미 어느 쪽이 기각/지지되는지 명시적으로 말했으면(예: "...파동설의 예측과 맞지
    // 않습니다"·"...입자설은...들어맞습니다") 그 진술을 신뢰한다 — fact.text의 낱말 겹침만으로 반박
    // 대상을 추정하는 다음 휴리스틱은, 근거가 "살아남은 쪽의 예측과도 들어맞는 관찰"을 말할 때(정상적인
    // 증거 서술) 오히려 살아남은 쪽 items와 낱말이 더 겹치기 쉬워 오탐하기 때문이다(실제 사고 사례).
    const judgeText = plain(`${judge.question || ''} ${judge.explain || ''} ${judge.notes || ''} ${judge.caption || ''}`);
    const leftTerm = judgeSideTerm(s.left), rightTerm = judgeSideTerm(s.right);
    const namedWithCue = (term, cueRe) => Boolean(term) && judgeText.includes(term) && cueRe.test(judgeText);
    for (const e of evList) {
      const fact = facts.find(f => f.id === e.fact);
      if (!fact) continue;   // facts에 없는 evidence는 E1-JUDGE-EVIDENCE가 이미 잡는다
      const refutedTerm = e.refutes === 'left' ? leftTerm : rightTerm;
      const survivorTerm = e.refutes === 'left' ? rightTerm : leftTerm;
      const trustRefutes = namedWithCue(refutedTerm, DISCRIM_CUE) || namedWithCue(survivorTerm, JUDGE_SUPPORT_CUE);
      if (!trustRefutes) {
        const leftHits = overlapCount(fact.text, leftItemKws), rightHits = overlapCount(fact.text, rightItemKws);
        if (leftHits !== rightHits) {
          const factRefutedSide = leftHits > rightHits ? 'left' : 'right';
          if (factRefutedSide !== e.refutes) {
            warn('E1-JUDGE-ANSWER', `${n}번 판정의 evidence(fact ${e.fact})가 "${e.refutes}"를 기각한다고 적었지만, 낱말은 "${factRefutedSide}" 쪽 항목과 더 겹침 — refutes가 엉뚱한 쪽을 가리키는 것으로 보임(겹침이 적으면 오판일 수 있어 경고만 함)`);
            continue;
          }
        }
      }
      const choiceText = plain(judge.choices[judge.answer - 1] || '');
      const correctKws = new Set(choiceText.match(KEY_TOK) || []);
      const correctLeftHits = [...leftItemKws].filter(k => correctKws.has(k)).length;
      const correctRightHits = [...rightItemKws].filter(k => correctKws.has(k)).length;
      let correctSide = correctLeftHits !== correctRightHits ? (correctLeftHits > correctRightHits ? 'left' : 'right') : null;
      if (!correctSide) {
        // 선택지가 items 문장 대신 label(짧은 이름)만 쓰는 경우도 흔하다(이 실제 사고 사례처럼).
        const hitsLeft = leftTerm && choiceText.includes(leftTerm), hitsRight = rightTerm && choiceText.includes(rightTerm);
        if (hitsLeft !== hitsRight) correctSide = hitsLeft ? 'left' : 'right';
      }
      if (!correctSide) continue;   // 정답 선택지가 어느 쪽 주장인지 안 갈리면 단정하지 않는다
      const survivorSide = e.refutes === 'left' ? 'right' : 'left';
      const polarity = judgeQuestionPolarity(judge.question);
      // 극성 불명이면 기존 기본 가정(정답 = 기각 안 된 쪽)을 그대로 쓰되, 질문을 못 읽은 것이므로
      // FAIL이 아니라 지금까지처럼 WARN에 그친다.
      const expectedSide = polarity === 'reject' ? e.refutes : survivorSide;
      if (correctSide === expectedSide) continue;
      const msg = polarity
        ? `${n}번 quiz의 정답(선택지 ${judge.answer}: "${choiceText.slice(0, 30)}…")이 질문이 묻는 쪽(${polarity === 'reject' ? '기각되는' : '지지하는'} 설명)과 맞지 않음 — evidence상 ${polarity === 'reject' ? '기각된' : '기각되지 않은'} 쪽은 "${expectedSide}"인데 정답은 "${correctSide}" 쪽으로 보임`
        : `${n}번 quiz의 정답(선택지 ${judge.answer}: "${choiceText.slice(0, 30)}…")이 evidence가 기각한 "${e.refutes}" 쪽 주장과 같아 보임 — 근거와 정답이 어긋남(질문이 무엇을 묻는지 판단하지 못해 경고로만 남김)`;
      const hint = '질문이 "기각되는 쪽"을 묻는지 "지지하는(옳은) 쪽"을 묻는지 확인하고, 정답 선택지가 그 쪽 주장과 일치하는지 맞추세요';
      if (polarity) err('E1-JUDGE-ANSWER', msg, hint); else warn('E1-JUDGE-ANSWER', msg);
    }
  });

  // (b3b) E1-PRESPOILER: 판정(compare 다음 장)에 쓸 관찰이 그 compare보다 앞선 슬라이드(표지 제외)에
  // 이미 나와 있으면, 예측을 겨루기 전에 답을 보여준 것이다. hook의 열린 질문이나 "누가 무엇을
  // 실험했는지"만 말하는 역사 슬라이드는 그 관찰(수치·문장)을 그대로 말하지 않는 한 걸리지 않는다 —
  // statesObservation이 흔한 화제어 하나만 겹치는 정도는 넘긴다.
  slides.forEach((s, i) => {
    if (s.type !== 'compare' || s.kind === 'contrast') return;
    const judge = slides[i + 1];
    if (!judge) return;
    const judgeFacts = facts.filter(f => judgeFactIds(judge).has(f.id));
    if (!judgeFacts.length) return;
    outer: for (let j = 1; j < i; j++) {   // 1번(표지) 제외, compare 앞까지
      const text = plain(slideText(slides[j]));
      for (const f of judgeFacts) {
        if (statesObservation(text, f.text)) {
          err('E1-PRESPOILER', `${j + 1}번 슬라이드가 ${i + 1}번 compare보다 먼저 판정 근거(fact ${f.id})의 관찰을 보여줌`,
            '그 관찰은 compare 다음 판정 슬라이드에서 처음 보여주세요 — 그 전엔 풀리지 않은 질문이나 "누가 실험했는지"만 남겨 두세요');
          continue outer;
        }
      }
    }
  });

  // (b3c) 학생이 늘 보는 학습 목표(목표 슬라이드 기본값, 활동지·정답지 머리말)도 같은 스포일러 기준으로
  // 본다 — 교사가 준 목표 문구(예: "빛이 입자(광자)의 성질을 가진다고 설명할 수 있다")는 S7이 지도안
  // 반영 확인에 쓰는 L.objectives 그대로일 때가 많아 판정 결론을 미리 밝히기 쉽다. build.mjs와 같은
  // 우선순위로 "학생이 실제로 보는 문구"를 계산한다: goals 슬라이드는 그 슬라이드의 items(있으면),
  // 없으면 meta.objectivesStudent, 그것도 없으면 objectives. 활동지·정답지 머리말은 슬라이드 오버라이드가
  // 없으니 objectivesStudent(없으면 objectives)만 본다.
  // 두 가지 방식으로 "결론을 말했다"고 본다: (1) statesObservation — 판정 근거 fact의 수치·문장을
  // 그대로 되풀이함, (2) 라벨 겹침 — compare 좌/우 라벨의 낱말(2글자 이상) 2개 이상이 그대로 들어 있음
  // (예: right.label "빛이 입자(광자)라면" ↔ 목표 "빛이 입자(광자)의 성질을 가진다" — fact 문장과는
  // 안 겹쳐도 어느 쪽이 맞는지는 이미 선언한 것이다). 목표 문장은 fact를 그대로 인용하기보다 "결론"을
  // 자기 말로 쓰는 경우가 많아 (2)가 실제로 이 사고를 잡는 핵심 경로다.
  {
    const goalsSlide = slides.find(s => s.type === 'goals');
    const goalsIdx = goalsSlide ? slides.indexOf(goalsSlide) : -1;
    const goalsShown = (goalsSlide && goalsSlide.items) || M.objectivesStudent || objs;
    const wsShown = M.objectivesStudent || objs;
    const studentGoalSources = [
      { label: `${goalsIdx + 1}번(goals) 학습 목표`, beforeIdx: goalsIdx, text: plain(goalsShown.join(' ')) },
      { label: '활동지·정답지 머리말의 학습 목표', beforeIdx: -1, text: plain(wsShown.join(' ')) },   // 슬라이드 순서와 무관하게 학생이 늘 보는 문서
    ];
    const sideLabelTokens = side => new Set(plain(side?.label || '').match(KEY_TOK) || []);
    slides.forEach((s, i) => {
      if (s.type !== 'compare' || s.kind === 'contrast') return;
      const judge = slides[i + 1];
      if (!judge) return;
      const judgeFacts = facts.filter(f => judgeFactIds(judge).has(f.id));
      const leftKws = sideLabelTokens(s.left), rightKws = sideLabelTokens(s.right);
      for (const src of studentGoalSources) {
        if (src.beforeIdx >= 0 && src.beforeIdx >= i) continue;   // compare보다 뒤에 있는 goals면 "미리" 보여준 게 아니다
        const hitFact = judgeFacts.find(f => statesObservation(src.text, f.text));
        // 부분 문자열 포함(.includes)이 아니라 낱말 집합 일치로 본다 — "설명 A"의 "설명"이 목표 문장의
        // "설명할"(다른 낱말) 안에 우연히 부분 문자열로 들어 있어 오탐하는 것을 막는다.
        const srcKws = new Set(src.text.match(KEY_TOK) || []);
        const leftHits = [...leftKws].filter(k => srcKws.has(k)).length;
        const rightHits = [...rightKws].filter(k => srcKws.has(k)).length;
        const hitSide = leftHits >= 2 ? 'left' : rightHits >= 2 ? 'right' : null;
        if (hitFact)
          err('E1-PRESPOILER', `${src.label}이 ${i + 1}번 compare의 판정 근거(fact ${hitFact.id})가 내릴 결론을 미리 말함`,
            'meta.objectivesStudent로 중립 문구를 쓰세요(지도안의 objectives는 그대로 두어도 됩니다 — S7이 그 필드로 반영을 확인합니다)');
        else if (hitSide)
          err('E1-PRESPOILER', `${src.label}이 ${i + 1}번 compare의 ${hitSide === 'left' ? '왼쪽' : '오른쪽'} 설명("${s[hitSide].label}")과 같은 낱말로 결론을 미리 말함`,
            'meta.objectivesStudent로 중립 문구를 쓰세요(지도안의 objectives는 그대로 두어도 됩니다 — S7이 그 필드로 반영을 확인합니다)');
      }
    });
  }

  // (b4) contrast를 라이벌 가설의 도피처로 쓰지 못하게 한다 — compare.kind:"contrast"(둘 다 참인 대비)는
  // 위 (b)/(b2)/(b3) 판정 요구를 면제받는다. 그런데 좌우 라벨·항목에 "설명/예측/가설/생각/주장/…설/때문" 같은
  // 주장·추측 언어가 있으면, 사실은 서로 배타적인 rival 가설(둘 중 하나는 틀림)을 contrast로 위장해 판정을
  // 피해간 것이다 — 그런 경우는 FAIL한다.
  const CONTRAST_BELIEF = /설명|예측|가설|생각|주장|설|때문/;
  slides.forEach((s, i) => {
    if (s.type !== 'compare' || s.kind !== 'contrast') return;
    const sideText = side => plain(`${side?.label || ''} ${(side?.items || []).join(' ')}`);
    const hit = ['left', 'right'].filter(k => CONTRAST_BELIEF.test(sideText(s[k])));
    if (hit.length)
      err('E1-CONTRAST-MISUSE', `${i + 1}번 compare(kind:"contrast")의 ${hit.join(', ')}에 주장·추측 언어(설명/예측/가설/생각/주장/…설/때문)가 있음 — 대립 가설을 contrast로 감춘 것으로 보임`,
        '두 설명이 서로 배타적인 주장(가설)이면 kind를 빼거나 "rival"로 두고 다음 장에서 판정하세요. 둘 다 참인 사실을 대비할 때만 contrast를 쓰세요');
  });

  // (d) 오개념은 역사로, 있으면 FAIL(원작 8번 원칙) — 설계서에 misconceptions가 있거나 발표자 노트에
  // "오개념"이 언급되거나 compare(대립 설명)가 하나라도 있으면, "진짜 역사적 사실"(연도+인물/실험이 있고
  // 출처가 "수업 설계"가 아닌 facts)이 최소 하나 있어야 하고, 그 사실이 hook·compare·판정 슬라이드 중
  // 하나에서 실제로 인용돼야 한다. 지어낸 역사는 금지 — 못 찾았으면 지어내지 말고 그렇게 보고한다.
  let hasMisconceptions = slides.some(s => /오개념/.test(s.notes || ''));
  if (!hasMisconceptions && M.intake) {
    try {
      const formPath = path.resolve(ctx.dir, M.intake);
      if (fs.existsSync(formPath)) hasMisconceptions = parseIntake(fs.readFileSync(formPath, 'utf8')).misconceptions.length > 0;
    } catch { /* 파싱 실패는 S7이 이미 알린다 */ }
  }
  const hasCompare = slides.some(s => s.type === 'compare' && s.kind !== 'contrast');   // contrast는 판정이 아니라 대비이므로 그 자체로는 역사 서사를 요구하지 않는다
  if (hasMisconceptions || hasCompare) {
    const HIST_YEAR = /\d{4}년?|\d{1,3}\s*세기/;
    const HIST_WHO = /[A-Z][a-zA-Z]+|실험|박사|교수|발표|발견|분리|증명|주장|측정했/;
    const histFacts = facts.filter(f => HIST_YEAR.test(f.text || '') && HIST_WHO.test(f.text || '') && !/수업 설계/.test(f.source || ''));
    const compareIdx = slides.findIndex(s => s.type === 'compare' && s.kind !== 'contrast');
    const candidateSlides = [slides.find(s => s.type === 'hook'), compareIdx >= 0 ? slides[compareIdx] : null, compareIdx >= 0 ? slides[compareIdx + 1] : null].filter(Boolean);
    const cites = (slide, f) => {
      const evList = normEvidence(slide.evidence);
      if (evList.some(e => e.fact === f.id) || slide.fact === f.id) return true;
      return mentionsObservation(`${slideText(slide)} ${slide.notes || ''}`, f.text);
    };
    const citedFact = histFacts.find(f => candidateSlides.some(sl => cites(sl, f)));
    if (!histFacts.length)
      err('E1-HISTORY', '오개념이 있거나 대립 설명(compare)이 있는데 연도+인물/실험이 있는 진짜 역사적 사실(facts, 출처가 "수업 설계"가 아님)이 없음',
        '예: "파얀과 페르소즈는 1833년에 디아스타아제를 분리했다"(출처: 교과서·논문 등)를 facts에 추가하세요 — 지어내지 말고, 못 찾았으면 그렇게 보고하세요(pedagogy.md 10번)');
    else if (!citedFact)
      err('E1-HISTORY', `역사적 사실(${histFacts.map(f => f.id).join(', ')})은 있지만 hook/compare/판정 슬라이드 어디에서도 인용되지 않음`,
        '그 fact를 evidence나 fact로 연결하거나, 연도·인물 이름이 hook/compare/판정 슬라이드의 본문·notes에 보이게 적으세요');
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
  collectPlots(L).forEach((pl, idx) => {
    if (!(pl.xLabel || pl.axes?.x) || !(pl.yLabel || pl.axes?.y))
      err('E1-AXIS', `그래프(${idx + 1}번째, x:${JSON.stringify(pl.x || '기본')} y:${JSON.stringify(pl.y || '기본')})에 xLabel/yLabel이 없음 — 어떤 양의 그래프인지 알 수 없다`, 'plot에 xLabel/yLabel(예: "시간(초)", "거리(m)")을 추가하세요');
  });

  // (f1) 축 이름에 단위가 있어야 그 수치가 무엇인지 안다(경고만) — data(실측값)가 있는 그래프에만 적용.
  // "(V)"처럼 괄호 단위든, 괄호 없이 "V"·"kPa" 같은 낱말이 붙어 있든 둘 다 단위로 본다.
  const UNIT_WORD = new RegExp(`(?:^|[\\s(])(?:${UNIT_NAMES})(?:[\\s).]|$)`);
  const hasUnit = label => /\([^)]+\)/.test(label) || UNIT_WORD.test(label);
  collectPlots(L).forEach((pl, idx) => {
    if (!(Array.isArray(pl.data) && pl.data.length)) return;
    const xL = pl.xLabel || pl.axes?.x, yL = pl.yLabel || pl.axes?.y;
    if (xL && !hasUnit(xL)) warn('E1-AXIS', `그래프(${idx + 1}번째) xLabel "${xL}"에 단위가 안 보임`, '예: "전압 (V)"처럼 단위를 붙이세요');
    if (yL && !hasUnit(yL)) warn('E1-AXIS', `그래프(${idx + 1}번째) yLabel "${yL}"에 단위가 안 보임`, '예: "전류 (A)"처럼 단위를 붙이세요');
  });

  // (f2) 예측(lines/curves)과 측정(data)은 색이 달라야 서로 구분된다 — 같은 style이면 마름모(측정값)가
  // 선(예측) 위에 묻혀 안 보인다. "예측 vs 측정" 비교는 색 구분이 핵심이라 이 겹침은 증거로서 실패다.
  collectPlots(L).forEach((pl, idx) => {
    const seriesStyles = [...(pl.lines || []).map(l => l.style || 'accent'), ...(pl.curves || []).map(c => c.style || 'accent')];
    (pl.data || []).forEach(d => {
      const ds = d.style || 'ink';
      if (seriesStyles.includes(ds))
        err('E1-DATASTYLE', `그래프(${idx + 1}번째) data "${d.label || ''}"의 style("${ds}")이 같은 그래프의 예측선/곡선과 같음 — 측정값이 선에 묻혀 안 보인다`, 'data.style을 lines/curves와 다른 값으로 바꾸세요(예: 예측선이 기본값 accent면 data는 "ink")');
    });
  });

  // (g) 공식 앞뒤 증거가 "그래프뿐"이 아니라 "예측 vs 측정"이어야 한다 — 공식을 그린 그래프 하나만 있고
  // 실측과 비교하지 않으면 공식을 그림으로 옮긴 것일 뿐 증거가 아니다(pedagogy.md 10번, 원작 교사 자료 "공식 검증" 패턴).
  // diagram/steps/timeline 자신은 이미 근거 슬라이드이므로 제외한다((c)와 같은 이유).
  const verifyFigureFor = new Map();   // 수식 슬라이드 인덱스 → 그 검증(비교) 슬라이드 인덱스
  const VERDICT_CUE = /일치|차이|다르|같|어긋|근접|벗어|맞|틀/;
  slides.forEach((s, i) => {
    if (['diagram', 'steps', 'timeline'].includes(s.type) || !HAS_FORMULA_RE.test(slideText(s))) return;
    const n = i + 1;
    const lo = Math.max(0, i - 2), hi = Math.min(slides.length - 1, i + 2);
    let hit = -1;
    for (let j = lo; j <= hi && hit < 0; j++) {
      if (j === i) continue;
      const cand = slides[j];
      const ok = slideVisuals(cand).some(v => plotDataPointCount(v) >= 3 && plotDataFacts(v).every(fid => facts.some(f => f.id === fid)));
      if (ok && VERDICT_CUE.test(plain(`${cand.caption || ''} ${cand.notes || ''}`))) hit = j;
    }
    if (hit < 0) err('E1-VERIFY', `${n}번 수식 슬라이드 ±2장 안에 예측-측정 비교 검증 슬라이드가 없음(데이터 3점 이상·facts 연결, 캡션/노트에 일치·차이 판정 문장 필요)`,
      '근처 슬라이드의 plot에 data 시리즈(≥3점, fact 연결)를 넣고 caption·notes에 "일치/차이와 그 까닭"을 적으세요');
    else verifyFigureFor.set(i, hit);
  });

  // (h) 그림 기호 = 수식 기호 — 근거 그림(위 검증 슬라이드나 (c)의 인접 diagram/steps/timeline)에 쓰인 기호가
  // 수식과 다르면(오탈자·다른 표기) 그림이 다른 것을 가리키는 셈이다(design.md 육안 검수 2-2번의 자동화판).
  slides.forEach((s, i) => {
    const fSyms = formulaSymbols(slideText(s));
    if (!fSyms.size) return;
    const n = i + 1;
    const evidenceIdx = new Set();
    if (verifyFigureFor.has(i)) evidenceIdx.add(verifyFigureFor.get(i));
    [i - 1, i + 1].forEach(j => { if (['diagram', 'steps', 'timeline'].includes(slides[j]?.type)) evidenceIdx.add(j); });
    evidenceIdx.forEach(j => {
      const figSyms = figureSymbols(slideVisuals(slides[j]).map(visualText).join(' '));
      if (!figSyms.size) return;   // 그림에 기호 라벨이 아예 없으면(추상 그림) 건너뛴다
      const foreign = [...figSyms].filter(sym => !fSyms.has(sym));
      if (foreign.length) err('E1-SYMBOL', `${n}번 수식과 ${j + 1}번 그림의 기호가 다름: 그림에 ${foreign.join(', ')} — 수식에는 ${[...fSyms].join(', ')}만 있음`,
        '그림 라벨을 수식과 같은 문자로 고치세요(예: θᵢ ↔ θ_i)');
    });
  });

  // (i) 측정값은 측정값답게 흩어져야 한다 — data의 모든 점이 같은 plot의 예측선/곡선과 1% 이내로
  // 정확히 겹치면(또는 예측값이 0에 가까울 때 |Δ|<1e-9) 그 "측정값"은 사실 공식으로 계산해 베낀 것이다.
  // 실제 측정에는 항상 크고 작은 오차가 있다 — 원작 교사 자료가 공식 검증 뒤에 "한계"를 붙이는 것과 같은 정신이다.
  collectPlots(L).forEach((pl, idx) => {
    const predictors = [
      ...(pl.lines || []).map(l => ({ label: l.label, f: x => l.a * x + l.b })),
      ...(pl.curves || []).map(c => { try { return { label: c.label, f: compileCurve(c.fn) }; } catch { return null; } }).filter(Boolean),
    ];
    if (!predictors.length) return;
    (pl.data || []).forEach(d => {
      if (!d.points?.length) return;
      predictors.forEach(pr => {
        const allExact = d.points.every(([x, y]) => {
          const pred = pr.f(x);
          if (!Number.isFinite(pred)) return false;
          const diff = Math.abs(y - pred);
          return Math.abs(pred) < 1e-9 ? diff < 1e-9 : diff / Math.abs(pred) <= 0.01;
        });
        if (allExact)
          err('E1-DATAFIT', `그래프(${idx + 1}번째) data "${d.label || ''}"의 모든 점이 예측(${pr.label || '공식'})과 1% 이내로 정확히 일치함 — 공식으로 계산해 베낀 값으로 보임`,
            '실제 측정에는 오차가 있다 — 각 점에 현실적인 편차(±몇 %)를 주고, 필요하면 err(오차막대)도 넣으세요');
      });
    });
  });

  // (j) "예시" 자료는 예시라고 화면에도 밝힌다 — facts의 출처(source)에 "예시"가 있으면(실제 측정이 아니라
  // 수업 설계로 지어낸 값이면) 그래프 라벨도 "측정값(예시)"처럼 예시임을 알려야 학생이 진짜 실측으로 오해하지 않는다.
  collectPlots(L).forEach((pl, idx) => {
    (pl.data || []).forEach(d => {
      const f = facts.find(x => x.id === d.fact);
      if (f && /예시/.test(f.source || '') && !/예시/.test(d.label || ''))
        err('E1-EXAMPLE-LABEL', `그래프(${idx + 1}번째) data "${d.label || ''}"(fact ${d.fact})의 출처가 "${f.source}"인데 화면 라벨에는 "예시"가 없음`,
          'data.label을 "측정값(예시)"처럼 고쳐 예시 자료임을 학생에게도 밝히세요');
    });
  });

  // (k) 실험 순서(경고) — 판정에 쓴 그래프의 축(양)과 같은 것을 재는 activity가 판정 뒤에 나오면,
  // 결과를 먼저 보여주고 같은 실험을 재현시키는 순서가 된다. 학생은 먼저 측정하고 그 자료로 판정해야
  // 한다(원작 8번 원칙). 단, 판정이 "다른 반의 결과"(예시자료)라고 밝히고 뒤의 활동이 "심화"로 표시돼
  // 있으면 — 예시로 먼저 판정하고 학생 실험은 그 확장이라는 뜻이므로 — 넘어간다.
  const axisNoun = label => plain(String(label ?? '')).replace(/\([^)]*\)/g, '').replace(/[A-Za-z0-9₀-₉\s]/g, '').trim();
  slides.forEach((s, i) => {
    if (s.type !== 'compare') return;
    const judge = slides[i + 1];
    if (!judge) return;
    const plotsInJudge = slideVisuals(judge).filter(v => v && typeof v === 'object' && v.plot).map(v => v.plot);
    if (!plotsInJudge.length) return;
    const axisNouns = [...new Set(plotsInJudge.flatMap(pl => [axisNoun(pl.xLabel || pl.axes?.x), axisNoun(pl.yLabel || pl.axes?.y)]).filter(nn => nn.length >= 1))];
    if (!axisNouns.length) return;
    const judgeText = plain(`${slideText(judge)} ${judge.notes || ''}`);
    const isOtherClassExample = /다른 반/.test(judgeText);
    for (let j = i + 2; j < slides.length; j++) {
      const act = slides[j];
      if (act.type !== 'activity') continue;
      const actAll = plain(`${act.title || ''} ${(act.steps || []).join(' ')} ${act.notes || ''}`);
      const isExtension = /심화|추가 탐구|확장/.test(actAll);
      if (isOtherClassExample && isExtension) continue;
      const matched = axisNouns.filter(nn => actAll.includes(nn));
      if (matched.length)
        warn('E1-ORDER', `${j + 1}번 activity가 ${i + 2}번 판정 뒤에 나오는데 같은 양(${matched.join(', ')})을 측정함 — 결과를 먼저 보여주고 같은 실험을 재현시키는 순서`,
          '학생이 먼저 측정하고 그 자료로 판정하도록 순서를 바꾸거나, 판정을 "다른 반의 결과"로 명시하고 이 활동을 심화 활동으로 표시하세요');
    }
  });

  // (l) 판정이 수치 fact를 인용하면(예: 반 헬몬트의 169파운드·200파운드) 그 수치를 실제로 보여주는
  // plot/bars가 compare나 판정 슬라이드 어디에도 있어야 한다 — 문장으로만 "169파운드"라고 말하는 것은
  // 학생이 눈으로 비교·검증할 수 있는 자료가 아니다(블라인드 테스트 photosynthesis에서 실제로 이 실수가
  // 나왔다 — quiz.explain이 수치를 말하지만 bars가 없었다).
  slides.forEach((s, i) => {
    if (s.type !== 'compare' || s.kind === 'contrast') return;
    const judge = slides[i + 1];
    if (!judge) return;
    const ids = judgeFactIds(judge);
    const numericFacts = facts.filter(f => ids.has(f.id) && realNumbers(f.text).length > 0);
    if (!numericFacts.length) return;
    const hasChart = [s, judge].some(sl => slideVisuals(sl).some(v => v && typeof v === 'object' && (v.plot || v.bars)));
    if (!hasChart)
      err('E1-JUDGE-DATA', `${i + 2}번(${judge.type}) 판정이 수치 fact(${numericFacts.map(f => f.id).join(', ')})를 인용하는데 그 수치를 보여주는 plot/bars가 ${i + 1}번 compare나 판정 슬라이드 어디에도 없음`,
        '판정 슬라이드나 그 앞 compare에 {bars}나 {plot}으로 그 수치(예: 169파운드 vs 200파운드)를 실제로 보여주세요 — 문장만으로는 학생이 비교할 수 없습니다');
  });

  // (m) 저수준 {tikz}로 회로·장치를 손으로 그리면 안 된다 — {circuit}/{refraction}/{geometry} 헬퍼가
  // 이미 좌표·극성·개수를 계산해 준다. src나 라벨에 전지·전류계 같은 장치·회로 낱말이 있으면 저수준
  // {tikz}를 손으로 쓴 것으로 본다(블라인드 테스트 photoelectric에서 광전관 회로를 이렇게 손으로 그렸다).
  const APPARATUS_TIKZ = /전지|전류계|전압계|전극|음극|양극|광전관|저항(?!\s*값)|회로|도선|battery|ammeter|voltmeter|resistor|switch/i;
  const scanTikz = (label, v) => {
    if (!v || typeof v !== 'object' || !v.tikz) return;
    const text = `${v.tikz.src || ''} ${(v.tikz.labels || []).map(l => l.text).join(' ')}`;
    const hit = text.match(APPARATUS_TIKZ);
    if (hit) err('E1-RAWTIKZ-APPARATUS', `${label}의 저수준 {tikz}가 장치·회로 요소("${hit[0]}" 등)를 직접 그림`,
      '{circuit}(전지·전류계·전압계·저항·스위치, 광전관 소자 포함) 헬퍼나 {refraction}/{geometry}로 바꾸세요 — 손으로 좌표를 계산한 회로는 오류·불일치가 나기 쉽습니다');
  };
  slides.forEach((s, i) => slideVisuals(s).forEach(v => scanTikz(`${i + 1}번(${s.type})`, v)));
  items.forEach((it, i) => {
    const tag = `활동지 ${i + 1}번째(${it.type})`;
    slideVisuals(it).forEach(v => scanTikz(tag, v));
    if (it.type === 'draw') { scanTikz(tag, it.base); scanTikz(tag, it.answer); }
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
  const prevStates = stepChainPrevStates(L);

  for (const req of requests) {
    const txtFile = path.join(ctx.dir, 'images', `${req.id}.prompt.txt`);
    let text = null;
    if (typeof req.prompt === 'string' && req.prompt.trim()) text = normalizePromptText(req.prompt);
    else if (fs.existsSync(txtFile)) text = normalizePromptText(fs.readFileSync(txtFile, 'utf8'));
    if (!text) { err('I1-NOPROMPT', `이미지 "${req.id}"에 프롬프트가 없음(images/${req.id}.brief.md 작성 필요)`, '먼저 node scripts/images.mjs <lesson.json> --compile-only를 실행하세요'); continue; }

    const finalText = ensureClassroomClause(text, req, L.images, prevStates.get(req.id));
    const check = await runCheckPrompt(finalText);
    if (!check.ok) { err('I1-PROMPT', `이미지 "${req.id}" 프롬프트 검증 실패: ${check.errors.map(e => e.msg).join('; ')}`, check.errors[0]?.hint); continue; }

    const entry = manifest.images?.[req.id];
    if (!entry) { err('I1-MISSING', `이미지 "${req.id}"가 manifest에 없음`, '먼저 node scripts/images.mjs <lesson.json>을 실행하세요'); continue; }
    // 교과 강조색 시절 팔레트 힌트로 만든 이미지는(나머지 프롬프트가 같고 캐시 해시가 그 옛 프롬프트와 정확히
    // 맞으면) 낡은 것으로 보지 않는다 — 색 힌트만 바뀐 것이라 다시 만들 필요가 없다(images.mjs가 다음 실행 때
    // promptHash를 새 프롬프트로 옮긴다).
    if (entry.promptHash !== sha256(finalText)) {
      if (entry.promptHash === sha256(text) && samePromptExceptPalette(text, finalText)) warn('I1-PALETTE', `이미지 "${req.id}"는 예전 팔레트 힌트로 만든 것(나머지 프롬프트는 같음) — 그대로 쓴다`, `새 팔레트로 다시 만들려면 node scripts/images.mjs <lesson.json> --only ${req.id}`);
      else err('I1-STALE', `이미지 "${req.id}" 캐시가 최신 프롬프트와 다름`, '먼저 node scripts/images.mjs <lesson.json>을 실행하세요');
    }
    const cachedRoute = entry.route || 'subscription';
    if (cachedRoute !== expectRoute) err('I1-ROUTE', `이미지 "${req.id}" 캐시 경로(${cachedRoute})가 현재 설정(${expectRoute})과 다름`, '먼저 node scripts/images.mjs <lesson.json>을 실행하세요');
    else if (expectRoute === 'api' && entry.model !== forcedModel) err('I1-MODEL', `이미지 "${req.id}" 캐시 모델(${entry.model})이 images.model(${forcedModel})과 다름`);
    const filePath = entry.file && path.resolve(ctx.dir, entry.file);
    const webPath = entry.web && path.resolve(ctx.dir, entry.web);
    if (!filePath || !fs.existsSync(filePath)) err('I1-FILE', `이미지 "${req.id}" 원본 파일 없음: ${entry.file || '(manifest에 file 없음)'}`);
    if (!webPath || !fs.existsSync(webPath)) err('I1-WEB', `이미지 "${req.id}" 축소본 파일 없음: ${entry.web || '(manifest에 web 없음)'}`);
    if (Math.max(entry.width || 0, entry.height || 0) < 1024) err('I1-SIZE', `이미지 "${req.id}" 긴 변 ${Math.max(entry.width || 0, entry.height || 0)}px < 1024px`);
  }

  // manifest에는 있지만 지금 lesson.json 어디에도 요청이 없는 이미지(경고) — 슬라이드를 지우거나 id를
  // 바꾼 뒤 예전 생성 이미지가 그대로 남는 경우를 알린다(용량 낭비, 안 쓰는 이미지가 섞였는지 확인용).
  const usedIds = new Set(requests.map(r => r.id));
  for (const id of Object.keys(manifest.images || {})) if (!usedIds.has(id)) warn('I1-UNUSED', `images/manifest.json의 "${id}"가 lesson.json 어디에서도 요청되지 않음`, '슬라이드를 지웠다면 images/에서도 지우고, id를 바꿨다면 lesson.json과 맞추세요');

  // 서로 다른 id인데 이미지 내용이 완전히 같은 경우(sha256 일치) — codex의 내장 이미지 도구가 동시
  // 실행(--concurrency ≥2) 중인 다른 요청의 파일을 잘못 집어오면 두 이미지가 그대로 복제된다(실제 사고:
  // blind5-photoelectric의 pe-cover/pe-concept이 sha256까지 완전히 같은 파일로 나옴 — images.mjs 쪽에
  // 사후 가드를 추가했지만, 그 가드 이전에 만든 manifest나 수동으로 섞인 경우까지 여기서 다시 잡는다).
  // contentHash가 없는 옛 manifest 항목은 파일에서 직접 계산해 대조한다(게이트는 읽기 전용 — manifest에
  // 다시 쓰지 않는다).
  const hashOfEntry = id => {
    const entry = manifest.images?.[id];
    if (!entry) return null;
    if (entry.contentHash) return entry.contentHash;
    const p = entry.file && path.resolve(ctx.dir, entry.file);
    if (!p || !fs.existsSync(p)) return null;
    try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
  };
  const byContentHash = new Map();
  for (const req of requests) {
    const h = hashOfEntry(req.id);
    if (!h) continue;
    if (!byContentHash.has(h)) byContentHash.set(h, []);
    byContentHash.get(h).push(req.id);
  }
  for (const ids of byContentHash.values())
    if (ids.length > 1)
      err('I1-DUPHASH', `이미지 ${ids.map(id => `"${id}"`).join(', ')}가 서로 완전히 같은 파일(sha256 일치)입니다 — 동시 생성 중 다른 요청의 파일을 잘못 가져왔을 수 있습니다`,
        `re-run images.mjs --only ${ids.slice(1).join(',')} --force로 다시 만드세요(동시성을 낮추면 재발 확률이 줄어듭니다)`);
});

// ── V1 시각 정책 ─────────────────────────────────────────
// 정확한 값·라벨이 필요 없는 삽화는 전부 AI 이미지({image}), 정확한 도형은 도해 엔진({tikz}/{refraction}/
// {circuit}/{particles}/{geometry}/{vectors}), 그래프는 선언형({plot}/{bars}) — 손으로 쓴 <svg> 문자열은 더 이상
// 슬라이드·활동지 삽화로 쓰지 않는다(design.md "SVG 삽화 작성법"은 레거시로 표시됨). 템플릿 자신이 그리는
// 장식 svg(예: exit 슬라이드의 곡선, chapter 번호 장식)는 lesson.json에 없어 애초에 이 검사에 걸리지 않는다
// — 그것이 "작은 순수 장식 요소는 예외"의 실체다(이 게이트는 lesson.json만 읽는다).
const VISUAL_FORM_KEYS = ['image', 'plot', 'bars', 'tikz', 'refraction', 'circuit', 'particles', 'geometry', 'vectors'];
const isRawSvgString = v => typeof v === 'string' && v.trim().startsWith('<svg');
const visualFormKey = v => (v && typeof v === 'object') ? VISUAL_FORM_KEYS.find(k => v[k] !== undefined) : null;
// 형태는 있는데 내용이 빈 자리표시자인 경우(예: {image:{}}에 id/brief가 없음, 또는 인식되는 키가 하나도
// 없는 빈 객체) — I1이 미리 잡아내는 "프롬프트 없음"보다 앞선, lesson.json 단계의 1차 방어선이다.
const isEmptyPlaceholder = v => {
  if (!v || typeof v !== 'object') return false;
  const key = visualFormKey(v);
  if (!key) return Object.keys(v).length === 0;
  if (key === 'image') return !v.image || !v.image.id || !String(v.image.brief || '').trim();
  return false;
};
// figure 문항의 visual(예전 이름 svg/image 별칭 포함) — build.mjs의 별칭 해석과 같은 규칙(scripts/build.mjs).
const figureVisual = it => it.visual !== undefined ? it.visual : it.image ? { image: it.image } : it.svg;
// 판정 슬라이드(evidence 프로파일의 rival compare 바로 다음 장) 캡션에서 "수치 결과" 단위를 잡는다 —
// V1-JUDGEIMG의 취지(판정은 그림이 아니라 데이터로)를 diagram 전반에 일반화한 V1-NUMIMG가 쓴다.
const NUMIMG_UNIT = 'g|kg|파운드|분|℃|°C|A|V|kPa';
const NUMIMG_RE = new RegExp(`\\d+(?:[.,]\\d+)*\\s*(?:${NUMIMG_UNIT})(?![가-힣A-Za-z])`);
// 구조가 채점·이해에 들어가는 장치(회로·계기·광학 장치)는 사진만으로는 연결·배선·기하를 보장하지 못한다
// (V1-APPARATUS) — brief에 이 낱말이 있으면 같은 슬라이드나 인접 슬라이드에 정밀 도해가 있어야 한다.
// 낱말은 구체적인 복합어로만 잡는다 — "광학"처럼 짧은 낱말 하나면 "광학현미경"(그냥 사진이면 되는 장치)까지
// 걸린다(실제 오탐: 블라인드 테스트에서 광학현미경 사진이 V1-APPARATUS로 잘못 잡힘).
const APPARATUS_KEYWORDS = ['회로', '배선', '전류계', '전압계', '광전관', '검전기', '분광기', '광학 장치', '광학장치', '프리즘 배치', '렌즈 광선'];
// 이 낱말이 brief에 있으면 위 키워드와 겹쳐도(예: "광학현미경") 장치가 아니라 그냥 사진이면 되는
// 관찰 도구로 보고 통과시킨다.
const APPARATUS_WHITELIST = ['현미경', '돋보기', '망원경'];
const DIAGRAM_FORM_KEYS = VISUAL_FORM_KEYS.filter(k => k !== 'image' && k !== 'plot' && k !== 'bars');
const hasDiagramForm = s => slideVisuals(s).some(v => DIAGRAM_FORM_KEYS.includes(visualFormKey(v)));
// 캡션에 "도해"라는 낱말이 있으면 "정밀 연결·구조는 다른 슬라이드의 도해를 보라"는 표시로 인정한다
// (images.md가 권하는 문구: "장면 사진 — 연결은 도해 참고").
const CONCEPT_PHOTO_MARK = /도해/;
await gate('V1', '시각 정책', (err, warn) => {
  const checkForm = (label, v) => {
    if (v === undefined || v === null || v === '') return;
    if (isRawSvgString(v)) {
      err('V1-RAWSVG', `${label}이 손으로 그린 <svg> 문자열 — 더 이상 허용되지 않음`,
        '{image:{id,brief,role,ratio,style}}(AI 이미지)로 바꾸거나, 정확한 값·위치가 채점·이해에 들어가는 그림이면 {plot}/{bars} 또는 {tikz}/{refraction}/{circuit}/{particles}/{geometry}/{vectors}로 바꾸세요');
      return;
    }
    if (typeof v === 'object' && !Array.isArray(v) && !visualFormKey(v))
      err('V1-RAWSVG', `${label}이 알 수 없는 형태 — 허용: image·plot·bars·tikz·refraction·circuit·particles·geometry·vectors`, 'images.md·design.md를 참고하세요');
  };
  slides.forEach((s, i) => {
    const n = `${i + 1}번(${s.type})`;
    for (const v of slideVisuals(s)) { checkForm(`${n}의 visual`, v); if (isEmptyPlaceholder(v)) err('V1-IMAGEMISSING', `${n}의 visual이 빈 자리표시자(id/brief 없음)`, '{image:{id,brief,role,ratio,style}}를 채우세요'); }
    if (s.type === 'steps' && Array.isArray(s.steps) && s.steps.length && !s.steps.some(p => p && p.visual))
      err('V1-IMAGEMISSING', `${n} 어느 단계에도 visual이 없음`, `각 단계에 그 단계의 실제 도구·손 동작을 보여주는 {image:{...,role:"step"}}을 넣으세요(steps 칸 비율은 design.md 참고)`);
    // evidence 프로파일의 rival compare(대립 설명 판정 전) 좌우는 AI 이미지 금지 — 개수·크기를 보장 못해
    // 판정 전에 답을 암시할 수 있다(둘 다 참인 대비 kind:"contrast"는 이미지 사용 가능, pedagogy.md §10).
    if (M.profile === 'evidence' && s.type === 'compare' && s.kind !== 'contrast') {
      for (const [sideName, side] of [['left', s.left], ['right', s.right]]) {
        if (side?.visual && typeof side.visual === 'object' && side.visual.image)
          err('V1-COMPAREIMG', `${n}의 ${sideName}이 AI 이미지 사용 — rival compare는 개수·크기를 보장 못해 판정 전에 답을 암시할 수 있음`, '{particles} 등 도해 엔진이나 {plot}/{bars}로 바꾸세요');
      }
    }
  });
  items.forEach((it, i) => {
    if (it.type === 'figure') checkForm(`활동지 ${i + 1}번째(figure)의 visual`, figureVisual(it));
    if (it.type === 'draw') { checkForm(`활동지 ${i + 1}번째(draw)의 base`, it.base); checkForm(`활동지 ${i + 1}번째(draw)의 answer`, it.answer); }
  });

  // 판정 슬라이드(rival compare 바로 다음 장)의 주 시각 자료는 AI 이미지가 아니라 데이터여야 한다 —
  // 이미지는 판정에 쓰는 양(예: 반응 전후 흙의 질량)을 실제로 보여주지 못한다(블라인드 테스트
  // photosynthesis 5번 슬라이드에서 저울 사진을 판정 근거로 썼다가 도메인 검토에서 틀림 판정을 받음).
  // 대안은 시각 자료 없이 evidence만 인용하는 quiz 판정 — 그건 그대로 허용한다.
  if (M.profile === 'evidence') {
    slides.forEach((s, i) => {
      if (s.type !== 'compare' || s.kind === 'contrast') return;
      const judge = slides[i + 1];
      if (!judge) return;   // 다음 장이 아예 없음은 E1-JUDGE가 잡는다
      const jn = i + 2;
      const judgeHasImage = slideVisuals(judge).some(v => v && typeof v === 'object' && v.image);
      if (judgeHasImage)
        err('V1-JUDGEIMG', `${jn}번(${judge.type}) 판정 슬라이드의 시각 자료가 AI 이미지 — 판정에 쓰는 양(질량 등 관찰값)을 보여주지 못함`,
          '{plot}/{bars} 또는 도해 엔진({particles} 등)으로 실제 관찰 값·관계를 보여주세요. 시각 자료 없이 evidence만 인용하는 quiz 판정도 가능합니다');
    });
  }

  // 일반(프로파일 무관): diagram 슬라이드의 캡션이 단위 붙은 수치 결과를 말하는데 시각 자료가 AI
  // 이미지면 경고 — 이미지는 그 수치를 화면에 정확히 보장하지 못한다(경고일 뿐이라 FAIL은 아니다).
  slides.forEach((s, i) => {
    if (s.type !== 'diagram' || !s.visual || typeof s.visual !== 'object' || !s.visual.image) return;
    const m = plain(s.caption || '').match(NUMIMG_RE);
    if (m) warn('V1-NUMIMG', `${i + 1}번(diagram) 캡션에 수치 결과(${m[0]})가 있는데 시각 자료가 AI 이미지 — plot/bars나 도해 엔진으로 실제 값을 보여주는 편이 안전합니다`);
  });

  // 구조가 중요한 장치(회로·계기·광전관·검전기·분광기·광학 장치 등)를 담은 사진은 배선·연결·기하를
  // 보장하지 못한다 — 같은 슬라이드나 인접 슬라이드에 정밀 도해가 있거나, 캡션이 "도해 참고"로 표시해야
  // 한다. evidence 수업은 정확성 기준이 더 높으므로 FAIL, 그 외에는 WARN(V1-APPARATUS).
  slides.forEach((s, i) => {
    const apparatusImgs = slideVisuals(s).filter(v => {
      if (!(v && typeof v === 'object' && v.image)) return false;
      const brief = String(v.image.brief || '');
      if (APPARATUS_WHITELIST.some(w => brief.includes(w))) return false;
      return APPARATUS_KEYWORDS.some(k => brief.includes(k));
    });
    if (!apparatusImgs.length || hasDiagramForm(s)) return;
    const captionMarked = CONCEPT_PHOTO_MARK.test(plain(s.caption || ''));
    const neighborHasDiagram = [slides[i - 1], slides[i + 1]].some(nb => nb && hasDiagramForm(nb));
    if (captionMarked && neighborHasDiagram) return;
    const msg = `${i + 1}번(${s.type})의 이미지가 구조가 중요한 장치(${APPARATUS_KEYWORDS.join('·')} 등)를 다루는데 정밀 도해가 같은 슬라이드에도 인접 슬라이드에도 없음`;
    const hint = '같은 슬라이드에 {tikz}/{circuit}/{refraction}/{particles}/{geometry}/{vectors} 등 도해를 함께 넣거나, 캡션에 "장면 사진 — 연결은 도해 참고"처럼 "도해"를 넣고 인접 슬라이드에 정밀 도해를 두세요';
    if (M.profile === 'evidence') err('V1-APPARATUS', msg, hint); else warn('V1-APPARATUS', msg, hint);
  });

  // V1-APPARATUS-INSTRUMENT: 절차 본문(steps/activity/diagram)이 계기를 읽으라고 요구하면(전압 기록·
  // 전압계, 전류계 눈금, 가변저항·전원 조절, 역전압) 이 레슨의 {circuit} 도해 중 적어도 하나는 그
  // 계기를 실제로 갖고 있어야 한다 — 사진·서술만으로는 회로에 그 계기가 실제로 있는지 보장 못한다
  // (블라인드5 photoelectric 사고: "정지 전압을 기록"·"역전압을 높입니다"라고 시켰는데 레슨에 있는
  // 유일한 회로는 고정 전지+검류계뿐, 전압계도 역전압(reverse)도 없었다). 표 형태라 행을 추가할 수
  // 있다. evidence 프로파일은 FAIL, 그 외에는 경고.
  const circuitElements = v => v && typeof v === 'object' && v.circuit
    ? [...(v.circuit.elements || []), ...(v.circuit.branches || []).flat()] : [];
  const allCircuitEls = slides.flatMap(s => slideVisuals(s).flatMap(circuitElements));
  const INSTRUMENT_ROWS = [
    // "전압" 뒤에 곧장 "을"이 안 붙고 "전압(정지 전압)을 기록"처럼 괄호 설명이 끼는 경우가 실제로
    // 있어(블라인드5 photoelectric), "전압"과 "기록/측정" 사이에 최대 20자까지 허용한다.
    { code: 'VOLTMETER', trigger: /전압.{0,20}(기록|측정)|전압계/, has: els => els.some(el => el.type === 'voltmeter'),
      hint: '전압계(voltmeter) 소자가 있는 {circuit}을 이 레슨에 두세요' },
    { code: 'AMMETER', trigger: /전류계.{0,10}눈금/, has: els => els.some(el => el.type === 'ammeter'),
      hint: '전류계(ammeter) 소자가 있는 {circuit}을 이 레슨에 두세요(검류계galvanometer는 다른 소자입니다)' },
    { code: 'VARIABLE', trigger: /가변\s*저항|전원\s*을?\s*조절/, has: els => els.some(el => el.type === 'rheostat' || /가변/.test(el.label || '')),
      hint: '가변저항(rheostat) 소자나 라벨에 "가변"이 들어간 전원을 {circuit}에 넣으세요' },
    { code: 'REVERSE', trigger: /역전압/, has: els => els.some(el => el.reverse === true),
      hint: '정지 전압을 걸 소자(예: photocell)에 reverse:true를 주어 역전압 회로임을 도해에 실제로 표시하세요(또는 절차를 광전류 관찰까지로 줄이세요)' },
  ];
  slides.forEach((s, i) => {
    if (!['steps', 'activity', 'diagram'].includes(s.type)) return;
    const text = `${plain(slideText(s))} ${plain(s.notes || '')}`;
    for (const row of INSTRUMENT_ROWS) {
      if (!row.trigger.test(text) || row.has(allCircuitEls)) continue;
      const msg = `${i + 1}번(${s.type})의 절차가 계기를 요구하는데(${row.code}) 이 레슨의 {circuit} 도해 어디에도 그 소자가 없음`;
      if (M.profile === 'evidence') err('V1-APPARATUS-INSTRUMENT', msg, row.hint); else warn('V1-APPARATUS-INSTRUMENT', msg, row.hint);
    }
  });

  // V1-JUDGEIMG 확장: compare 바로 다음 장(판정)뿐 아니라, 캡션이 어떤 rival compare의 판정 근거(관찰)를
  // 그대로 말하는 슬라이드는 어디에 있든(앞이든 뒤든) AI 이미지를 주 시각 자료로 쓰면 안 된다 — 그
  // 관찰을 "보여주는" 것은 이미지가 아니라 데이터·도해여야 한다(E1-PRESPOILER와 같은 판정 기준을 쓴다).
  if (M.profile === 'evidence') {
    const allJudgeFacts = [];
    slides.forEach((s, i) => {
      if (s.type !== 'compare' || s.kind === 'contrast') return;
      const judge = slides[i + 1];
      if (!judge) return;
      const ids = judgeFactIds(judge);
      facts.filter(f => ids.has(f.id)).forEach(f => allJudgeFacts.push(f));
    });
    slides.forEach((s, i) => {
      if (s.type === 'compare') return;   // compare+1(판정)은 위에서 이미 확인했다
      const img = slideVisuals(s).find(v => v && typeof v === 'object' && v.image);
      if (!img || !s.caption) return;
      const hit = allJudgeFacts.find(f => statesObservation(s.caption, f.text));
      if (hit)
        err('V1-JUDGEIMG', `${i + 1}번(${s.type}) 캡션이 판정 근거(fact ${hit.id})의 관찰을 말하는데 시각 자료가 AI 이미지 — 그 관찰을 실제로 보여주지 못함`,
          '{plot}/{bars}나 도해 엔진({particles} 등)으로 그 관찰(수치·관계)을 실제로 보여주세요');
    });
  }

  // concept·activity 슬라이드의 이미지가 그 슬라이드의 본문(개념 points·활동 steps)과 낱말을 하나도
  // 안 나누면 분위기 사진일 뿐이다 — AI 이미지는 장면·기구·현상을 보여줄 때 쓰고, 이 유형들은 그
  // 슬라이드가 실제로 다루는 대상·활동·낱말을 그려야 한다(pedagogy.md §10). evidence 프로파일은
  // FAIL(정확성 기준이 높다), 그 외는 경고. cover는 원래 분위기 표지 이미지라 뺀다. exit·summary는
  // 낱말 겹침 대신 역할(role) 기준으로 따로 본다(아래) — 우연히 낱말이 겹쳐도 판정 근거 사진을 설명
  // 없이 넣는 것은 못 막기 때문이다.
  // 낱말 끝의 조사(이/가/을/를/은/는/의/에/로/으로/와/과/도)를 떼고 비교한다 — "광합성이"(본문)와
  // "광합성"(brief)처럼 조사만 다르게 붙어 겹침을 놓치는 것을 막는다. 조사를 떼고 1글자만 남으면
  // (조사 자체를 낱말로 오인) 원래 낱말을 그대로 쓴다.
  const CONCEPTMOOD_PARTICLE = /(이|가|을|를|은|는|의|에|로|으로|와|과|도)$/;
  const normTok = t => { const s = t.replace(CONCEPTMOOD_PARTICLE, ''); return s.length >= 2 ? s : t; };
  const tokensOf = text => (plain(text).match(KEY_TOK) || []).map(normTok);
  const CONCEPTMOOD_BODY = {
    concept: s => (s.points || []).flatMap(p => [...tokensOf(p.h || ''), ...tokensOf(p.t || '')]),
    activity: s => [...tokensOf(s.title || ''), ...(s.steps || []).flatMap(st => tokensOf(typeof st === 'string' ? st : `${st.h || ''} ${st.t || ''}`))],
  };
  slides.forEach((s, i) => {
    const bodyFn = CONCEPTMOOD_BODY[s.type];
    if (!bodyFn || !s.visual || typeof s.visual !== 'object' || !s.visual.image) return;
    const briefKws = new Set(tokensOf(s.visual.image.brief || ''));
    const bodyKws = bodyFn(s);
    if (briefKws.size && bodyKws.length && !bodyKws.some(k => briefKws.has(k))) {
      const msg = `${i + 1}번 ${s.type}의 이미지 brief가 이 슬라이드의 본문(핵심어)과 낱말을 하나도 공유하지 않음 — 분위기 사진으로 보임`;
      const hint = 'brief를 이 슬라이드가 실제로 다루는 대상·활동·핵심 낱말을 구체적으로 담도록 고치세요';
      if (M.profile === 'evidence') err('V1-CONCEPTMOOD', msg, hint); else warn('V1-CONCEPTMOOD', msg, hint);
    }
  });

  // exit·summary는 "정리" 성격이라 이미지가 없는 편이 기본값이다(핵심은 이미 다뤘으므로 새 그림이
  // 필요 없다) — 그런데 이미지를 넣는다면 분위기 사진이 아니라 근거(evidence)나 실생활 적용
  // (application) 역할이어야 하고, 그 역할을 caption·image.hint·notes 중 하나가 "무엇을 보여주는지 +
  // 수업과 어떻게 연결되는지"로 설명해야 한다(낱말 겹침만으로는 우연히 통과할 수 있어 역할 필드로
  // 바꿨다). evidence 프로파일은 FAIL, 그 외는 경고.
  const EXPLAIN_HINT = 'image.purpose를 "evidence"나 "application"으로 지정하고, caption·image.hint·notes 중 하나에 이 이미지가 무엇을 보여주고 수업과 어떻게 연결되는지 한 문장 이상 쓰세요(exit·summary는 이미지 없음이 기본값입니다)';
  slides.forEach((s, i) => {
    if (!['exit', 'summary'].includes(s.type) || !s.visual || typeof s.visual !== 'object' || !s.visual.image) return;
    const img = s.visual.image;
    const purposeOk = img.purpose === 'evidence' || img.purpose === 'application';
    const explainText = plain(`${s.caption || ''} ${img.hint || ''} ${s.notes || ''}`).trim();
    const hasExplain = explainText.length >= 8;
    if (!purposeOk || !hasExplain) {
      const why = !purposeOk ? `image.purpose가 "evidence"·"application"이 아님(${img.purpose ?? '없음'})` : '이미지가 무엇을 보여주고 수업과 어떻게 연결되는지 caption·image.hint·notes 어디에도 없음';
      const msg = `${i + 1}번 ${s.type}의 이미지가 역할 기준 미달 — ${why}`;
      if (M.profile === 'evidence') err('V1-CONCEPTMOOD', msg, EXPLAIN_HINT); else warn('V1-CONCEPTMOOD', msg, EXPLAIN_HINT);
    }
  });
});

// ── R1 도메인 검토 (references/review-schema.md) ──
// 저자(빌드 담당)는 게이트가 안 보는 문서 규칙(SKILL.md 7.2의 검토 표)은 건너뛰기 쉽다 — 도메인 검토가
// 아예 없었던 두 블라인드 테스트가 실제로 관찰된 실패 패턴이다("게이트가 강제하는 것만 따라간다").
// 그래서 검토가 "일어났음"을 <lesson>/review.json 파일로 강제한다 — 내용의 정오까지 게이트가 판정할
// 수는 없지만(그건 별도 검토 서브에이전트의 몫), 누락·형식 오류·오래된 검토(빌드 후 안 갱신)·"틀림"
// 판정 방치는 잡는다. "애매"는 막지는 않되 WARN으로 남긴다.
await gate('R1', '도메인 검토', (err, warn) => {
  const reviewPath = path.join(ctx.dir, 'review.json');
  if (!fs.existsSync(reviewPath)) {
    err('R1-MISSING', 'review.json이 없음 — 도메인 검토(SKILL.md 7.2)가 기록되지 않음',
      'R1-REVIEW: 7단계 도메인 검토를 별도 서브에이전트에게 맡겨 review.json을 작성하세요 (references/review-schema.md)');
    return;
  }
  let review;
  try { review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')); }
  catch (e) { err('R1-PARSE', `review.json 파싱 실패: ${e.message}`); return; }

  // checklist — SKILL.md 7.2의 16개 항목(①~⑯, 키는 "1".."16") 전부 있어야 한다
  const checklist = review.checklist || {};
  const missingKeys = Array.from({ length: 16 }, (_, k) => String(k + 1)).filter(k => !(k in checklist));
  if (missingKeys.length)
    err('R1-CHECKLIST', `review.json checklist에 키 ${missingKeys.join(', ')}가 없음`, 'references/review-schema.md의 16개 키를 모두 채우세요');
  for (const [k, v] of Object.entries(checklist)) {
    if (v === '틀림') err('R1-CHECKLIST-FAIL', `review.json checklist[${k}]가 "틀림"으로 남아 있음 — 반영 후 재검토해야 함`, '지적된 문제를 lesson.json에 반영하고 review.json을 다시 작성하세요');
    else if (v === 'issue') warn('R1-CHECKLIST-ISSUE', `review.json checklist[${k}]가 "issue"`);
  }

  // slides[] — 모든 슬라이드 번호에 행이 있어야 하고, 시각 자료가 있는 슬라이드는 figure가 비면 안 된다
  const reviewSlides = new Map((review.slides || []).map(r => [r.n, r]));
  slides.forEach((s, i) => {
    const n = i + 1;
    const row = reviewSlides.get(n);
    if (!row) { err('R1-SLIDE-MISSING', `review.json에 ${n}번 슬라이드 행이 없음`); return; }
    if (slideVisuals(s).length && !String(row.figure || '').trim())
      err('R1-FIGURE-EMPTY', `review.json ${n}번 슬라이드가 시각 자료가 있는데 figure가 비어 있음`, '그 그림·그래프가 실제로 무엇을 보여주는지 figure에 적으세요');
    if (row.verdict === '틀림') err('R1-VERDICT', `review.json ${n}번 슬라이드 verdict가 "틀림"`, '지적된 문제를 반영하고 재검토하세요');
    else if (row.verdict === '애매') warn('R1-VERDICT-AMBIGUOUS', `review.json ${n}번 슬라이드 verdict가 "애매"`);
  });

  // images[] — lesson.json이 참조하는 모든 이미지 id에 행이 있어야 한다
  const imageIds = collectImageRequests(L, []).map(r => r.id);
  const reviewImages = new Map((review.images || []).map(r => [r.id, r]));
  imageIds.forEach(id => {
    const row = reviewImages.get(id);
    if (!row) { err('R1-IMAGE-MISSING', `review.json에 이미지 "${id}" 행이 없음`); return; }
    if (row.verdict === '틀림') err('R1-VERDICT', `review.json 이미지 "${id}" verdict가 "틀림"`, '지적된 문제를 반영하고 재검토하세요');
    else if (row.verdict === '애매') warn('R1-VERDICT-AMBIGUOUS', `review.json 이미지 "${id}" verdict가 "애매"`);
  });

  // experiments[] — 행 존재는 강제하지 않는다(검토자가 실험이 있는 만큼만 적는다), verdict만 확인한다
  (review.experiments || []).forEach((row, i) => {
    if (row.verdict === '틀림') err('R1-VERDICT', `review.json experiments[${i}](${row.where || '?'}) verdict가 "틀림"`, '지적된 문제를 반영하고 재검토하세요');
    else if (row.verdict === '애매') warn('R1-VERDICT-AMBIGUOUS', `review.json experiments[${i}](${row.where || '?'}) verdict가 "애매"`);
  });

  // reviewedAt은 정보용(누가 언제 검토했는지 기록)으로 남는다 — 신선함 판정에는 더 이상 안 쓴다(N4,
  // 아래 stamp 참고). 그래도 형식이 아예 깨졌거나 미래 시각이면 사소한 데이터 문제로 잡아준다.
  const reviewedAt = Date.parse(review.reviewedAt || '');
  if (Number.isNaN(reviewedAt)) err('R1-STALE', 'review.json의 reviewedAt이 없거나 ISO 시각으로 파싱할 수 없음');
  else if (reviewedAt > Date.now() + 5 * 60 * 1000)
    err('R1-STALE', `review.json의 reviewedAt(${review.reviewedAt})이 미래 시각임(5분 이상)`, '시계가 안 맞거나 잘못 적은 값입니다 — reviewedAt을 실제 검토 시각으로 고치세요');

  // 오래된 검토 방지(N4) — mtime이 아니라 내용 해시(stamp)로 판정한다. review.json은 검토 당시
  // lesson.json·참조 이미지 파일들의 sha256을 `stamp`에 담아야 하고(검토 마지막 단계로
  // `node scripts/gate.mjs <lesson> --review-stamp`를 실행해 채운다), 게이트는 "지금" 내용의 해시를
  // 다시 계산해 비교한다 — mtime과 달리 touch만 해서는 통과 못 하고, 내용이 한 글자도 안 바뀌면(예:
  // 파일을 다시 저장만 함) 오래됐다고도 안 나온다. out/은 여기서도 비교 대상이 아니다(콘텐츠는
  // lesson.json이 대표한다).
  const currentLessonHash = fileHash(ctx.file);
  const currentImageHashes = {};
  const manifestPath = path.join(ctx.dir, 'images', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const id of imageIds) {
        const entry = manifest.images?.[id];
        if (entry?.file) { const h = fileHash(path.join(ctx.dir, entry.file)); if (h) currentImageHashes[id] = h; }
      }
    } catch { /* manifest 파싱 실패는 I1이 이미 잡는다 */ }
  }
  const stamp = review.stamp && typeof review.stamp === 'object' ? review.stamp : null;
  if (!stamp || !stamp.lesson) {
    err('R1-STAMP', 'review.json에 stamp(lesson.json·참조 이미지의 sha256)가 없음',
      '검토를 마친 뒤 마지막 단계로 node scripts/gate.mjs <lesson.json> --review-stamp를 실행해 review.json에 stamp를 채우세요');
  } else {
    if (stamp.lesson !== currentLessonHash)
      err('R1-STALE', 'review.json이 오래됨 — lesson.json 내용이 검토 이후 바뀜(stamp.lesson 해시 불일치)',
        '수정 사항을 반영한 뒤 도메인 검토를 다시 하고 node scripts/gate.mjs <lesson.json> --review-stamp로 stamp를 갱신하세요');
    const changedImages = imageIds.filter(id => currentImageHashes[id] && stamp.images?.[id] !== currentImageHashes[id]);
    if (changedImages.length)
      err('R1-STALE', `review.json이 오래됨 — 참조 이미지(${changedImages.join(', ')})가 검토 이후 바뀜(stamp.images 해시 불일치)`,
        '수정 사항을 반영한 뒤 도메인 검토를 다시 하고 node scripts/gate.mjs <lesson.json> --review-stamp로 stamp를 갱신하세요');
  }

  if (!String(review.reviewer || '').trim()) warn('R1-REVIEWER', 'review.json의 reviewer가 비어 있음');
});

// ── 브라우저 실측 ───────────────────────────────────────
const need = ['slides.html', 'worksheet.html', 'answer-key.html', 'lesson-plan.html'];
const missing = need.filter(f => !fs.existsSync(path.join(out, f)));
if (missing.length) {
  await gate('B0', '빌드 산출물', err => err('B0-MISSING', `out/에 ${missing.join(', ')} 없음`, '먼저 node build.mjs <lesson.json>'));
} else {
  const browser = await launch();
  const consoleErrs = [];
  const open = async (f, vp, q = '', dir = out) => {
    const p = await browser.newPage({ viewport: vp });
    p.on('console', m => { if (m.type() === 'error') consoleErrs.push(`${f}: ${m.text()}`); });
    p.on('pageerror', e => consoleErrs.push(`${f}: ${e.message}`));
    await p.goto(fileUrl(path.join(dir, f)) + q);
    await p.evaluate(() => document.fonts.ready);
    return p;
  };
  try {
    const deck = await open('slides.html', { width: 1920, height: 1080 }, '?shot=1');
    const n = await deck.evaluate(() => window.__deck.count);
    const measureAllSlides = async page => {
      const res = [];
      for (let i = 0; i < n; i++) {
        await page.evaluate(k => window.__deck.show(k), i);
        await page.waitForTimeout(30);
        res.push(await page.evaluate(([src, k]) => { (0, eval)(src); return (0, eval)('(' + window.__ms + ')')(k); }, [`window.svgTextChecks = ${svgTextChecks.toString()}; window.segsOf = ${segsOf.toString()}; window.hitRect = ${hitRect.toString()}; window.__ms = ${JSON.stringify(measureSlide.toString())}`, i]));
      }
      return res;
    };
    const per = await measureAllSlides(deck);
    // meta.font가 kopub으로 정해졌을 때만: build.mjs → fonts.py가 남긴 out/.font-mode.json으로 판단한다
    // (여기서 다시 설치 여부를 재검사하지 않는다 — fonts.py가 이미 한 번 했다, 단일 진실 소스).
    let fontMode = null;
    try { fontMode = JSON.parse(fs.readFileSync(path.join(out, '.font-mode.json'), 'utf8')); } catch { /* 구버전 out/ - 건너뜀 */ }
    const kopubUsed = fontMode?.mode === 'kopub' && fontMode.kopub === 'used';
    // B1/B2/B5 검사 본문을 함수로 빼 둔다 — 이 PC(KoPub 설치됨)에서 잰 결과(tag='')뿐 아니라,
    // 아래 B9에서 KoPub 없는 교실 PC를 흉내 낸 두 번째 렌더 결과(tag=' (KoPub 미설치 대체)')에도
    // 그대로 재사용한다. 같은 잣대로 두 번 잰다.
    const checkB1 = (per, err, tag = '') => {
      per.forEach(m => {
        m.clipped.forEach(c => err('B1-CLIP', `${m.n}번 슬라이드: 내용이 영역을 넘침 (${c})${tag}`, '글을 줄이거나 슬라이드를 나누세요'));
        m.outside.forEach(c => err('B1-OUT', `${m.n}번 슬라이드: 안전 영역 밖 요소 (${c})${tag}`));
        m.overlap.forEach(c => err('B1-OVERLAP', `${m.n}번 슬라이드: 글자끼리 겹침 (${c})${tag}`));
        // lesson.json에 문자열 자리에 객체를 넣으면(예: activity.steps에 {h,t}) 화면에 그대로
        // "[object Object]"가 찍힌다 — S1-SHAPE(정적)와 별개로 실제 렌더 결과에서도 잡는다.
        (m.badRender || []).forEach(c => err('B1-RENDER', `${m.n}번 슬라이드에 "${c}"가 그대로 찍힘 — lesson.json에 문자열 자리에 객체·undefined 값이 들어갔을 가능성`, 'S1-SHAPE 오류를 먼저 확인하세요'));
      });
    };
    const checkB2 = (per, err, warn, tag = '') => {
      per.forEach(m => {
        m.small.forEach(c => err('B2-SMALL', `${m.n}번 슬라이드: ${c} < ${rules.minSmall}px${tag}`, '뒷자리 학생 기준 최소 크기'));
        m.bodySmall.forEach(c => err('B2-BODY', `${m.n}번 슬라이드 본문 ${c} < ${rules.minBody}px${tag}`));
        m.svgSmall.forEach(c => (c.tiny ? err : warn)('B2-SVG', `${m.n}번 삽화 라벨 ${c.msg}${tag}`, c.tiny ? '그래프·삽화의 viewBox를 들어갈 칸 크기에 맞게 줄이세요(라벨이 커짐)' : undefined));
        (m.svgLong || []).forEach(c => err('B2-SVGTEXT', `${m.n}번 삽화 안에 긴 글: ${c}${tag}`, '두 줄 이상 글은 SVG에 넣지 말고 passage 유형(지문)이나 concept 포인트로 쓰세요'));
        (m.crossed || []).forEach(c => err('B2-CROSS', `${m.n}번 삽화 라벨을 선/테두리가 관통: ${c}${tag}`, '라벨을 선(또는 테두리 있는 사각형)에서 떨어뜨리세요(위쪽·바깥쪽)'));
        (m.thin || []).forEach(c => err('B2-THINBAR', `${m.n}번 삽화의 얇은 막대(벽·슬릿 등)가 라벨과 겹침: ${c}${tag}`, '막대와 라벨 사이를 띄우거나 막대를 라벨에서 먼 쪽으로 옮기세요'));
        (m.labelAnchor || []).forEach(c => err('B2-LABELANCHOR', `${m.n}번 그래프의 점·데이터 라벨이 자기 점에서 너무 멀리 떨어짐: ${c}${tag}`, '라벨이 자기 점·마름모 옆에 붙었는지 확인하세요(visuals.mjs의 라벨 배치 로직 점검)'));
        (m.labelOwn || []).forEach(c => err('B2-LABELOWN', `${m.n}번 그래프의 직선·곡선 라벨이 자기 선에서 너무 멀거나 다른 선에 더 가까움: ${c}${tag}`, '라벨이 자기 선 가까이 있는지 확인하세요(visuals.mjs의 putSeries 점검) — 자리가 정 없으면 exit 라벨(틀 밖)이나 범례를 씁니다'));
        (m.occlude || []).forEach(c => err('B2-OCCLUDE', `${m.n}번 삽화: ${c}${tag}`, '그 도형을 라벨보다 먼저(DOM에서 더 위, 즉 더 아래에 그려지게) 옮기거나 라벨을 도형 밖으로 옮기세요'));
        (m.textOverlap || []).forEach(c => err('B2-TEXTOVERLAP', `${m.n}번 삽화의 라벨끼리 겹치거나 거의 붙음: ${c}${tag}`, '두 라벨 중 하나를 옮기거나(pos 조정), viewBox를 넓혀 자리를 만드세요'));
        m.invisible.forEach(c => err('B2-STROKE', `${m.n}번 삽화의 선이 보이지 않음: ${c}${tag}`, '선에는 v-accent-s, v-primary-s, v-secondary-s, v-ink-s, v-line만 쓰세요(v-mid·v-soft·v-muted는 채움 전용)'));
      });
    };
    const checkB5 = (per, err, warn, tag = '') => {
      per.forEach(m => {
        if (['cover', 'chapter', 'exit', 'bignum'].includes(m.type)) return;
        if (m.cover < 0.30) err('B5-EMPTY', `${m.n}번(${m.type}) 내용이 차지하는 면적 ${(m.cover * 100).toFixed(0)}% < 30%${tag}`, '삽화를 넣거나 내용 배치를 넓히세요');
        // profile:evidence는 절제된 배치상 하단 여백이 의도적으로 남을 수 있어 이 경고를 내지 않는다
        if (m.reach < 0.55 && M.profile !== 'evidence') warn('B5-REACH', `${m.n}번(${m.type}) 내용이 위쪽 ${(m.reach * 100).toFixed(0)}%에만 몰림${tag}`);
        m.tinyVisual.forEach(c => err('B5-VISUAL', `${m.n}번(${m.type}) 삽화가 작게 그려짐: ${c}${tag}`, 'viewBox를 그림 크기에 맞게 줄이세요(여백 포함 그림이 viewBox의 20% 이상)'));
      });
    };

    await gate('B1', '슬라이드 넘침·겹침', err => checkB1(per, err));
    await gate('B2', '글자 크기 하한', (err, warn) => checkB2(per, err, warn));
    await gate('B3', '명암 대비', err => {
      per.forEach(m => m.lowContrast.forEach(c => err('B3-CONTRAST', `${m.n}번 슬라이드: ${c}`, '본문 4.5:1, 큰 글자 3:1 이상')));
      per.forEach(m => m.svgContrast.forEach(c => err('B3-SVG', `${m.n}번 삽화 글자가 아래 도형과 구분되지 않음: ${c}`, '글자 아래 도형은 연한 채움(v-soft·v-mid·v-paper2·v-paper3)만, 진한 채움(v-accent·v-primary·v-secondary·v-ink) 위에는 글자를 두지 마세요')));
    });
    await gate('B4', '글꼴 탑재', async (err, warn) => {
      // fontMode/kopubUsed는 위(per 직후)에서 이미 읽어 뒀다 — B9도 같은 값을 쓴다.
      // KoPub이 실제로 쓰였으면(교사가 원한 대로 본문이 통째로 KoPub로 렌더링됨) CF Pretendard는
      // @font-face로 넣혀는 있어도 화면에 한 번도 안 쓰여 브라우저가 굳이 안 불러온다 — 정상이니
      // Pretendard 로드는 요구하지 않는다(아래에서 CF KoPub 로드를 대신 요구한다). 그 외에는 기존대로
      // Pretendard가 로드돼 있어야 한다 — 어느 쪽이든 시스템 대체 글꼴로 새 나가면 안 된다.
      if (!kopubUsed) {
        const ok = await deck.evaluate(() => [...document.fonts].some(f => f.family.includes('CF Pretendard') && f.status === 'loaded'));
        if (!ok) err('B4-FONT', '내장 글꼴(CF Pretendard)이 로드되지 않음', 'build.mjs가 fonts.py로 글꼴을 넣었는지 확인');
      }
      const tofu = await deck.evaluate(() => {
        const txt = [...new Set(document.body.innerText.replace(/\s/g, ''))];
        const c = document.createElement('canvas').getContext('2d');
        const miss = [];
        for (const ch of txt) { c.font = "40px 'CF Pretendard', serif"; const a = c.measureText(ch).width; c.font = '40px serif'; const b = c.measureText(ch).width; c.font = "40px 'CF Pretendard', monospace"; const d = c.measureText(ch).width; if (a === b && b !== d && /[가-힣]/.test(ch)) miss.push(ch); }
        return miss.slice(0, 10).join('');
      });
      if (tofu) err('B4-GLYPH', `내장 글꼴에 없는 글자: ${tofu}`);

      if (fontMode?.mode === 'kopub') {
        if (fontMode.kopub === 'not-installed') {
          // 교사 PC에 KoPub이 없어 Pretendard로 대체된 정상적인 상황 — 통과는 하되 알려준다.
          warn('B4-KOPUB-MISSING', '이 PC에 KoPubWorld Dotum이 설치돼 있지 않아 Pretendard로 대체됨 — https://www.kopus.org/biz-electronic-font2/ (등록 필요)');
        } else if (fontMode.kopub === 'used') {
          const kopub = await deck.evaluate(() => {
            const has = w => [...document.fonts].some(f => f.family.replace(/["']/g, '').includes('CF KoPub') && f.status === 'loaded' && String(f.weight) === String(w));
            // KoPub은 두께가 달라도 라틴·숫자 가로폭(hmtx)이 같게 설계돼 있어(줄바꿈이 두께에 안 흔들리게) measureText
            // 폭 비교로는 못 가른다 — 대신 같은 문자열을 실제로 그려 잉크(불투명 픽셀) 양을 비교한다: Bold가 더 진하다.
            const ink = weight => {
              const c = document.createElement('canvas'); c.width = 400; c.height = 80;
              const g = c.getContext('2d');
              g.font = `${weight} 40px 'CF KoPub', serif`; g.fillStyle = '#000';
              g.fillText('Ag019가나', 10, 50);
              const d = g.getImageData(0, 0, 400, 80).data;
              let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
              return n;
            };
            return { loaded500: has(500), loaded700: has(700), ink500: ink(500), ink700: ink(700) };
          });
          // fonts.py가 설치 확인 후 local()을 넣었는데도 브라우저가 못 읽으면 이름이 실제와 다르거나 폰트가
          // 그새 지워진 것 — 조용히 Pretendard로 넘어가 눈치채지 못할 수 있으니 FAIL로 잡는다.
          if (!kopub.loaded500 || !kopub.loaded700) err('B4-KOPUB-LOAD', 'meta.font:"kopub"인데 CF KoPub(500/700)이 브라우저에 로드되지 않음', 'fonts.py가 찾은 로컬 폰트 이름과 실제 설치본이 같은지 확인');
          else if (kopub.ink700 < kopub.ink500 * 1.05) err('B4-KOPUB-WEIGHT', `CF KoPub 700의 잉크량(${kopub.ink700})이 500(${kopub.ink500})보다 진하지 않음 — 서로 다른 두께로 렌더링되지 않음`);
        }
      }
    });
    await gate('B5', '화면 밀도', (err, warn) => checkB5(per, err, warn));

    // ── B9: KoPub 미설치 대체 레이아웃(G4) ──────────────────────────────────────
    // 이 PC에는 KoPub이 설치돼 있어 위 B1/B2/B5/B4가 전부 CF KoPub로 렌더링된 화면만 봤다.
    // 그러나 KoPub 미설치 교실 PC는 fonts.py가 만든 CF KoPub @font-face의 local()이 매칭되지
    // 않아 자동으로 CF Pretendard로 떨어진다(글자폭이 달라 그 PC에서만 넘침·겹침이 생길 수 있다).
    // meta.font:"kopub"이 실제로 쓰였을 때만: slides.html·worksheet.html·answer-key.html 사본에서
    // CF KoPub @font-face 규칙만 지워 그 상황을 흉내 내고, 같은 잣대(checkB1/B2/B5, 활동지 쪽수)로
    // 한 번 더 잰다. 브라우저는 새로 띄우지 않고 이미 연 browser에서 새 페이지만 연다.
    if (kopubUsed) {
      await gate('B9', 'KoPub 미설치 대체 레이아웃', async (err, warn) => {
        const stripKopub = html => html.replace(/@font-face\{font-family:'CF KoPub'[^}]*\}/g, '');
        // out/ 밑 고정 이름(.nokopub-check)을 쓰면, 같은 레슨을 두 gate.mjs가 동시에 돌릴 때(검토자
        // + 저자가 같이 재검사하는 경우) 서로의 사본 파일을 같은 폴더에 덮어쓰다가 한쪽이 먼저
        // finally에서 그 폴더를 통째로 지워 버려 다른 쪽이 ENOENT로 죽는 사고가 있었다. os.tmpdir()
        // 아래 pid+시각+난수로 매 실행마다 겹치지 않는 이름을 쓴다.
        const noKopubDir = path.join(os.tmpdir(), `cf-nokopub-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        fs.mkdirSync(noKopubDir, { recursive: true });
        const openStripped = async (f, vp) => {
          fs.writeFileSync(path.join(noKopubDir, f), stripKopub(fs.readFileSync(path.join(out, f), 'utf8')));
          const p = await browser.newPage({ viewport: vp });
          await p.goto(fileUrl(path.join(noKopubDir, f)) + '?shot=1');
          await p.evaluate(() => document.fonts.ready);
          return p;
        };
        try {
          const deckNK = await openStripped('slides.html', { width: 1920, height: 1080 });
          // 자가 점검: 정말 CF KoPub이 사라지고 CF Pretendard로 넘어갔는지 두 가지로 확인한다.
          // (1) document.fonts를 직접 훑어 'CF KoPub'라는 FontFace가 이 문서에 하나라도 있는지
          // — document.fonts.check()는 이름이 안 걸려도 대체 글꼴로 "그릴 수는 있다"고 true를
          // 낼 수 있어(제네릭 폴백 인정) 이 용도엔 못 쓴다. B4가 이미 쓰는 방식과 같다.
          // (2) 제목 글자를 캔버스로 실제 그 폭을 재서 비교(팀 리더가 요청한 "제목 폭 비교") —
          // h1 요소의 getBoundingClientRect는 컨테이너 폭이라 안 바뀌므로 쓸 수 없고, 캔버스
          // measureText로 순수 글자폭을 재야 두 글꼴의 실제 차이가 드러난다.
          const fontProbe = async page => page.evaluate(() => {
            const registered = [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'CF KoPub');
            const text = (document.querySelector('h1,h2') || document.body).textContent.trim().slice(0, 20) || '가나다라마바사';
            const cv = document.createElement('canvas').getContext('2d');
            cv.font = `700 40px ${getComputedStyle(document.body).fontFamily}`;
            return { registered, text, width: cv.measureText(text).width };
          });
          const [pKopub, pFallback] = await Promise.all([fontProbe(deck), fontProbe(deckNK)]);
          if (pFallback.registered) {
            warn('B9-NOFALLBACK', `대체 검증이 CF KoPub를 실제로 없애지 못한 것 같음(사본 document.fonts에 여전히 CF KoPub FontFace가 있음) — @font-face 제거 정규식을 확인하세요`);
          } else {
            console.log(`   (B9 자가 점검: CF KoPub 등록 — 원본 ${pKopub.registered}, 대체 사본 ${pFallback.registered}. 제목 "${pKopub.text}" 캔버스 폭 — CF KoPub 렌더 ${pKopub.width.toFixed(1)}px ↔ 대체(CF Pretendard) 렌더 ${pFallback.width.toFixed(1)}px)`);
          }
          const perNK = await measureAllSlides(deckNK);
          checkB1(perNK, err, ' (KoPub 미설치 대체)');
          checkB2(perNK, err, warn, ' (KoPub 미설치 대체)');
          checkB5(perNK, err, warn, ' (KoPub 미설치 대체)');
          await deckNK.close();

          // 활동지·정답지도 같은 대체 상황에서 쪽수·넘침이 늘어날 수 있다("맞추기/채우기" 검사).
          for (const f of ['worksheet.html', 'answer-key.html']) {
            const p = await openStripped(f, { width: 1300, height: 1000 });
            await p.waitForFunction(() => window.__paged === true, null, { timeout: 15000 });
            const d = await p.evaluate((src) => { (0, eval)(src); return (0, eval)('(' + window.__md + ')')(); }, `window.svgTextChecks = ${svgTextChecks.toString()}; window.segsOf = ${segsOf.toString()}; window.hitRect = ${hitRect.toString()}; window.__md = ${JSON.stringify(measureDoc.toString())}`);
            await p.close();
            const lim = { 'worksheet.html': 4, 'answer-key.html': 5 }[f];
            if (d.overflow) err('B6-OVER', `${f}: 한 쪽보다 큰 블록 ${d.overflow}개 (KoPub 미설치 대체)`, '문항을 나누거나 그리기 칸 높이를 줄이세요');
            if (d.pages > lim) err('B6-PAGES', `${f}: ${d.pages}쪽 > ${lim}쪽 (KoPub 미설치 대체)`, '문항 수를 줄이세요');
          }
        } finally {
          fs.rmSync(noKopubDir, { recursive: true, force: true });
        }
      });
    }
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
        (d.badRender || []).forEach(c => err('B6-RENDER', `${f}: "${c}"가 그대로 찍힘 — lesson.json에 문자열 자리에 객체·undefined 값이 들어갔을 가능성`, 'S1-SHAPE 오류를 먼저 확인하세요'));
        (d.matchLine || []).forEach(c => err('B6-MATCHLINE', `${f}: 매칭 정답선이 점에 안 닿음: ${c}`, 'paginate.js의 .match 선 보정(레이아웃 이후 .dot 좌표로 다시 긋기)이 실행됐는지 확인하세요'));
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
  const res = { n: i + 1, type: s.dataset.type, bodySmall: [], invisible: [], tinyVisual: [], svgContrast: [], clipped: [], outside: [], overlap: [], small: [], svgSmall: [], lowContrast: [], labelAnchor: [], labelOwn: [], badRender: [], occlude: [], textOverlap: [], bodyMedian: 0, cover: 0, reach: 0 };
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
  res.svgLong = sv.long; res.crossed = sv.crossed; res.thin = sv.thin; res.occlude = sv.occlude; res.textOverlap = sv.textOverlap;
  // 점·데이터 라벨은 자기 점(visuals.mjs가 남긴 data-anchor) 가까이 있어야 한다 — 링 탐색이 실패해
  // 엉뚱한 자리로 밀려나는 회귀를 여기서 자동으로 잡는다(B2-LABELANCHOR). 좌표·글자 크기 모두
  // 이 SVG의 user 좌표계(viewBox) 기준이라 화면 스케일과 무관하게 비교할 수 있다.
  const PLOT_FS = { 'v-label': 34, 'v-label-a': 34, 'v-label-s': 28 };
  for (const svg of body.querySelectorAll('svg[data-plot]')) {
    for (const t of svg.querySelectorAll('text[data-anchor]')) {
      const [ax, ay] = (t.getAttribute('data-anchor') || '').split(',').map(Number);
      const x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
      const fs = PLOT_FS[t.getAttribute('class')] || 30;
      const dist = Math.hypot(x - ax, y - ay);
      // 점이 축에 바짝 붙어 있으면(예: y축 위의 점) visuals.mjs가 일부러 수평으로 더 멀리
      // (최대 7.2×, farCands) 밀어내는 것도 정상 동작이다 — 그 범위(7.5×까지)는 통과시키고, 그보다
      // 더 멀면(플롯 전체를 훑는 quadrantCands까지 갔다는 뜻) 진짜 이상 신호로 본다.
      if (dist > fs * 7.5) res.labelAnchor.push(`"${t.textContent.trim().slice(0, 12)}" ${Math.round(dist)}(폰트 ${fs}의 ${(dist / fs).toFixed(1)}배)`);
    }
  }
  res.labelAnchor = [...new Set(res.labelAnchor)].slice(0, 5);
  // 직선·곡선 라벨은 자기 계열 선 가까이(1.5×글자 크기 이내)·다른 계열보다 가까이 있어야 한다
  // (B2-LABELOWN) — visuals.mjs가 <text>와 <line>/<polyline>에 남긴 같은 data-series id로 짝짓고,
  // 실제 DOM 도형 좌표(getBBox — 이 SVG의 user 좌표계라 data-anchor처럼 화면 스케일과 무관하다)로
  // 여기서 독립적으로 다시 잰다 — visuals.mjs가 스스로 "가깝다"고 계산한 값을 그대로 믿지 않는다.
  // 라벨이 두 줄로 접혔으면 같은 data-series의 <text>가 여러 개라, 한 라벨로 합쳐 본다. 자리가
  // 정말 없어 틀 밖 exit 라벨이나 범례(legend, data-label-mode='exit'|'legend')로 대신했으면 그
  // 형태 자체가 "내 것"임을 이미 밝히므로 거리 규칙은 건너뛴다. 범례 견본선(data-label-mode=
  // 'legend-swatch')은 실제 계열 선이 아니라 견본이므로 own-line 기하 계산에서는 뺀다.
  for (const svg of body.querySelectorAll('svg[data-plot]')) {
    const segsBySid = {};
    for (const el of svg.querySelectorAll('line[data-series], polyline[data-series]')) {
      if (el.getAttribute('data-label-mode') === 'legend-swatch') continue;
      const sid = el.getAttribute('data-series'), segs = (segsBySid[sid] ||= []);
      if (el.tagName === 'line') segs.push({ x1: +el.getAttribute('x1'), y1: +el.getAttribute('y1'), x2: +el.getAttribute('x2'), y2: +el.getAttribute('y2') });
      else { const pts = (el.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map(p => p.split(',').map(Number)); for (let i = 1; i < pts.length; i++) segs.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1] }); }
    }
    const boxBySid = {};
    for (const t of svg.querySelectorAll('text[data-series]')) {
      const sid = t.getAttribute('data-series'), bb = t.getBBox(), mode = t.getAttribute('data-label-mode') || '';
      const b = boxBySid[sid] || (boxBySid[sid] = { l: bb.x, r: bb.x + bb.width, t: bb.y, b: bb.y + bb.height, text: t.textContent.trim(), fs: PLOT_FS[t.getAttribute('class')] || 30, exempt: false });
      b.l = Math.min(b.l, bb.x); b.r = Math.max(b.r, bb.x + bb.width); b.t = Math.min(b.t, bb.y); b.b = Math.max(b.b, bb.y + bb.height);
      if (mode === 'exit' || mode === 'legend') b.exempt = true;
    }
    const distPointToSeg = (px, py, s) => { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy || 1; let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy)); };
    const boxDist = (b, segs) => {
      if (!segs || !segs.length) return Infinity;
      const pts = [[(b.l + b.r) / 2, (b.t + b.b) / 2], [b.l, b.t], [b.r, b.t], [b.l, b.b], [b.r, b.b], [(b.l + b.r) / 2, b.t], [(b.l + b.r) / 2, b.b], [b.l, (b.t + b.b) / 2], [b.r, (b.t + b.b) / 2]];
      let best = Infinity;
      for (const [x, y] of pts) for (const s of segs) { const d = distPointToSeg(x, y, s); if (d < best) best = d; }
      return best;
    };
    for (const [sid, b] of Object.entries(boxBySid)) {
      if (b.exempt) continue;
      const dOwn = boxDist(b, segsBySid[sid]);
      let dOther = Infinity;
      for (const [osid, segs] of Object.entries(segsBySid)) if (osid !== sid) dOther = Math.min(dOther, boxDist(b, segs));
      if (dOwn > b.fs * 1.5 || dOwn > dOther) res.labelOwn.push(`"${b.text.slice(0, 12)}" 자기 선까지 ${Math.round(dOwn)}(폰트 ${b.fs}의 ${(dOwn / b.fs).toFixed(1)}배)${dOwn > dOther ? `, 다른 선이 더 가까움(${Math.round(dOther)})` : ''}`);
    }
  }
  res.labelOwn = [...new Set(res.labelOwn)].slice(0, 5);
  // lesson.json에 문자열 대신 객체를 넣으면(예: activity.steps에 {h,t}) 화면·인쇄물에 그대로
  // "[object Object]"가 찍힌다. S1-SHAPE가 lesson.json 단계에서 대부분 잡지만, 표에 없는
  // 자리에서 새거나 두 번째 방어선이 필요할 수 있어 실제로 그려진 화면에서도 잡는다.
  // \b로 낱말 경계를 걸어 "nullify" 같은 진짜 낱말이나 "annulled" 안의 부분 일치를 막는다.
  res.badRender = [...new Set((body.innerText.match(/\[object Object\]|\bundefined\b|\bNaN\b|\bnull\b/g) || []))];
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
  const res = { pages: pages.length, fill: [], overflow: document.querySelectorAll('[data-overflow]').length, tinyText: [], lowContrast: [], leak: [], blanks: 0, emptyBlanks: 0, qs: 0, qMin: 99, badRender: [] };
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
  res.fig.push(...sv.long.map(c => `그림 안 긴 글: ${c}`), ...sv.crossed.map(c => `라벨을 선/테두리가 관통: ${c}`), ...sv.contrast.map(c => `그림 글자 대비: ${c}`), ...sv.thin.map(c => `그림 안 얇은 막대가 라벨과 겹침: ${c}`), ...sv.occlude.map(c => `그림 안 도형이 라벨을 가림: ${c}`), ...sv.textOverlap.map(c => `그림 안 라벨끼리 겹침: ${c}`));
  res.fig = [...new Set(res.fig)].slice(0, 8);
  // lesson.json에 문자열 대신 객체를 넣으면 인쇄물에도 "[object Object]"가 그대로 찍힌다 — 슬라이드와
  // 같은 방어선(\b로 낱말 경계를 걸어 "nullify" 같은 진짜 낱말은 건드리지 않는다).
  res.badRender = [...new Set((document.body.innerText.match(/\[object Object\]|\bundefined\b|\bNaN\b|\bnull\b/g) || []))];
  // 정답지의 매칭(.match) 정답선이 실제로 점(.dot) 중심에 닿는지 스스로 확인한다(B6-MATCHLINE) —
  // paginate.js가 레이아웃 이후 x1/y1/x2/y2를 점 좌표로 다시 쓰는데, 그 보정이 실패하면(스크립트
  // 오류·타이밍 등) 선이 다시 칸 경계(빌드 시점 %)에 남아 예전처럼 점 앞에서 끊겨 보인다.
  res.matchLine = [];
  for (const m of document.querySelectorAll('.match')) {
    const svg = m.querySelector('svg');
    if (!svg) continue;
    const svgRect = svg.getBoundingClientRect();
    // line.x1.baseVal.value 등은 그 <line>의 실제 좌표를 user 단위(px, viewBox를 픽셀 크기로
    // 맞춰 뒀으므로)로 준다 — bbox 모서리(getBoundingClientRect)로는 선이 대각선 방향에 따라
    // 어느 끝이 "top"·"left"인지 뒤바뀌어 x1/y1 쪽과 x2/y2 쪽을 잘못 짝지을 수 있다.
    for (const line of svg.querySelectorAll('line[data-a]')) {
      const dotA = m.querySelector(`.it.l[data-row="${line.dataset.a}"] .dot`);
      const dotB = m.querySelector(`.it.r[data-row="${line.dataset.b}"] .dot`);
      if (!dotA || !dotB) continue;
      const ra = dotA.getBoundingClientRect(), rb = dotB.getBoundingClientRect();
      const x1 = svgRect.left + line.x1.baseVal.value, y1 = svgRect.top + line.y1.baseVal.value;
      const x2 = svgRect.left + line.x2.baseVal.value, y2 = svgRect.top + line.y2.baseVal.value;
      const dA = Math.hypot(x1 - (ra.left + ra.width / 2), y1 - (ra.top + ra.height / 2));
      const dB = Math.hypot(x2 - (rb.left + rb.width / 2), y2 - (rb.top + rb.height / 2));
      if (dA > 2 || dB > 2) res.matchLine.push(`${line.dataset.a}→${line.dataset.b} 점에서 ${Math.round(Math.max(dA, dB))}px 떨어짐`);
    }
  }
  return res;
}

// SVG 글자 공통 검사: 긴 글(여러 줄 문단), 선이 라벨을 관통, (doc 모드) 아래 도형과의 대비
function svgTextChecks(root, doc) {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgbOf = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = c => { const m = rgbOf(c); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
  const out = { long: [], crossed: [], contrast: [], thin: [], occlude: [], textOverlap: [] };
  for (const svg of root.querySelectorAll('svg')) {
    const texts = [...svg.querySelectorAll('text')].filter(t => t.getBoundingClientRect().width);
    // 빌드가 그린 그래프(plot()/bars())는 라벨 배치를 이미 계산했다고 믿고 아래 얇은 막대(B2-THINBAR)·
    // 도형 가림(B2-OCCLUDE)·긴 글(B2-SVGTEXT) 검사는 건너뛴다(이 셋은 그 계산이 실제로 다루는
    // 문제라 재검사할 필요가 적다). 그러나 라벨-선 관통(B2-CROSS)과 라벨-라벨 겹침(B2-TEXTOVERLAP)은
    // 작은 compare 칸처럼 빽빽한 자리에서 그 계산이 실패할 수 있어(실제 사고 사례) generated라도
    // 그대로 검사한다 — 대신 라벨의 paint-order 헤일로(하양 테두리)만큼은 여유를 더 준다(아래).
    const generated = svg.hasAttribute('data-plot') || svg.hasAttribute('data-bars');
    if (!generated) {
      // 라벨을 그린 "뒤에"(DOM 순서 = SVG paint 순서) 불투명 채움 도형이 겹치면 라벨이 가려진다
      // (B2-OCCLUDE) — 얇은 막대(B2-THINBAR)와 달리 두께 조건이 없다. 라벨보다 먼저(=아래) 그려진
      // 도형은 배경이라 허용한다(B3가 그 대비를 따로 본다).
      var allEls = [...svg.querySelectorAll('*')];
      var idxOf = new Map(allEls.map((el, k) => [el, k]));
      var occluders = allEls.filter(el => ['rect', 'circle', 'ellipse', 'polygon', 'path'].includes(el.tagName));
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
    }
    // 라벨끼리 겹치거나 거의 붙어 있으면(B2-TEXTOVERLAP, plot()/bars()가 그렸어도 검사한다). <tspan>은 별도 <text>가 아니라 이
    // 목록(texts)에 안 잡혀 한 라벨 안의 여러 줄을 오검출하지 않는다.
    // "같은 줄(같은 baseline band)"인지는 상자 겹침(oy>0)이 아니라 실제 기준선(baseline, text의
    // x·y 속성이 가리키는 그 점)의 화면 y가 서로 가까운지로 본다 — getBoundingClientRect()는
    // 폰트 어센트·디센트가 낀 줄 상자라, 두 줄짜리 캡션(줄 간격이 폰트 크기보다 빠듯한 경우)이나
    // "+/−" 같이 잉크가 세로 가운데에만 몰린 부호는 실제로 안 붙어 보여도 상자만 겹칠 수 있다.
    // 기준선이 서로 다른 줄이면(보통 한 줄 높이 이상 떨어짐) 상자가 우연히 겹쳐도 무시한다.
    // fs*0.3 문턱은 로컬(SVG 사용자 단위) 글자 크기 기준인데 pa/pb는 CTM을 거친 화면 좌표라, TikZ
    // 도해처럼 --cf-label-scale로 축소해 그리는 경우(예: scale≈2.3) getComputedStyle의 fontSize가
    // 로컬 값(예: 28px)이라 화면에서 실제로 벌어진 간격보다 훨씬 더 "같은 줄"로 오판했다 — 화면에서
    // 뚜렷이 겹치는 라벨("빛"/"광전관")도 이 문턱을 통과해 못 잡는 실제 버그였다. segsOf의
    // screenStrokeWidth와 같은 방식으로 CTM 스케일(Math.hypot(ctm.a, ctm.b))을 곱해 화면 단위로 맞춘다.
    const baselineOf = t => {
      const ctm = t.getScreenCTM();
      if (!ctm) return null;
      const x = parseFloat(t.getAttribute('x')) || 0, y = parseFloat(t.getAttribute('y')) || 0;
      return { pt: new DOMPoint(x, y).matrixTransform(ctm), scale: Math.hypot(ctm.a, ctm.b) || 1 };
    };
    for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
      const ba = baselineOf(texts[a]), bb = baselineOf(texts[b]);
      if (!ba || !bb) continue;
      const fs = Math.max(parseFloat(getComputedStyle(texts[a]).fontSize) || 28, parseFloat(getComputedStyle(texts[b]).fontSize) || 28);
      const scale = Math.max(ba.scale, bb.scale);
      if (Math.abs(ba.pt.y - bb.pt.y) >= fs * scale * 0.3) continue;   // 기준선이 한 줄 이상 떨어져 있으면 다른 줄(화면 단위로 비교)
      const ra = texts[a].getBoundingClientRect(), rb = texts[b].getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      if (ox > -4) out.textOverlap.push(`"${texts[a].textContent.trim().slice(0, 12)}" ↔ "${texts[b].textContent.trim().slice(0, 12)}"`);
    }
    if (!generated) {
      // 긴 글: 한 요소에 40자 초과, 또는 같은 x에서 줄 간격이 촘촘한 3줄 이상 — plot()/bars()는
      // 항상 짧은 라벨만 만들어 내므로(원래 이 검사가 다루는 문제가 아니다) 손으로 그린 SVG만 본다.
      for (const t of texts) if (t.textContent.trim().length > 40) out.long.push(`"${t.textContent.trim().slice(0, 16)}…" ${t.textContent.trim().length}자`);
      const byX = {};
      for (const t of texts) { const r = t.getBoundingClientRect(); const k = Math.round(r.left / 4); (byX[k] ||= []).push(r); }
      for (const rs of Object.values(byX)) {
        rs.sort((a, b) => a.top - b.top);
        let run = 1;
        for (let i = 1; i < rs.length; i++) { run = rs[i].top - rs[i - 1].top < rs[i].height * 1.35 ? run + 1 : 1; if (run >= 3) { out.long.push('촘촘한 여러 줄 글(문단)'); break; } }
      }
    }
    for (const t of texts) {
      const cs = getComputedStyle(t);
      // 헤일로(paint-order:stroke인 하양 테두리)는 선이 그 테두리만 스치는 정도는 봐줘도 되지만
      // (글자 자체를 가리진 않는다), 실제 글자 획까지 파고드는 관통은 여전히 잡아야 한다(plot()
      // 라벨도 마찬가지 — 좁은 compare 칸에서 예측선이 자기 라벨을 뚫고 지나간 실제 사고가 있었다).
      // 그래서 완전히 건너뛰지 않고, 테두리 폭의 절반만큼만 여유를 더 준다.
      const halo = cs.paintOrder.startsWith('stroke') && parseFloat(cs.strokeWidth) >= 6 && cs.stroke !== 'none';
      const padX = halo ? Math.max(2, parseFloat(cs.strokeWidth) / 2) : 2;
      const r = t.getBoundingClientRect();
      // 선 관통: 선(line·polyline·열린 path)의 실제 좌표를 화면 좌표로 바꿔 글자 상자와 교차하는지 계산(점선 빈틈과 무관)
      const rb = { l: r.left + padX, r: r.right - padX, t: r.top + r.height * .1, b: r.bottom - r.height * .12 };
      if (segsOf(svg, generated ? 'v-line' : undefined).some(sg => hitRect(rb, sg))) out.crossed.push(`"${t.textContent.trim().slice(0, 12)}"`);
      if (!generated) {
        // 불투명 채움 도형이 라벨보다 나중에(=위에) 그려져 겹치면 가려진다 — 겹침이
        // 글자 넓이의 8% 이상이거나 가로·세로 둘 다 4px 이상일 때만 "가림"으로 본다(자잘한
        // 반올림 겹침은 무시).
        const tArea = r.width * r.height, tIdx = idxOf.get(t);
        for (const sEl of occluders) {
          if ((idxOf.get(sEl) ?? -1) <= tIdx) continue;   // 라벨보다 먼저(=아래) 그려졌으면 배경 — 허용
          const scs = getComputedStyle(sEl);
          if (scs.fill === 'none' || scs.visibility === 'hidden') continue;
          if (Number(scs.opacity) * Number(scs.fillOpacity ?? 1) < 0.5) continue;
          const sr = sEl.getBoundingClientRect();
          if (!sr.width || !sr.height) continue;
          const ox = Math.min(r.right, sr.right) - Math.max(r.left, sr.left);
          const oy = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
          if (ox <= 0 || oy <= 0) continue;
          if (ox * oy >= tArea * 0.08 || (ox >= 4 && oy >= 4)) {
            const shapeName = sEl.tagName + (sEl.getAttribute('class') ? `.${sEl.getAttribute('class').split(' ')[0]}` : '');
            out.occlude.push(`"${t.textContent.trim().slice(0, 12)}"이(가) 나중에 그려진 ${shapeName}에 가려짐`);
            break;
          }
        }
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
  }
  out.long = [...new Set(out.long)].slice(0, 4); out.crossed = [...new Set(out.crossed)].slice(0, 5); out.contrast = [...new Set(out.contrast)].slice(0, 5);
  out.thin = [...new Set(out.thin)].slice(0, 5); out.occlude = [...new Set(out.occlude)].slice(0, 5); out.textOverlap = [...new Set(out.textOverlap)].slice(0, 5);
  return out;
}

// SVG 안 선들의 화면 좌표 선분 (라벨 관통 검사용) — line·polyline·열린 path에 더해,
// 테두리(stroke)가 있는 rect도 네 변을 선분으로 넣는다(채움 rect의 테두리가 라벨을 가로지르는 경우까지 잡는다).
// cs.strokeWidth는 그 요소의 "로컬" SVG 사용자 좌표 단위다 — 우리 도식(diagrams.mjs)은 라벨
// 글자 크기와 똑같이 --cf-label-scale로 선 굵기도 나눠서 지정한다(deck.css/print.css: 화면에서
// 항상 몇 px로 보이게, 그 도식의 viewBox가 몇 배로 확대되어 칸을 채우든). 그 결과 "로컬" 값은 1보다
// 작은 경우가 흔한데(예: 5.5px ÷ 5.2배 확대 ≈ 1.05), 이 값을 그대로 문턱값과 비교하면 화면에는
// 또렷이 보이는 선(확대되어 실제로는 10px 넘게 보임)이 "너무 가늘어서 장애물이 아님"으로 잘못
// 걸러진다 — 실측 결과 라벨을 가로지르는 광선을 B2-CROSS가 못 잡은 실제 버그였다. getScreenCTM()의
// 확대 배율을 곱해 "화면에 실제로 보이는" 굵기로 문턱값을 비교한다.
function segsOf(svg, excludeClass) {
  if (svg.__segs && svg.__segsKey === excludeClass) return svg.__segs;
  // measureSlide/svgTextChecks/segsOf/hitRect는 브라우저 안에서 함수 소스(toString)만 떼어 eval되므로
  // (gate.mjs 아래쪽 참고) 바깥 스코프의 상수를 못 본다 — 이 함수 안에 그대로 넣어야 한다.
  const screenStrokeWidth = (cs, m) => parseFloat(cs.strokeWidth) * (m ? Math.hypot(m.a, m.b) : 1);
  const segs = [];
  for (const e of svg.querySelectorAll('line, polyline, path')) {
    // excludeClass: plot()의 격자(class='v-line')는 화면을 촘촘히 덮어 어떤 라벨이든 스칠 수 있다 —
    // 관통 검사의 "선"은 예측선·곡선·축처럼 실제 의미 있는 선이지 배경 격자가 아니므로, plot()/bars()
    // 그래프에서만 격자를 제외한다(손그림 SVG의 점선 보조선은 여전히 v-line이라도 검사 대상이다).
    if (excludeClass && e.classList.contains(excludeClass)) continue;
    const cs = getComputedStyle(e);
    const m0 = e.getScreenCTM();
    if (cs.stroke === 'none' || screenStrokeWidth(cs, m0) < 1.2 || cs.visibility === 'hidden' || Number(cs.opacity) < .15) continue;
    if (e.tagName !== 'line' && cs.fill !== 'none') continue;
    const m = m0; if (!m) continue;
    let pts = [];
    if (e.tagName === 'line') pts = [[e.x1.baseVal.value, e.y1.baseVal.value], [e.x2.baseVal.value, e.y2.baseVal.value]];
    else { const L = e.getTotalLength(); for (let i = 0; i <= 48; i++) { const q = e.getPointAtLength(L * i / 48); pts.push([q.x, q.y]); } }
    const sp = pts.map(([x, y]) => { const q = new DOMPoint(x, y).matrixTransform(m); return [q.x, q.y]; });
    for (let i = 1; i < sp.length; i++) segs.push([sp[i - 1], sp[i]]);
  }
  for (const e of svg.querySelectorAll('rect')) {
    const cs = getComputedStyle(e);
    const m = e.getScreenCTM();
    if (cs.stroke === 'none' || screenStrokeWidth(cs, m) < 1.2 || cs.visibility === 'hidden' || Number(cs.opacity) < .15) continue;
    if (!m) continue;
    const x = e.x.baseVal.value, y = e.y.baseVal.value, w = e.width.baseVal.value, h = e.height.baseVal.value;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => { const q = new DOMPoint(px, py).matrixTransform(m); return [q.x, q.y]; });
    for (let i = 0; i < 4; i++) segs.push([corners[i], corners[(i + 1) % 4]]);
  }
  svg.__segsKey = excludeClass;
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
