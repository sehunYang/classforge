// classforge intake — 교사가 채운 수업 설계서(.md)를 intake.json으로 파싱하고,
// lesson.json(및 out/ 산출물)이 채운 항목을 실제로 반영했는지 되짚어 확인한다(--check).
// 사용:
//   node intake.mjs <설계서.md> [--json out.json]
//   node intake.mjs --check <설계서.md> <lesson.json> [--json report.json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ── 필드 정의 ──────────────────────────────────────────────
// kind: text | number | block | list | listPair | checkboxSingle | checkboxMulti | range | timeAlloc
// options가 있으면 체크된 한글 라벨 → 코드 매핑(★역방향 매핑은 REVERSE로).
export const FIELDS = [
  { key: 'schoolLevel', kind: 'checkboxSingle', star: false, options: { '초등학교': 'elem', '중학교': 'middle', '고등학교': 'high' } },
  { key: 'grade', kind: 'text' },
  { key: 'subject', kind: 'text' },
  { key: 'unit', kind: 'text' },
  { key: 'lesson', kind: 'text' },
  { key: 'minutes', kind: 'number' },
  { key: 'classSize', kind: 'text' },
  { key: 'classLevel', kind: 'text' },
  { key: 'classNeeds', kind: 'text' },
  { key: 'standards', kind: 'block', star: true },
  { key: 'objectives', kind: 'list', star: true },
  { key: 'keyTerms', kind: 'list' },
  { key: 'excludeScope', kind: 'list' },
  { key: 'priorKnowledge', kind: 'block' },
  { key: 'misconceptions', kind: 'list', star: true },
  { key: 'model', kind: 'text' },
  { key: 'hookIdea', kind: 'block' },
  { key: 'activityMode', kind: 'checkboxSingle', options: { '개인': 'individual', '짝': 'pair', '모둠': 'group' } },
  { key: 'materials', kind: 'list' },
  { key: 'timeAllocation', kind: 'timeAlloc' },
  { key: 'mustInclude', kind: 'list', star: true },
  { key: 'mustExclude', kind: 'list' },
  { key: 'quizStyle', kind: 'block' },
  { key: 'quizCount', kind: 'number' },
  { key: 'worksheetQCount', kind: 'range' },
  { key: 'worksheetTypes', kind: 'checkboxMulti', options: { '선택형': 'choice', '서술형': 'short', 'OX': 'ox', '짝짓기': 'match', '표': 'table', '그리기': 'draw' } },
  { key: 'difficulty', kind: 'checkboxSingle', options: { '쉬움': 'easy', '보통': 'normal', '어려움': 'hard' } },
  { key: 'hasEssay', kind: 'checkboxSingle', options: { '예': 'yes', '아니오': 'no' } },
  { key: 'slidesCount', kind: 'range' },
  { key: 'profile', kind: 'checkboxSingle', options: { '기본': 'default', '증거 중심(evidence)': 'evidence' } },
  { key: 'titleStyle', kind: 'checkboxSingle', options: { '메시지형(핵심을 바로 말함)': 'message', '질문형': 'question', '명사형(개념 이름)': 'noun' } },
  { key: 'tone', kind: 'checkboxSingle', options: { '해요체': '해요체', '합쇼체': '합쇼체' } },
  { key: 'imageCount', kind: 'number' },
  { key: 'imageUse', kind: 'block' },
  { key: 'accentColor', kind: 'text' },
  { key: 'textbookPages', kind: 'text' },
  { key: 'referenceMaterial', kind: 'block' },
  { key: 'facts', kind: 'listPair' },
  { key: 'deliverables', kind: 'checkboxMulti', options: { '슬라이드': 'slides', '활동지': 'worksheet', '정답지': 'answerKey', '지도안': 'lessonPlan' } },
  { key: 'etcRequest', kind: 'block' },
];
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));
// 코드 → 한글 라벨(퍼지 검색용 역방향 매핑)
export function reverseLabel(key, code) {
  const f = FIELD_BY_KEY[key];
  if (!f?.options) return String(code ?? '');
  const hit = Object.entries(f.options).find(([, c]) => c === code);
  return hit ? hit[0] : String(code ?? '');
}

// ── 마크다운 파싱 ──────────────────────────────────────────
// 1) key 마커를 살려 둔 채 나머지 <!-- ... --> 주석(예시)은 전부 제거한다.
// 2) 각 줄에서 key 마커를 찾아 "글머리표 줄"(값이 그 줄에 있음)과
//    "표제 줄"(다음 표제까지 이어지는 블록)을 구분한다.
function stripAndMark(raw) {
  const KEY_RE = /<!--\s*key:\s*([\w.]+)\s*-->/g;
  const placeheld = raw.replace(KEY_RE, (_, k) => `\u0000KEY:${k}\u0000`);
  return placeheld.replace(/<!--[\s\S]*?-->/g, '');
}

function parseForm(mdText) {
  const cleaned = stripAndMark(mdText);
  const lines = cleaned.split(/\r?\n/);
  const markers = [];
  lines.forEach((l, i) => {
    const m = l.match(/\u0000KEY:([\w.]+)\u0000/);
    if (!m) return;
    const stripped = l.replace(/\u0000KEY:[\w.]+\u0000/, '');
    markers.push({ i, key: m[1], isBullet: /^\s*[-*]\s?/.test(stripped), line: stripped });
  });
  const nextHeading = from => { for (let j = from + 1; j < lines.length; j++) if (/^\s*#+\s/.test(lines[j])) return j; return lines.length; };
  // 블록은 다음 표제(#)에서도 끝나지만, 그 전에 다른 필드 마커 줄이 나오면 거기서도 끝난다
  // (같은 절 안에 표제 없는 글머리표 필드가 뒤이어 나오는 경우를 막기 위해)
  const nextMarker = from => { for (const other of markers) if (other.i > from) return other.i; return Infinity; };

  const raw = {}; // key -> 원문 값(가공 전)
  for (const m of markers) {
    const field = FIELD_BY_KEY[m.key];
    if (!field) continue; // 모르는 키는 무시(하위 호환)
    if (m.isBullet) {
      raw[m.key] = { single: m.line };
    } else {
      const end = Math.min(nextHeading(m.i), nextMarker(m.i));
      raw[m.key] = { block: lines.slice(m.i + 1, end) };
    }
  }
  return { raw, lines };
}

const lineValue = l => l.replace(/^\s*[-*]\s?/, '').split(/[:：]/).slice(1).join(':').trim();
const checkedLabels = l => [...l.matchAll(/\[[xX]\]\s*([^\[\]\n]+?)(?=\s*\[|\s*$)/g)].map(m => m[1].trim()).filter(Boolean);
const blockLines = ls => ls.filter(l => l.trim() !== '');

function mapOptions(field, labels, warnings, key) {
  const codes = [];
  for (const lab of labels) {
    if (field.options[lab] !== undefined) { codes.push(field.options[lab]); continue; }
    const hit = Object.keys(field.options).find(o => o.includes(lab) || lab.includes(o));
    if (hit) codes.push(field.options[hit]);
    else warnings.push({ code: 'W-OPTION', msg: `${key}: 체크된 항목 "${lab}"을(를) 알 수 없어 무시함` });
  }
  return codes;
}

function extractOne(field, r, warnings) {
  const key = field.key;
  if (!r) return { value: field.kind === 'list' || field.kind === 'listPair' || field.kind === 'checkboxMulti' ? [] : null, filled: false };
  switch (field.kind) {
    case 'text': {
      const v = lineValue(r.single || '');
      return { value: v || null, filled: !!v };
    }
    case 'number': {
      const v = lineValue(r.single || '');
      const n = v.match(/-?\d+(?:\.\d+)?/);
      if (!n) return { value: v ? v : null, filled: !!v };
      return { value: Number(n[0]), filled: true };
    }
    case 'block': {
      const text = blockLines(r.block || []).join('\n').trim();
      return { value: text || null, filled: !!text };
    }
    case 'list': {
      const ls = r.block || [];
      let items = ls.filter(l => /^\s*[-*]\s+\S/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
      if (!items.length) items = blockLines(ls).filter(l => !/^\s*[-*]\s*$/.test(l)).map(l => l.trim());
      return { value: items, filled: items.length > 0 };
    }
    case 'listPair': {
      const ls = (r.block || []).filter(l => /^\s*[-*]\s*\S/.test(l));
      const items = [];
      for (const l of ls) {
        const m = l.match(/^\s*[-*]\s*(?:수치\s*\/?\s*사실)?\s*[:：]?\s*(.*?)\s*\|\s*(?:출처)?\s*[:：]?\s*(.*)$/);
        if (m) {
          const text = m[1].trim(), source = m[2].trim();
          if (text || source) items.push({ text, source });
        } else if (l.replace(/^\s*[-*]\s*/, '').trim()) {
          warnings.push({ code: 'W-FACT-FORMAT', msg: `facts 항목 형식을 확인하세요("수치/사실: … | 출처: …"): ${l.trim().slice(0, 40)}` });
        }
      }
      return { value: items, filled: items.length > 0 };
    }
    case 'checkboxSingle': {
      const labels = checkedLabels(r.single || '');
      if (labels.length > 1) warnings.push({ code: 'W-MULTI', msg: `${key}: 여러 항목이 체크됨 — 첫 번째("${labels[0]}")만 사용` });
      const codes = mapOptions(field, labels.slice(0, 1), warnings, key);
      return { value: codes[0] ?? null, filled: codes.length > 0 };
    }
    case 'checkboxMulti': {
      const labels = checkedLabels(r.single || '');
      const codes = mapOptions(field, labels, warnings, key);
      return { value: codes, filled: codes.length > 0 };
    }
    case 'range': {
      const v = lineValue(r.single || '');
      const m2 = v.match(/(\d+(?:\.\d+)?)\s*(?:~|-|–|—|부터)\s*(\d+(?:\.\d+)?)/);
      if (m2) return { value: [Number(m2[1]), Number(m2[2])], filled: true };
      const m1 = v.match(/\d+(?:\.\d+)?/);
      if (m1) return { value: [Number(m1[0]), Number(m1[0])], filled: true };
      return { value: null, filled: false };
    }
    case 'timeAlloc': {
      const v = r.single || '';
      const intro = v.match(/도입\s*(\d+)/), dev = v.match(/전개\s*(\d+)/), wrap = v.match(/정리\s*(\d+)/);
      if (!intro && !dev && !wrap) return { value: null, filled: false };
      return { value: { intro: intro ? Number(intro[1]) : null, develop: dev ? Number(dev[1]) : null, wrap: wrap ? Number(wrap[1]) : null }, filled: true };
    }
    default:
      return { value: null, filled: false };
  }
}

export function parseIntake(mdText) {
  const { raw } = parseForm(mdText);
  const warnings = [];
  const filled = {}, empty = [];
  for (const field of FIELDS) {
    const { value, filled: isFilled } = extractOne(field, raw[field.key], warnings);
    if (isFilled) filled[field.key] = value; else empty.push(field.key);
  }

  // ── 모순 경고 ──────────────────────────────────────────
  if (filled.timeAllocation && filled.minutes) {
    const { intro, develop, wrap } = filled.timeAllocation;
    if ([intro, develop, wrap].every(n => n != null)) {
      const sum = intro + develop + wrap;
      if (sum !== filled.minutes) warnings.push({ code: 'W-TIME', msg: `시간 배분 합 ${sum}분이 수업 시간 ${filled.minutes}분과 다릅니다` });
    }
  }
  if (filled.slidesCount && filled.slidesCount[0] > filled.slidesCount[1]) warnings.push({ code: 'W-RANGE', msg: '슬라이드 장수의 최소값이 최대값보다 큽니다' });
  if (filled.slidesCount && (filled.slidesCount[0] < 8 || filled.slidesCount[1] > 20)) warnings.push({ code: 'W-GATE', msg: `슬라이드 장수 ${filled.slidesCount[0]}~${filled.slidesCount[1]}장이 게이트 기준(8~20장)을 벗어납니다` });
  if (filled.worksheetQCount && filled.worksheetQCount[0] > filled.worksheetQCount[1]) warnings.push({ code: 'W-RANGE', msg: '활동지 문항 수의 최소값이 최대값보다 큽니다' });
  if (filled.worksheetQCount && (filled.worksheetQCount[0] < 5 || filled.worksheetQCount[1] > 14)) warnings.push({ code: 'W-GATE', msg: `활동지 문항 수 ${filled.worksheetQCount[0]}~${filled.worksheetQCount[1]}개가 게이트 기준(5~14개)을 벗어납니다` });
  if (filled.imageCount != null && filled.slidesCount && filled.imageCount > filled.slidesCount[1]) warnings.push({ code: 'W-IMG', msg: `AI 이미지 사용 상한(${filled.imageCount})이 슬라이드 최대 장수(${filled.slidesCount[1]})보다 많아 사실상 상한이 없는 것과 같습니다` });
  if (filled.hasEssay === 'no' && filled.worksheetTypes?.includes('short')) warnings.push({ code: 'W-ESSAY', msg: '서술형 문항을 넣지 말라고 했는데 활동지 문항 유형에 서술형이 체크되어 있습니다' });
  if (filled.mustExclude) {
    const nrm = s => String(s).replace(/\s+/g, '').toLowerCase();
    const against = [...(filled.mustInclude || []).map(v => [v, '반드시 넣을 것']), ...(filled.keyTerms || []).map(v => [v, '핵심 개념·낱말'])];
    for (const excl of filled.mustExclude) {
      const hit = against.find(([v]) => nrm(v) === nrm(excl));
      if (hit) warnings.push({ code: 'W-CONFLICT', msg: `"${excl}"가 넣지 말 것과 ${hit[1]}에 모두 있습니다` });
    }
  }
  if (filled.standards && filled.standards.length < 10) warnings.push({ code: 'W-STANDARDS', msg: '성취기준 원문이 너무 짧아 보입니다 — 문장 전체를 붙여넣었는지 확인하세요' });
  if (filled.profile === 'evidence' && filled.titleStyle === 'question') warnings.push({ code: 'W-PROFILE-TITLE', msg: '증거 중심(evidence) 스타일은 메시지형·명사형 제목이 어울립니다 — 질문형 제목은 이 프로파일의 절제된 저작 규칙과 어긋날 수 있습니다' });
  if (filled.quizCount != null && filled.slidesCount) {
    const maxQuiz = filled.slidesCount[1] / 4;
    if (filled.quizCount > maxQuiz) warnings.push({ code: 'W-QUIZ-DENSE', msg: `형성평가 개수(${filled.quizCount})가 슬라이드 장수(최대 ${filled.slidesCount[1]}장)에 비해 많습니다(대략 4장당 1개 권장)` });
  }

  const level = filled.schoolLevel || null;
  const meta = { level, grade: filled.grade || null, subject: filled.subject || null, unit: filled.unit || null, lesson: filled.lesson || null, minutes: filled.minutes ?? null };

  return {
    filled, empty,
    mustInclude: filled.mustInclude || [],
    mustExclude: filled.mustExclude || [],
    facts: filled.facts || [],
    counts: {
      slides: filled.slidesCount || null,
      quiz: filled.quizCount ?? null,
      worksheetQuestions: filled.worksheetQCount || null,
      images: filled.imageCount ?? null,
    },
    profile: filled.profile || null,
    tone: filled.tone || null,
    meta,
    objectives: filled.objectives || [],
    standards: filled.standards || null,
    keyTerms: filled.keyTerms || [],
    excludeScope: filled.excludeScope || [],
    priorKnowledge: filled.priorKnowledge || null,
    misconceptions: filled.misconceptions || [],
    flow: { model: filled.model || null, hookIdea: filled.hookIdea || null, activityMode: filled.activityMode || null, materials: filled.materials || [], timeAllocation: filled.timeAllocation || null },
    assessment: { quizStyle: filled.quizStyle || null, quizCount: filled.quizCount ?? null, worksheetQCount: filled.worksheetQCount || null, worksheetTypes: filled.worksheetTypes || [], difficulty: filled.difficulty || null, hasEssay: filled.hasEssay || null },
    style: { slidesCount: filled.slidesCount || null, profile: filled.profile || null, titleStyle: filled.titleStyle || null, tone: filled.tone || null, imageCount: filled.imageCount ?? null, imageUse: filled.imageUse || null, accentColor: filled.accentColor || null },
    reference: { textbookPages: filled.textbookPages || null, facts: filled.facts || [], material: filled.referenceMaterial || null },
    deliverables: filled.deliverables || [],
    etcRequest: filled.etcRequest || null,
    warnings,
  };
}

function summarize(intake) {
  const total = FIELDS.length;
  const nFilled = total - intake.empty.length;
  const lines = [];
  lines.push(`채운 항목 ${nFilled}개 / AI가 정할 항목 ${intake.empty.length}개 (전체 ${total}개)`);
  const stars = FIELDS.filter(f => f.star).map(f => f.key);
  const starMissing = stars.filter(k => intake.empty.includes(k));
  if (starMissing.length) lines.push(`★ 표시 중 비어 있음: ${starMissing.join(', ')} — 채우면 결과가 크게 좋아집니다`);
  if (intake.warnings.length) {
    lines.push(`경고 ${intake.warnings.length}건:`);
    for (const w of intake.warnings) lines.push(`  ! [${w.code}] ${w.msg}`);
  }
  return lines.join('\n');
}

// ── --check: 반영 여부 되짚어 확인 ──────────────────────────
const plain = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\*\*|==|\{\{|\}\}/g, ' ');
const norm = s => plain(s).toLowerCase().replace(/[\s.,!?~()\[\]{}"'`·—\-–:：;]/g, '');
function tokenOverlap(needle, hay) {
  const nt = String(needle).split(/\s+/).map(t => norm(t)).filter(Boolean);
  if (!nt.length) return 0;
  const hayNorm = norm(hay);
  const hit = nt.filter(t => hayNorm.includes(t)).length;
  return hit / nt.length;
}
function fuzzyFound(needle, hay) {
  const nn = norm(needle);
  if (!nn) return { found: false, how: '' };
  if (norm(hay).includes(nn)) return { found: true, how: '문자열 포함' };
  const ratio = tokenOverlap(needle, hay);
  if (ratio >= 0.7) return { found: true, how: `낱말 ${Math.round(ratio * 100)}% 일치` };
  return { found: false, how: `낱말 ${Math.round(ratio * 100)}% 일치(70% 미만)` };
}

function collectHay(lesson) {
  const stringify = v => JSON.stringify(v ?? {});
  const slidesHay = plain(stringify(lesson.slides));
  const worksheetHay = plain(stringify(lesson.worksheet));
  const planHay = plain(stringify(lesson.plan));
  const factsHay = plain((lesson.facts || []).map(f => f.text).join(' '));
  const quizHay = plain(stringify((lesson.slides || []).filter(s => s.type === 'quiz')));
  const compareHay = plain(stringify((lesson.slides || []).filter(s => s.type === 'compare')));
  const notesHay = plain((lesson.slides || []).map(s => s.notes || '').join(' '));
  const summaryHay = plain(stringify((lesson.slides || []).filter(s => ['summary', 'exit'].includes(s.type))));
  // 학생이 실제로 보는 것만: 슬라이드는 notes(발표자 노트)를 뺀 화면 필드, 활동지 전체. 지도안(plan)·notes는 뺀다.
  // (notes는 교사만 보는 대본이고 plan은 교사용 설계 문서라, "화면·활동지에 있어야 한다"는 항목의 증거가 될 수 없다)
  const visibleSlidesHay = plain(stringify((lesson.slides || []).map(({ notes, ...rest }) => rest)));
  const visibleHay = [visibleSlidesHay, worksheetHay].join(' ');
  return { slidesHay, worksheetHay, planHay, factsHay, quizHay, compareHay, notesHay, summaryHay, visibleHay, all: [slidesHay, worksheetHay, planHay].join(' ') };
}

// 빌드된 산출물(out/*.html)의 화면 텍스트. 템플릿이 기본으로 박아 넣는 문구(교사가 안 쓴 것)도
// 여기엔 있으므로, lesson.json 필드만으로는 못 보는 "템플릿 기본 문구"의 말투까지 확인할 수 있다.
function readBuiltText(outDir, files) {
  if (!outDir || !fs.existsSync(outDir)) return '';
  return files.map(f => { const p = path.join(outDir, f); return fs.existsSync(p) ? plain(fs.readFileSync(p, 'utf8')) : ''; }).filter(Boolean).join(' ');
}

function countImages(lesson) {
  let n = 0;
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v.image) n++; Object.values(v).forEach(walk); } };
  walk(lesson.slides);
  return n;
}

export function checkReflection(intake, lesson, outDir) {
  const items = [];
  const push = (key, status, evidence, hint) => items.push({ key, status, evidence: evidence || '', ...(hint ? { hint } : {}) });
  const M = lesson.meta || {};
  const hay = collectHay(lesson);

  // 메타 필드 일치
  const metaEq = (key, want, got, cmp = (a, b) => norm(a) === norm(b)) => {
    if (want == null) return push(key, 'n/a', '', '');
    if (got == null || got === '') return push(key, 'missing', '', `lesson.json meta에 없음`);
    push(key, cmp(want, got) ? 'ok' : 'violated', `요청 "${want}" / lesson.json "${got}"`, cmp(want, got) ? '' : '값이 다릅니다. 교사 입력을 우선하세요');
  };
  metaEq('schoolLevel', intake.filled.schoolLevel, M.level);
  metaEq('grade', intake.filled.grade, M.grade, (a, b) => norm(b).includes(norm(a)) || norm(a).includes(norm(b)));
  metaEq('subject', intake.filled.subject, M.subject);
  metaEq('unit', intake.filled.unit, M.unit, (a, b) => norm(b).includes(norm(a)) || norm(a).includes(norm(b)));
  if (intake.filled.lesson) {
    const m = String(intake.filled.lesson).match(/(\d+)\s*\/\s*(\d+)/);
    const want = m ? `${m[1]}/${m[2]}` : norm(intake.filled.lesson);
    const got = norm(M.lesson || '');
    push('lesson', got.includes(want) || norm(M.lesson || '').includes(want) ? 'ok' : 'violated', `요청 "${intake.filled.lesson}" / lesson.json "${M.lesson}"`);
  } else push('lesson', 'n/a', '');
  metaEq('minutes', intake.filled.minutes, M.minutes, (a, b) => Number(a) === Number(b));

  // 성취기준 원문 (검증)
  if (intake.filled.standards) {
    const texts = (M.standards || []).map(s => s.text || '');
    const hit = texts.find(t => norm(t) === norm(intake.filled.standards));
    if (hit) push('standards', 'ok', '성취기준 text가 원문과 일치');
    else {
      const fz = texts.find(t => fuzzyFound(intake.filled.standards, t).found);
      push('standards', fz ? 'ok' : 'violated', fz ? '거의 일치(사소한 공백/기호 차이)' : `lesson.json standards: ${texts.join(' / ').slice(0, 80)}`, fz ? '' : '성취기준은 원문 그대로 verbatim으로 옮겨야 합니다');
    }
  } else push('standards', 'n/a', '');

  // 학습 목표
  if (intake.objectives.length) {
    const objs = lesson.objectives || [];
    intake.objectives.forEach((o, i) => {
      const hitIdx = objs.findIndex(g => fuzzyFound(o, g).found);
      if (hitIdx >= 0) push(`objectives[${i}]`, 'ok', `→ lesson.objectives[${hitIdx}]: "${objs[hitIdx]}"`);
      else push(`objectives[${i}]`, 'missing', `"${o}"에 해당하는 목표를 lesson.objectives에서 찾지 못함`, '교사가 쓴 목표 문장을 최대한 살려 옮기세요');
    });
  } else push('objectives', 'n/a', '');

  // 핵심 낱말 — 학생이 보는 화면(슬라이드 본문, notes 제외)·활동지에서만 찾는다(지도안·발표자 노트는 인정하지 않음)
  if (intake.keyTerms.length) {
    intake.keyTerms.forEach((t, i) => {
      const found = fuzzyFound(t, hay.visibleHay).found;
      push(`keyTerms[${i}]`, found ? 'ok' : 'missing', found ? `"${t}" 슬라이드 화면/활동지에서 확인` : `"${t}"를 슬라이드 화면·활동지에서 찾지 못함(지도안·발표자 노트는 인정 안 함)`, found ? '' : 'vocab 슬라이드나 concept 포인트, 활동지 개념 정리에 넣으세요');
    });
  } else push('keyTerms', 'n/a', '');

  // mustInclude — 역시 학생이 보는 화면·활동지에서만 찾는다. 지도안 note나 발표자 노트에만 있으면 인정하지 않는다
  // (지도안 note에 문구만 붙여 넣고 실제 자료엔 없는 경우를 "반영됨"으로 잘못 판정하지 않기 위함)
  intake.mustInclude.forEach((m, i) => {
    const r = fuzzyFound(m, hay.visibleHay);
    push(`mustInclude[${i}]`, r.found ? 'ok' : 'missing', `"${m}" — ${r.how}`, r.found ? '' : '해당 내용을 학생이 보는 슬라이드 화면이나 활동지에 명시적으로 넣으세요(지도안 note·발표자 노트만으로는 인정되지 않습니다)');
  });
  // mustExclude는 반대로 지도안·발표자 노트를 포함해 어디에도 없어야 더 엄격하게 본다(그대로 hay.all 사용)
  intake.mustExclude.forEach((m, i) => {
    const r = fuzzyFound(m, hay.all);
    push(`mustExclude[${i}]`, r.found ? 'violated' : 'ok', `"${m}" — ${r.found ? '자료에서 발견됨(제외 요청 위반)' : '자료에 없음(요청대로 제외됨)'}`, r.found ? '해당 내용을 빼거나 다른 표현으로 바꾸세요' : '');
  });

  // 예상 오개념: 퀴즈 오답, compare, notes, summary 중 하나에서 발견.
  // 교사는 오개념을 "…(라)고 생각한다/여긴다/믿는다" 식 믿음 문장으로 적는 경우가 많은데, lesson.json
  // 쪽(quiz 선택지 등)에서는 그 오개념을 단정문(주장)으로 고쳐 쓴다(S5-CHOICE-BELIEF, intake.md 참고).
  // 그래서 대조는 믿음 서술 꼬리를 뗀 "주장" 부분만으로 한다 — 안 떼면 표현 차이로 매번 missing이 난다.
  const stripBeliefSuffix = s => String(s ?? '').replace(/\s*고\s*(?:생각한다|여긴다|믿는다)\.?\s*$/, '').trim();
  intake.misconceptions.forEach((m, i) => {
    const claim = stripBeliefSuffix(m) || m;
    const where = ['quizHay', 'compareHay', 'notesHay', 'summaryHay'].find(k => fuzzyFound(claim, hay[k]).found);
    push(`misconceptions[${i}]`, where ? 'ok' : 'missing', where ? `${where}에서 확인(믿음 서술 "…라고 생각한다" 등은 떼고 대조: "${claim}")` : `"${claim}"을 퀴즈 오답·compare·notes·summary 어디에서도 찾지 못함`, where ? '' : '오개념을 quiz 오답 선택지나 hook/summary에서 단정문으로 바로잡아 넣으세요');
  });

  // 활동 형태
  if (intake.filled.activityMode) {
    const label = reverseLabel('activityMode', intake.filled.activityMode);
    const modeHay = plain(JSON.stringify((lesson.slides || []).filter(s => s.type === 'activity').map(s => s.mode || ''))) + ' ' + hay.planHay;
    const found = fuzzyFound(label, modeHay).found;
    push('activityMode', found ? 'ok' : 'missing', found ? `activity 슬라이드 mode에서 "${label}" 계열 확인` : `activity 슬라이드 mode에 "${label}"이(가) 없음`);
  } else push('activityMode', 'n/a', '');

  // 개수: 퀴즈, 활동지 문항, 슬라이드, 이미지
  const quizN = (lesson.slides || []).filter(s => s.type === 'quiz').length;
  if (intake.filled.quizCount != null) push('quizCount', quizN >= intake.filled.quizCount ? 'ok' : 'violated', `요청 ${intake.filled.quizCount}개 / 실제 ${quizN}개`);
  else push('quizCount', 'n/a', '');

  const wsItems = (lesson.worksheet?.sections || []).flatMap(s => s.items || []).filter(i => !['concept', 'figure', 'passage'].includes(i.type));
  if (intake.filled.worksheetQCount) {
    const [lo, hi] = intake.filled.worksheetQCount;
    push('worksheetQCount', wsItems.length >= lo && wsItems.length <= hi ? 'ok' : 'violated', `요청 ${lo}~${hi}개 / 실제 ${wsItems.length}개`);
  } else push('worksheetQCount', 'n/a', '');

  if (intake.filled.slidesCount) {
    const [lo, hi] = intake.filled.slidesCount;
    const n = (lesson.slides || []).length;
    push('slidesCount', n >= lo && n <= hi ? 'ok' : 'violated', `요청 ${lo}~${hi}장 / 실제 ${n}장`);
  } else push('slidesCount', 'n/a', '');

  // imageCount는 상한(최대 몇 장까지)이지 반드시 채워야 할 개수가 아니다 — 비어 있으면(정책상 상한 없음)
  // n/a로 두어 이미지를 많이 쓴 수업을 --check가 잘못 잡아내지 않는다. 값이 있으면 그 상한을 넘었을 때만 위반.
  if (intake.filled.imageCount != null) {
    const n = countImages(lesson);
    push('imageCount', n <= intake.filled.imageCount ? 'ok' : 'violated', `상한 ${intake.filled.imageCount}장 / 실제 ${n}장`);
  } else push('imageCount', 'n/a', '');

  // worksheetTypes: 요청한 유형이 실제로 쓰였는지
  if (intake.filled.worksheetTypes?.length) {
    const usedTypes = new Set(wsItems.map(i => i.type));
    intake.filled.worksheetTypes.forEach(code => {
      const label = reverseLabel('worksheetTypes', code);
      push(`worksheetTypes[${code}]`, usedTypes.has(code) ? 'ok' : 'missing', usedTypes.has(code) ? `${label} 문항 있음` : `${label} 문항을 찾지 못함`);
    });
  } else push('worksheetTypes', 'n/a', '');

  // 서술형 여부
  if (intake.filled.hasEssay) {
    const hasShort = wsItems.some(i => i.type === 'short');
    if (intake.filled.hasEssay === 'yes') push('hasEssay', hasShort ? 'ok' : 'missing', hasShort ? '서술형(short) 문항 있음' : '서술형 문항이 없음');
    else push('hasEssay', hasShort ? 'violated' : 'ok', hasShort ? '서술형 문항이 있음(제외 요청 위반)' : '서술형 문항 없음(요청대로)');
  } else push('hasEssay', 'n/a', '');

  // 프로필: meta.profile이 요청과 같은지만 본다. evidence의 세부 저작 규칙(공식-근거 인접, 대칭 배치,
  // 절제된 디자인 등 pedagogy.md §10)은 게이트 E1(gate.mjs)이 따로 검사한다 — intake.mjs는 "요청한
  // 프로필이 실제로 meta에 설정됐는지"까지만 확인한다.
  if (intake.filled.profile) {
    const got = M.profile || 'default'; // profile 필드가 없으면 기본값과 같다
    const ok = got === intake.filled.profile;
    push('profile', ok ? 'ok' : 'violated', `요청 "${intake.filled.profile}" / lesson.json meta.profile "${M.profile ?? '(없음 → 기본)'}"`, ok ? '' : 'meta.profile을 요청한 값으로 맞추세요(evidence 세부 규칙은 게이트 E1이 확인)');
  } else push('profile', 'n/a', '');

  // 말투: meta.tone이 있으면 그것과 바로 비교한다(권장 — 템플릿 기본 문구도 이 값을 기준으로 골라지므로
  // 가장 정확하다). 아직 meta.tone이 없는 lesson.json이면 활동지 tip·subtitle·섹션 lead, 슬라이드 lead와,
  // 빌드돼 있으면 실제 출력물(out/*.html — 템플릿이 넣는 기본 문구 포함)의 문장 어미로 추정한다.
  if (intake.filled.tone) {
    if (M.tone) {
      const ok = M.tone === intake.filled.tone;
      push('tone', ok ? 'ok' : 'violated', `요청 "${intake.filled.tone}" / lesson.json meta.tone "${M.tone}"`, ok ? '' : 'meta.tone을 요청한 말투로 맞추세요');
    } else {
      // 청유형("~봅시다"/"~세요"/"~까요")은 두 말투에서 함께 쓰이므로 뺀다. 서술형 종결 어미만 본다.
      // lesson-plan.html은 뺀다 — 지도안의 예상 질문·답(plan.questions)은 교사용 문서 관례로 합쇼체를
      // 쓰는 경우가 흔해서, 학생이 보는 말투(활동지·정답지)와는 다른 register다.
      const HAEYO = /(아요|어요|여요|워요|해요|예요|네요|군요)[.!?]?$/;
      const HAPSYO = /(습니다|입니다|합니다|하십시오)[.!?]?$/;
      const endings = intake.filled.tone === '해요체' ? HAEYO : HAPSYO;
      const otherEndings = intake.filled.tone === '해요체' ? HAPSYO : HAEYO;
      const builtText = readBuiltText(outDir, ['worksheet.html', 'answer-key.html']);
      const sentences = [...(lesson.worksheet?.tip ? [lesson.worksheet.tip] : []), lesson.worksheet?.subtitle, ...(lesson.worksheet?.sections || []).map(s => s.lead), ...(lesson.slides || []).map(s => s.lead)].filter(Boolean).map(s => plain(s).trim());
      if (builtText) sentences.push(...builtText.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean));
      const matches = sentences.filter(s => endings.test(s)).length;
      const mismatches = sentences.filter(s => otherEndings.test(s)).length;
      if (!sentences.length) push('tone', 'n/a', 'meta.tone이 없고, 말투를 판단할 문장(활동지 안내·빌드된 출력물)도 없음');
      else push('tone', mismatches === 0 ? 'ok' : (matches > mismatches ? 'ok' : 'violated'), `meta.tone 없음 — 문장 어미로 추정: ${intake.filled.tone} 어미 ${matches}개, 반대 어미 ${mismatches}개(빌드된 출력물 포함)`, mismatches > 0 ? '활동지·지도안 안내문 어미를 통일하거나 meta.tone을 설정하세요' : '');
    }
  } else push('tone', 'n/a', '');

  // facts 출처 반영
  intake.facts.forEach((f, i) => {
    if (!f.text) return;
    const hit = (lesson.facts || []).find(g => fuzzyFound(f.text, g.text).found);
    if (!hit) push(`facts[${i}]`, 'missing', `"${f.text}"에 해당하는 facts 항목을 찾지 못함`, 'facts 배열에 같은 수치를 출처와 함께 추가하세요');
    else push(`facts[${i}]`, hit.source ? 'ok' : 'violated', hit.source ? `→ facts.${hit.id} (출처: ${hit.source})` : `→ facts.${hit.id}에 출처가 비어 있음`);
  });

  // 준비물(soft)
  if (intake.flow.materials.length) {
    intake.flow.materials.forEach((m, i) => {
      const found = fuzzyFound(m, plain((lesson.plan?.materials || []).join(' '))).found;
      push(`materials[${i}]`, found ? 'ok' : 'missing', found ? `plan.materials에서 확인` : `plan.materials에 "${m}"이(가) 없음`);
    });
  }

  // 수업 모형(soft)
  if (intake.flow.model) push('model', fuzzyFound(intake.flow.model, plain(lesson.plan?.model || '')).found ? 'ok' : 'missing', `plan.model: "${lesson.plan?.model || ''}"`);

  // 산출물(빌드 결과가 있을 때만 확인 가능)
  if (intake.deliverables.length) {
    const wants = { slides: 'slides.html', worksheet: 'worksheet.pdf', answerKey: 'answer-key.pdf', lessonPlan: 'lesson-plan.pdf' };
    if (outDir && fs.existsSync(outDir)) {
      intake.deliverables.forEach(code => {
        const f = wants[code];
        const exists = f && fs.existsSync(path.join(outDir, f));
        push(`deliverables[${code}]`, exists ? 'ok' : 'missing', exists ? `${f} 있음` : `${f} 없음`);
      });
    } else push('deliverables', 'n/a', '아직 빌드되지 않음(out/ 없음) — build.mjs 실행 후 다시 확인하세요');
  } else push('deliverables', 'n/a', '');

  // 시간 배분 희망 vs 지도안 단계별 시간 합
  if (intake.flow.timeAllocation) {
    const ta = intake.flow.timeAllocation;
    const sumStage = st => (lesson.plan?.flow || []).filter(r => r.stage === st).reduce((a, r) => a + (r.minutes || 0), 0);
    const got = { intro: sumStage('도입'), develop: sumStage('전개'), wrap: sumStage('정리') };
    const mism = ['intro', 'develop', 'wrap'].filter(k => ta[k] != null && got[k] !== ta[k]);
    push('timeAllocation', mism.length ? 'violated' : 'ok', `요청 도입${ta.intro ?? '-'}/전개${ta.develop ?? '-'}/정리${ta.wrap ?? '-'}분 · 실제 도입${got.intro}/전개${got.develop}/정리${got.wrap}분`, mism.length ? '지도안 단계별 시간을 요청과 맞추거나, 다르게 한 이유를 교사에게 알리세요' : '');
  } else push('timeAllocation', 'n/a', '');

  // 자동 검증이 어려운 항목: 사람 확인 필요로 명시
  const softNote = (key, cond, hint) => { if (cond) push(key, 'n/a', '자동 검증 어려움 — 사람이 확인', hint); };
  softNote('classSize', intake.filled.classSize, '학급 인원에 맞게 모둠 수·활동 단계가 설계됐는지 직접 확인하세요');
  softNote('classLevel', intake.filled.classLevel, '학급 수준에 맞게 난이도·설명 분량이 조정됐는지 직접 확인하세요');
  softNote('priorKnowledge', intake.priorKnowledge, '사전 지식을 전제로 도입부가 설계됐는지 직접 확인하세요');
  softNote('classNeeds', intake.filled.classNeeds, '지도안 note·평가 기준에 배려 사항이 반영됐는지 직접 확인하세요');
  softNote('difficulty', intake.filled.difficulty, '문항 난이도가 요청과 맞는지 직접 확인하세요');
  softNote('quizStyle', intake.filled.quizStyle, '퀴즈 응답 방식이 notes에 반영됐는지 직접 확인하세요');
  softNote('textbookPages', intake.filled.textbookPages, '해당 쪽수 내용과 상충하지 않는지 직접 확인하세요');
  softNote('excludeScope', intake.excludeScope.length, '제외 범위가 실제로 빠졌는지 직접 확인하세요');
  softNote('hookIdea', intake.flow.hookIdea, 'hook 슬라이드가 아이디어를 살렸는지 직접 확인하세요');
  softNote('imageUse', intake.style.imageUse, '이미지 용도가 요청과 맞는지 직접 확인하세요');
  softNote('accentColor', intake.style.accentColor, 'meta.accent 또는 교과 기본색과 비교해 직접 확인하세요');
  softNote('titleStyle', intake.style.titleStyle, '제목이 메시지형/질문형/명사형 요청과 맞는지 직접 확인하세요');
  softNote('referenceMaterial', intake.reference.material, '기존 자료·참고 슬라이드의 구조(순서·유형)가 설계에 참고됐는지 직접 확인하세요(문장·이미지를 그대로 베끼지 않았는지도)');
  softNote('etcRequest', intake.etcRequest, '자유 요청이 어떤 형태로 반영됐는지 직접 확인하세요(다른 필드로 자동 분류되지 않는 항목)');

  const naItems = items.filter(it => it.status === 'n/a');
  const autoItems = items.filter(it => it.status !== 'n/a');
  const autoBad = autoItems.filter(it => it.status === 'missing' || it.status === 'violated').length;
  const ok = autoBad === 0;
  return {
    ok, items,
    summary: {
      auto: autoItems.length, autoOk: autoItems.length - autoBad, autoBad,
      human: naItems.length, humanItems: naItems.map(it => it.key),
    },
  };
}

// ── CLI ────────────────────────────────────────────────────
function printReport(intake) {
  console.log(summarize(intake));
}
function printCheck(report) {
  const s = report.summary;
  console.log(`\n classforge intake --check\n`);
  console.log(` 자동 확인 ${s.auto}개(통과 ${s.autoOk} · 실패 ${s.autoBad}) / 사람 확인 ${s.human}개(n/a)\n`);
  for (const it of report.items) {
    const mark = { ok: 'PASS', missing: 'FAIL', violated: 'FAIL', 'n/a': ' -- ' }[it.status];
    console.log(` ${mark}  ${it.key.padEnd(24)} ${it.evidence}`);
    if (it.hint) console.log(`        → ${it.hint}`);
  }
  if (s.human) console.log(`\n 사람이 확인해야 할 항목(n/a, ${s.human}개): ${s.humanItems.join(', ')}`);
  console.log(`\n ${report.ok ? 'ALL OK' : 'FAIL'} — 자동 확인 ${s.autoOk}/${s.auto}개 통과, 사람 확인 ${s.human}개 남음${s.autoBad ? `, ${s.autoBad}건 확인 필요` : ''}\n`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--check') {
    const [, formPath, lessonPath, ...rest] = argv;
    if (!formPath || !lessonPath) { console.error('사용: node intake.mjs --check <설계서.md> <lesson.json> [--json report.json]'); process.exit(2); }
    const md = fs.readFileSync(formPath, 'utf8');
    const lesson = JSON.parse(fs.readFileSync(lessonPath, 'utf8'));
    const outDir = path.join(path.dirname(path.resolve(lessonPath)), 'out');
    const intake = parseIntake(md);
    if (intake.warnings.length) {
      console.log(`\n 설계서 자체 경고 ${intake.warnings.length}건(모순·게이트 한도 초과):`);
      for (const w of intake.warnings) console.log(`   ! [${w.code}] ${w.msg}`);
    }
    const report = checkReflection(intake, lesson, outDir);
    printCheck(report);
    const jsonIdx = rest.indexOf('--json');
    if (jsonIdx >= 0 && rest[jsonIdx + 1]) fs.writeFileSync(rest[jsonIdx + 1], JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  const [formPath, ...rest] = argv;
  if (!formPath) { console.error('사용: node intake.mjs <설계서.md> [--json out.json]'); process.exit(2); }
  const md = fs.readFileSync(formPath, 'utf8');
  const intake = parseIntake(md);
  printReport(intake);
  const jsonIdx = rest.indexOf('--json');
  if (jsonIdx >= 0 && rest[jsonIdx + 1]) {
    fs.writeFileSync(rest[jsonIdx + 1], JSON.stringify(intake, null, 2));
    console.log(`\n저장: ${rest[jsonIdx + 1]}`);
  } else {
    console.log('\n' + JSON.stringify(intake, null, 2));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
