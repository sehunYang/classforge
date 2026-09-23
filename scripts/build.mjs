// classforge build — lesson.json → out/ (slides.html, worksheet.pdf, answer-key.pdf, lesson-plan.pdf, shots/)
// 사용: node build.mjs <lesson.json> [--no-pdf] [--no-shots]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SKILL, loadLesson, launch, fileUrl } from './lib.mjs';
import { declarative } from './visuals.mjs';

const args = process.argv.slice(2);
const lessonPath = args.find(a => !a.startsWith('--'));
if (!lessonPath) { console.error('사용: node build.mjs <lesson.json> [--no-pdf] [--no-shots]'); process.exit(2); }
const ctx = loadLesson(lessonPath);
const { lesson: L, out, level, accent, rules } = ctx;
const M = L.meta || {};
fs.mkdirSync(path.join(out, 'shots'), { recursive: true });

// 문체(meta.tone: "해요체"|"합쇼체") — 지정 없으면 초·중은 해요체, 고는 합쇼체(design.md 참고).
// 템플릿의 기본 문자열(작성자가 값을 비웠을 때만 쓰는 것)에만 적용한다. 작성자가 직접 쓴 문장은 손대지 않는다.
const tone = M.tone === '합쇼체' || (M.tone !== '해요체' && level === 'high') ? '합쇼체' : '해요체';
const T = tone === '합쇼체'
  ? { goalsTitle: '이 시간이 끝나면 할 수 있습니다.', quizHint: '생각한 답을 말해 보십시오. 다음 키를 누르면 정답이 나옵니다.', stdPlaceholder: '성취기준을 입력하십시오.' }
  : { goalsTitle: '이 시간이 끝나면 할 수 있어요.', quizHint: '생각한 답을 말해 보세요. 다음 키를 누르면 정답이 나와요.', stdPlaceholder: '성취기준을 입력하세요.' };

// ── 텍스트 도우미 ───────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 수식 인라인 표기: $...$ 안에서 _x/_{..} 첨자, ^x/^{..} 위첨자, \그리스문자, \cdot \times \approx \le \ge \neq \pm.
// 변수(글자)는 이탤릭, 숫자·기호는 .mup(비이탤릭)로 세운다 — Cambria Math 계열 글꼴 스택은 deck.css/print.css의 .math가 지정한다.
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', Theta: 'Θ',
  lambda: 'λ', Lambda: 'Λ', mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', Phi: 'Φ', omega: 'ω', Omega: 'Ω' };
const MATHOP = { cdot: '⋅', times: '×', approx: '≈', le: '≤', ge: '≥', neq: '≠', pm: '±' };
const mathSym = t => t.replace(/\\([A-Za-z]+)/g, (_, w) => GREEK[w] || MATHOP[w] || w);
const mathLeaf = t => mathSym(t).replace(/([⋅×≈≤≥≠±])/g, '<span class="mup">$1</span>').replace(/(\d+(?:\.\d+)?)/g, '<span class="mup">$1</span>');
function mathExpr(expr) {
  const parts = [];
  let work = expr.replace(/([_^])\{([^{}]*)\}|([_^])([A-Za-z0-9])/g, (m, p1, g1, p2, g2) => {
    const p = p1 || p2, g = g1 !== undefined ? g1 : g2;
    const tag = p === '_' ? 'sub' : 'sup';
    parts.push(`<${tag}>${mathLeaf(g)}</${tag}>`);
    return String.fromCodePoint(0xE000 + parts.length - 1);
  });
  work = mathLeaf(work);
  return work.replace(/[-]/g, ch => parts[ch.codePointAt(0) - 0xE000]);
}
const math = s => s.replace(/\$([^$\n]+)\$/g, (_, expr) => `<span class="math">${mathExpr(expr)}</span>`);

// **굵게**, ==형광펜==, *강조색*, $수식$ (esc 뒤에 적용해 새로 만든 태그가 다시 이스케이프되지 않게 한다)
const md = s => math(esc(s)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/==(.+?)==/g, '<mark>$1</mark>')
  .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>').replace(/\n/g, '<br>');
const pad2 = n => String(n).padStart(2, '0');
const tpl = f => fs.readFileSync(path.join(SKILL, 'templates', f), 'utf8');

// 생성 이미지(images.mjs) 임베딩: <lesson dir>/images/manifest.json에서 id로 찾아 web(축소본, 없으면 file 원본)을
// base64로 넣는다. role(hook·cover·concept·background)은 CSS가 칸 채움/풀블리드를 고르는 데 쓴다.
let imageManifest;
function loadImageManifest() {
  if (imageManifest !== undefined) return imageManifest;
  const p = path.join(ctx.dir, 'images', 'manifest.json');
  imageManifest = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  return imageManifest;
}
function embedImage(req, cls, style = '') {
  const manifest = loadImageManifest();
  const entry = manifest?.images?.[req.id];
  if (!entry) throw new Error(`이미지 "${req.id}"가 images/manifest.json에 없음 — 먼저 node scripts/images.mjs를 실행하세요`);
  const rel = entry.web || entry.file;
  const p = rel && path.resolve(ctx.dir, rel);
  if (!p || !fs.existsSync(p)) throw new Error(`이미지 "${req.id}" 파일 없음(${rel || 'manifest에 file/web 없음'}) — 먼저 node scripts/images.mjs를 실행하세요`);
  const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const b64 = fs.readFileSync(p).toString('base64');
  const role = entry.role || req.role || '';
  return `<div class="${cls} img-fill${role ? ` img-role-${role}` : ''}"${style ? ` style="${style}"` : ''}><img src="data:image/${ext};base64,${b64}" alt=""></div>`;
}

function visual(v, cls = 'visual', dims) {
  if (!v) return '';
  const d = declarative(v, dims);
  if (d) return `<div class="${cls}">${d}</div>`;
  if (typeof v === 'string' && v.trim().startsWith('<svg')) return `<div class="${cls}">${v}</div>`;
  if (v && typeof v === 'object' && v.image) return embedImage(v.image, cls);
  const img = typeof v === 'string' ? v : v.src;
  const p = path.resolve(ctx.dir, img);
  if (!fs.existsSync(p)) throw new Error(`이미지 없음: ${img}`);
  const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const b64 = fs.readFileSync(p).toString('base64');
  return `<div class="${cls}"><img src="data:image/${ext};base64,${b64}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:16px" alt=""></div>`;
}

// ── 슬라이드 유형별 렌더러 ───────────────────────────────
const step = s => (s.reveal ? ' data-step' : '');
const R = {
  cover: s => { const bleed = s.visual?.image?.role === 'cover';
    return `<div class="band"></div><div class="body"><div class="left">
      ${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}
      <h1 class="display">${md(s.title || M.title)}</h1>
      ${s.subtitle ? `<p class="subtitle">${md(s.subtitle)}</p>` : ''}
      <div class="meta">${[M.subject && `${M.subject} · ${M.grade || ''}`, M.unit, M.lesson].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>
    </div>${s.visual ? `<div class="right${bleed ? ' bleed' : ''}">${visual(s.visual)}</div>` : ''}</div>`; },
  goals: s => `<div class="body"><div class="kicker">${md(s.kicker || '오늘의 학습 목표')}</div>
      <h2 class="title">${md(s.title || T.goalsTitle)}</h2>
      <ul class="goals">${(s.items || L.objectives || []).map((g, i) => `<li${step(s)}><b>${pad2(i + 1)}</b><span>${md(g)}</span></li>`).join('')}</ul>
      ${s.question ? `<div class="bigq"><span class="q">중심 질문</span><span class="t">${md(s.question)}</span></div>` : ''}</div>`,
  hook: s => `<div class="body"><div class="left">
      ${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<div class="qmark" data-deco aria-hidden="true">?</div>
      <h2 class="question">${md(s.question)}</h2>${s.lead ? `<p class="lead">${md(s.lead)}</p>` : ''}</div>
      <div class="right">${visual(s.visual, 'visual grow')}${s.caption ? `<div class="caption">${md(s.caption)}</div>` : ''}</div></div>`,
  chapter: s => `<div class="body"><div class="no" data-deco>${esc(s.no || '')}</div><h2 class="ctitle">${md(s.title)}</h2>
      ${s.sub ? `<p class="csub">${md(s.sub)}</p>` : ''}</div>`,
  concept: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}
      <h2 class="title">${md(s.title)}</h2>${s.lead ? `<p class="lead">${md(s.lead)}</p>` : ''}
      <div class="cols"><div class="l"><ol class="points" style="--n:${(s.points || []).length}">${(s.points || []).map((p, i) =>
        `<li${step(s)}><div class="h"><b>${pad2(i + 1)}</b><span>${md(p.h)}</span></div>${p.t ? `<div class="t">${md(p.t)}</div>` : ''}</li>`).join('')}</ol></div>
      ${s.visual ? `<div class="r">${visual(s.visual, 'visual grow')}${s.caption ? `<div class="caption">${md(s.caption)}</div>` : ''}</div>` : ''}</div></div>`,
  compare: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<h2 class="title">${md(s.title)}</h2>
      <div class="vs">${[s.left, s.right].map((c, i) => `<div class="side"${i && s.reveal ? ' data-step' : ''}>${c.visual ? visual(c.visual, 'visual', { width: 700, height: 220 }) : ''}<div class="label">${md(c.label)}</div>
        <ul>${(c.items || []).map(t => `<li>${md(t)}</li>`).join('')}</ul></div>`).join('')}</div>
      ${s.note ? `<div class="note"${s.reveal ? ' data-step' : ''}>${md(s.note)}</div>` : ''}</div>`,
  steps: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<h2 class="title">${md(s.title)}</h2>
      <div class="track" style="--n:${(s.steps || []).length}">${(s.steps || []).map((p, i) =>
        `<div class="st${i === (s.hot ?? 0) ? ' hot' : ''}"${i && s.reveal ? ' data-step' : ''}><div class="num">${i + 1}</div>${p.visual ? visual(p.visual, 'visual', { width: 380, height: 260 }) : ''}<div class="h">${md(p.h)}</div>${p.t ? `<div class="t">${md(p.t)}</div>` : ''}</div>`).join('')}</div></div>`,
  diagram: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<h2 class="title">${md(s.title)}</h2>
      ${visual(s.visual)}${s.caption ? `<div class="caption">${md(s.caption)}</div>` : ''}</div>`,
  bignum: s => `<div class="body"><div class="l">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}
      <div class="num">${esc(s.value)}<small class="${/^[°%℃‰]$/.test(s.unit || '') ? 'sym' : ''}">${esc(s.unit || '')}</small></div><h2 class="lbl">${md(s.label)}</h2>
      ${s.caption ? `<p class="cap">${md(s.caption)}</p>` : ''}${s.source ? `<p class="src">자료: ${md(s.source)}</p>` : ''}</div>${s.visual ? visual(s.visual) : ''}</div>`,
  quiz: s => `<div class="body"><div class="kicker">${md(s.kicker || '확인 문제')}</div>
      <h2 class="q">${md(s.question)}</h2>
      ${s.choices ? `<ol class="choices">${s.choices.map((c, i) => `<li class="${i + 1 === s.answer ? 'ok' : ''}"><b>${'①②③④⑤'[i]}</b><span>${md(c)}</span></li>`).join('')}</ol>` : ''}
      <p class="hint">${T.quizHint}</p>
      <div class="ans" data-step><div class="a">정답 ${s.choices ? '①②③④⑤'[s.answer - 1] + ' ' + md(s.choices[s.answer - 1]) : md(s.answer)}</div>${s.explain ? `<div class="e">${md(s.explain)}</div>` : ''}</div></div>`,
  activity: s => `<div class="body"><div class="top"><div><div class="kicker">${md(s.kicker || '활동')}</div><h2 class="title">${md(s.title)}</h2>
        <div class="tags">${s.mode ? `<span>${esc(s.mode)}</span>` : ''}${s.worksheetRef ? `<span class="o">${esc(s.worksheetRef)}</span>` : ''}</div></div>
      <div class="timer" data-sec="${(s.minutes || 5) * 60}"><div class="tv">${pad2(s.minutes || 5)}:00</div><div class="tl">클릭하거나 T 키로 시작</div></div></div>
      <ol>${(s.steps || []).map(t => `<li>${md(t)}</li>`).join('')}</ol>
      ${s.output ? `<div class="out"><span>결과물</span>${md(s.output)}</div>` : ''}</div>`,
  passage: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<h2 class="title">${md(s.title)}</h2>
      <div class="chunks">${(s.chunks || []).map((c, i) => `<div class="chunk${c.hot ? ' hot' : ''}"${i && s.reveal ? ' data-step' : ''}><div class="cl">${md(c.label)}</div><p class="ct">${md(c.text)}</p></div>`).join('')}</div>
      ${s.note ? `<div class="note">${md(s.note)}</div>` : ''}</div>`,
  vocab: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<h2 class="title">${md(s.title || '꼭 알아야 할 낱말')}</h2>
      <div class="terms" style="--n:${(s.terms || []).length}">${(s.terms || []).map(t => `<div class="term"${step(s)}><div class="w">${md(t.term)}${t.en ? `<small>${esc(t.en)}</small>` : ''}</div><div class="d">${md(t.def)}</div></div>`).join('')}</div></div>`,
  timeline: s => `<div class="body">${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}<h2 class="title">${md(s.title)}</h2>
      <div class="line" style="--n:${(s.events || []).length}">${(s.events || []).map(e => `<div class="ev"${step(s)}><div class="dot"></div><div class="when">${md(e.when)}</div><div class="what">${md(e.what)}</div></div>`).join('')}</div></div>`,
  summary: s => `<div class="body"><div class="kicker">${md(s.kicker || '정리')}</div><h2 class="title">${md(s.title)}</h2>
      <ol class="sum">${(s.items || []).map(t => `<li${step(s)}><span>${md(t)}</span></li>`).join('')}</ol>
      ${s.next ? `<div class="next"><b>다음 시간</b><span>${md(s.next)}</span></div>` : ''}</div>`,
  exit: s => `<div class="body"><div class="kicker">${md(s.kicker || '나가기 전에')}</div><h2 class="q">${md(s.question)}</h2>
      ${s.hint ? `<p class="h">${md(s.hint)}</p>` : ''}</div>
      <svg class="deco" data-deco aria-hidden="true" viewBox="0 0 420 160"><path class="d1" d="M10 120 C 80 20, 150 20, 190 90 S 300 150, 410 40"/><circle cx="410" cy="40" r="14" fill="var(--accent-mid)"/></svg>`,
};

function renderDeck(fontCss) {
  const slides = L.slides || [];
  const shortTitle = M.short || M.title;
  const body = slides.map((s, i) => {
    const r = R[s.type];
    if (!r) throw new Error(`알 수 없는 슬라이드 유형: ${s.type} (${i + 1}번)`);
    const novis = (s.type === 'concept' && !s.visual ? ' novis' : '') + (s.type === 'bignum' && s.visual ? ' withvis' : '');
    return `<section class="slide s-${s.type}${novis}" data-i="${i + 1}" data-type="${s.type}" data-notes="${esc(s.notes || '')}">
  <div class="chrome tl" data-chrome><span class="chip"><i></i>${esc(M.subject || '')} · ${esc(M.grade || '')}</span></div>
  <div class="chrome tr" data-chrome>${esc(shortTitle)}</div>
  <div class="chrome bl" data-chrome>${esc([M.unit, M.lesson].filter(Boolean).join(' · '))}</div>
  <div class="chrome br" data-chrome>${pad2(i + 1)} / ${pad2(slides.length)}</div>
  ${r(s)}
  <div class="progress" data-chrome style="width:${((i + 1) / slides.length * 100).toFixed(2)}%"></div>
</section>`;
  }).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(M.title)} — 수업 슬라이드</title>
<style>${fontCss}</style><style>${tpl('deck.css')}</style><style>:root{--accent:${accent};--accent-ink:color-mix(in srgb,${accent} 82%,#000)}</style>
</head><body data-level="${level}" data-profile="${esc(M.profile || 'default')}" data-min-small="${rules.minSmall}" data-min-body="${rules.minBody}"><div id="viewport"><div id="stage">
${body}
</div></div><div id="notes"></div><div id="help">→/Space 다음 · ← 이전 · F 전체화면 · N 노트 · T 타이머</div>
<script>${tpl('deck.js')}</script></body></html>`;
}

// ── 활동지 · 정답지 ─────────────────────────────────────
function renderWorksheet(fontCss, key) {
  const W = L.worksheet || {};
  let qn = 0, bn = 0;
  // 학생용에는 정답 글자를 아예 넣지 않는다 (투명 글자는 PDF에서 복사로 드러난다)
  const blank = (txt) => { bn++; const w = txt.length > 9 ? ' w3' : txt.length > 4 ? ' w2' : ''; return `<span class="blank${w}"><sup>${bn}</sup>${key ? esc(txt) : '&nbsp;'}</span>`; };
  const withBlanks = s => md(s).replace(/\{\{(.+?)\}\}/g, (_, a) => blank(a.replace(/<[^>]+>/g, '')));
  const explain = it => key && it.explain ? `<div class="explain"><b>풀이</b> ${md(it.explain)}</div>` : '';
  const Q = (it, bodyHtml) => { qn++; return `<div class="q" data-obj="${it.obj ?? ''}"><div class="qn">${qn}</div><div class="qt">${md(it.q)}${it.points ? `<span class="pt">(${it.points}점)</span>` : ''}</div><div class="qb">${bodyHtml}${explain(it)}</div></div>`; };
  const items = {
    concept: it => `<div class="concept" data-obj="${it.obj ?? ''}">${String(it.text).split('\n').map(p => `<p>${withBlanks(p)}</p>`).join('')}</div>`,
    choice: it => Q(it, `<ol class="choices" style="--cols:${it.cols || (it.choices.join('').length > 60 ? 1 : 2)}">${it.choices.map((c, i) => `<li class="${key && i + 1 === it.answer ? 'ok' : ''}"><b>${'①②③④⑤'[i]}</b><span>${md(c)}</span></li>`).join('')}</ol>`),
    short: it => Q(it, `<div class="lines">${'<div></div>'.repeat(it.lines || 2)}${key ? `<div class="ans">${md(it.answer || '')}</div>` : ''}</div>`),
    ox: it => Q(it, `<table class="ox">${it.rows.map((r, i) => `<tr><td class="st">(${i + 1}) ${md(r.s)}</td><td class="bx">O<span class="box${key && r.a ? ' on' : ''}"></span> X<span class="box${key && !r.a ? ' on' : ''}"></span></td></tr>`).join('')}</table>`),
    match: it => {
      const n = Math.max(it.left.length, it.right.length);
      const lines = key ? (it.answer || []).map(([a, b]) => `<line x1="0" y1="${(a - .5) / n * 100}%" x2="100%" y2="${(b - .5) / n * 100}%" stroke="${accent}" stroke-width="2.2"/>`).join('') : '';
      const cells = Array.from({ length: n }, (_, k) => `<div class="it l" style="grid-row:${k + 1}">${it.left[k] ? `<span>${md(it.left[k])}</span><i class="dot"></i>` : ''}</div><div class="it r" style="grid-row:${k + 1}">${it.right[k] ? `<i class="dot"></i><span>${md(it.right[k])}</span>` : ''}</div>`).join('');
      return Q(it, `<div class="match">${cells}<svg preserveAspectRatio="none" style="grid-row:1 / ${n + 1}">${lines}</svg></div>`);
    },
    table: it => Q(it, `<table class="tbl"><tr>${it.head.map(h => `<th>${md(h)}</th>`).join('')}</tr>${it.rows.map(r => `<tr>${r.map(c => {
      const m = String(c).match(/^\{\{(.*)\}\}$/);
      return m ? `<td class="c fill">${key ? md(m[1]) : ''}</td>` : `<td class="${String(c).length < 8 ? 'c' : ''}">${md(c)}</td>`;
    }).join('')}</tr>`).join('')}</table>`),
    draw: it => {
      // base: 학생이 그 위에 그리는 바탕(좌표평면 {plot}·백지도 SVG). answer: 정답지에만 그리는 정답 그림(같은 형식).
      const pic = v => v ? (declarative(v, { width: 1360, height: (it.height || 60) * 8 }) || v) : '';
      const base = pic(key && it.answer ? it.answer : it.base);
      const grid = base ? ' based' : '';
      return Q(it, `<div class="draw${grid}" style="height:${it.height || 45}mm">${base ? `<div class="base">${base}</div>` : ''}${key && it.model ? `<div class="model">${md(it.model)}</div>` : ''}${!key && it.placeholder ? `<span class="ph">${esc(it.placeholder)}</span>` : ''}</div>`);
    },
    passage: it => `<div class="passage">${it.title ? `<div class="pt-title">${md(it.title)}</div>` : ''}${String(it.text).split('\n').map((p, i) => `<p><span class="ln">${(it.start || 1) + i}</span><span class="tx">${withBlanks(p)}</span></p>`).join('')}${it.source ? `<div class="pt-src">${md(it.source)}</div>` : ''}</div>`,
    figure: it => {
      // visual은 슬라이드의 visual과 같은 형식(<svg> 문자열 · {plot}/{bars} · {image:{...}})의 별칭이다.
      // svg/image는 예전부터 쓰던 이름이라 그대로 지원한다(하위 호환). 셋 다 없으면 media는 빈 문자열 —
      // S1 게이트(S1-WS-FIGEMPTY)가 이 경우를 잡아 빈 자료 칸이 조용히 나가는 것을 막는다.
      const v = it.visual !== undefined ? it.visual : it.image ? { image: it.image } : it.svg;
      const d = v && declarative(v, { width: 1360, height: (it.height || 60) * 8 });
      // svg/plot/bars는 draw의 base와 같은 방식으로 높이를 고정한 칸에 넣는다 — 세로로 긴 그래프가
      // print.css의 기본 svg{width:100%;height:auto} 규칙 때문에 페이지 폭 전체로 늘어나
      // 글자까지 같이 커지는 것을 막는다(칸 안에서 height:100%로 맞추고 폭은 비율대로 줄인다).
      const media = d ? `<div class="fig-media" style="height:${it.height || 60}mm">${d}</div>`
        : v && typeof v === 'object' && v.image ? embedImage(v.image, 'fig-img', it.height ? `height:${it.height}mm` : '')
        : typeof v === 'string' ? `<div class="fig-media" style="height:${it.height || 60}mm">${v}</div>` : '';
      return `<div class="fig">${media}${it.caption ? `<div class="cap">${md(it.caption)}</div>` : ''}</div>`;
    },
  };
  const head = `<div class="blk"><div class="ws-head"><div><div class="ws-kicker"><i></i>${esc([M.subject, M.grade, M.unit, M.lesson].filter(Boolean).join(' · '))}<span class="keystamp">정답과 풀이</span></div>
      <h1 class="ws-title">${md(W.title || M.title)}</h1>${W.subtitle ? `<p class="ws-sub">${md(W.subtitle)}</p>` : ''}</div>
      <div class="ws-id"><span><b></b>학년</span><span><b></b>반</span><span><b></b>번</span><span>이름</span></div></div>
    <div class="ws-goal"><span class="lb">학습 목표</span><ol>${(L.objectives || []).map(o => `<li>${md(o)}</li>`).join('')}</ol></div></div>`;
  const secs = (W.sections || []).map((sec, si) => {
    const parts = (sec.items || []).map(it => {
      if (!items[it.type]) throw new Error(`알 수 없는 활동지 문항 유형: ${it.type}`);
      return `<div class="blk" style="padding-top:0">${items[it.type](it)}</div>`;
    });
    // 섹션 제목은 첫 문항과 붙여 한 블록으로 (제목만 쪽 끝에 남지 않게)
    const title = `<div class="sec"><span class="n">${pad2(si + 1)}</span><span class="t">${md(sec.title)}</span>${sec.minutes ? `<span class="m">${sec.minutes}분</span>` : ''}</div>${sec.lead ? `<p class="sec-lead">${md(sec.lead)}</p>` : ''}`;
    if (parts.length) parts[0] = parts[0].replace('<div class="blk" style="padding-top:0">', `<div class="blk">${title}`);
    else parts.push(`<div class="blk">${title}</div>`);
    return parts.join('\n');
  }).join('\n');
  const self = `<div class="blk"><div class="sec"><span class="n">✓</span><span class="t">스스로 점검하기</span></div>
    <table class="self"><tr><th>학습 목표</th><th>잘함</th><th>보통</th><th>노력 필요</th></tr>${(L.objectives || []).map(o => `<tr><td>${md(o)}</td><td class="c">○</td><td class="c">○</td><td class="c">○</td></tr>`).join('')}</table>
    ${W.tip ? `<p class="tip">${md(W.tip)}</p>` : ''}</div>`;
  const foot = `${M.title}${key ? ' · 정답과 풀이' : ''}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(M.title)} — ${key ? '정답지' : '활동지'}</title>
<style>${fontCss}</style><style>${tpl('print.css')}</style><style>@page{size:210mm 297mm;margin:0}:root{--accent:${accent};--accent-ink:color-mix(in srgb,${accent} 82%,#000)}</style>
</head><body data-level="${level}" data-profile="${esc(M.profile || 'default')}" class="${key ? 'key' : ''}" data-foot="${esc(foot)}"><div id="flow">${head}\n${secs}\n${self}</div>
<script>${tpl('paginate.js')}</script></body></html>`;
}

// ── 교수·학습 과정안 ────────────────────────────────────
function renderPlan(fontCss) {
  const P = L.plan || {};
  const std = (M.standards || []).map(s => `${s.code ? `<b>${esc(s.code)}</b> ` : ''}${md(s.text)}${s.verified === false ? ' <span style="color:#B45309">(성취기준 원문 확인 필요)</span>' : ''}`).join('<br>');
  const li = a => (a || []).length ? `<ul>${a.map(t => `<li>${md(t)}</li>`).join('')}</ul>` : '';
  const flow = P.flow || [];
  const rows = flow.map((r, i) => {
    const first = i === 0 || flow[i - 1].stage !== r.stage;
    const last = i === flow.length - 1 || flow[i + 1].stage !== r.stage;
    const stageMin = flow.filter(x => x.stage === r.stage).reduce((a, b) => a + (b.minutes || 0), 0);
    return `<tr><td class="stage${first ? ' first' : ''}${last ? ' last' : ''}" data-stage="${esc(r.stage)}">${first ? `${esc(r.stage)}<br><span style="font-weight:600;font-size:8.5pt">(${stageMin}분)</span>` : ''}</td>
      <td><b>${md(r.element)}</b></td>
      <td><span class="who">교사</span>${li(r.teacher)}${r.student?.length ? `<div style="margin-top:1.2mm"><span class="who">학생</span>${li(r.student)}</div>` : ''}</td>
      <td class="min">${r.minutes || ''}</td>
      <td class="mat">${r.material ? `<div><span class="r">▶</span> ${md(r.material)}</div>` : ''}${r.note ? `<div style="margin-top:1mm"><span class="r">※</span> ${md(r.note)}</div>` : ''}</td></tr>`;
  }).join('');
  const blocks = [];
  blocks.push(`<div class="blk" style="padding-top:0"><div class="lp-title"><h1>교수·학습 과정안</h1><span class="s">${esc([M.school, M.teacher && `지도교사 ${M.teacher}`, M.date].filter(Boolean).join(' · '))}</span></div>
    <table class="info"><colgroup><col style="width:22mm"><col style="width:52mm"><col style="width:20mm"><col style="width:52mm"><col style="width:20mm"><col></colgroup><tr><th>교과</th><td>${esc(M.subject)}</td><th>대상</th><td>${esc(M.grade)}</td><th>차시</th><td>${esc(M.lesson || '')} (${esc(M.minutes || '')}분)</td></tr>
    <tr><th>단원</th><td colspan="5">${md(M.unit || '')}</td></tr>
    <tr><th>학습 주제</th><td colspan="5"><b>${md(M.title)}</b></td></tr>
    <tr><th>성취기준</th><td colspan="5">${std || `<span style="color:#B45309">${T.stdPlaceholder}</span>`}</td></tr>
    <tr><th>학습 목표</th><td colspan="5"><ol>${(L.objectives || []).map(o => `<li>${md(o)}</li>`).join('')}</ol></td></tr>
    <tr><th>수업 모형</th><td colspan="3">${md(P.model || '')}</td><th>준비물</th><td>${md((P.materials || []).join(', '))}</td></tr></table></div>`);
  blocks.push(`<div class="blk" data-split="rows" style="padding-top:0"><table class="proc"><colgroup><col style="width:16mm"><col style="width:30mm"><col><col style="width:12mm"><col style="width:62mm"></colgroup>
    <tr><th>단계</th><th>학습 요소</th><th>교수·학습 활동</th><th>시간</th><th>자료(▶) 및 유의점(※)</th></tr>${rows}</table></div>`);
  if (P.evaluation?.length) blocks.push(`<div class="blk"><div class="h2">평가 계획</div><table class="proc" style="margin-top:2mm"><colgroup><col style="width:44mm"><col style="width:26mm"><col><col><col></colgroup>
    <tr><th>평가 요소</th><th>방법</th><th>상</th><th>중</th><th>하</th></tr>${P.evaluation.map(e => `<tr><td><b>${md(e.what)}</b></td><td class="min">${md(e.method)}</td><td>${md(e.criteria?.['상'])}</td><td>${md(e.criteria?.['중'])}</td><td>${md(e.criteria?.['하'])}</td></tr>`).join('')}</table></div>`);
  if (P.questions?.length) blocks.push(`<div class="blk"><div class="h2">예상 질문과 답</div><div class="qa">${P.questions.map(q => `<div><b>Q.</b> ${md(q.q)}<br><b>A.</b> ${md(q.a)}</div>`).join('')}</div></div>`);
  if (P.checkpoint) blocks.push(`<div class="blk"><div class="h2">다음으로 넘어가도 되는 기준</div><div class="check">${md(P.checkpoint)}</div></div>`);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(M.title)} — 교수·학습 과정안</title>
<style>${fontCss}</style><style>${tpl('print.css')}</style><style>@page{size:297mm 210mm;margin:0}:root{--accent:${accent};--accent-ink:color-mix(in srgb,${accent} 82%,#000)}</style>
</head><body class="landscape" data-level="${level}" data-profile="${esc(M.profile || 'default')}" data-foot="${esc(M.title + ' · 교수·학습 과정안')}"><div id="flow">${blocks.join('\n')}</div>
<script>${tpl('paginate.js')}</script></body></html>`;
}

// ── 조립 ────────────────────────────────────────────────
function allText(o) { return typeof o === 'string' ? o : Array.isArray(o) ? o.map(allText).join('') : o && typeof o === 'object' ? Object.values(o).map(allText).join('') : String(o ?? ''); }
const probe = [renderDeck(''), renderWorksheet('', false), renderWorksheet('', true), renderPlan('')].join('') + allText(L);
const charsFile = path.join(out, '.chars.txt');
fs.writeFileSync(charsFile, [...new Set(probe.replace(/<[^>]*>/g, ''))].join(''), 'utf8');
const fontCssFile = path.join(out, '.fonts.css');
const py = process.env.CLASSFORGE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
console.log(execFileSync(py, [path.join(SKILL, 'scripts', 'fonts.py'), charsFile, fontCssFile], { encoding: 'utf8' }).trim());
const fontCss = fs.readFileSync(fontCssFile, 'utf8');

const files = {
  'slides.html': renderDeck(fontCss),
  'worksheet.html': renderWorksheet(fontCss, false),
  'answer-key.html': renderWorksheet(fontCss, true),
  'lesson-plan.html': renderPlan(fontCss),
};
for (const [f, html] of Object.entries(files)) fs.writeFileSync(path.join(out, f), html, 'utf8');
console.log('html:', Object.keys(files).join(', '));

if (!args.includes('--no-pdf') || !args.includes('--no-shots')) {
  const browser = await launch();
  try {
    const shotsDir = path.join(out, 'shots');
    for (const f of fs.readdirSync(shotsDir)) fs.rmSync(path.join(shotsDir, f));
    // 슬라이드 캡처 (모든 단계 공개)
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(fileUrl(path.join(out, 'slides.html')) + '?shot=1');
    await page.evaluate(() => document.fonts.ready);
    const n = await page.evaluate(() => window.__deck.count);
    if (!args.includes('--no-shots')) {
      for (let i = 0; i < n; i++) {
        await page.evaluate(k => window.__deck.show(k), i);
        await page.waitForTimeout(60);
        await page.screenshot({ path: path.join(shotsDir, `slide-${pad2(i + 1)}.png`) });
      }
    }
    if (!args.includes('--no-pdf')) {
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(out, 'slides.pdf'), width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
    }
    await page.close();
    // A4 문서: PDF + 쪽 캡처
    for (const [f, pdf, label] of [['worksheet.html', 'worksheet.pdf', 'worksheet'], ['answer-key.html', 'answer-key.pdf', 'answer-key'], ['lesson-plan.html', 'lesson-plan.pdf', 'lesson-plan']]) {
      const p = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 1.6 });
      await p.goto(fileUrl(path.join(out, f)));
      await p.waitForFunction(() => window.__paged === true);
      if (!args.includes('--no-shots')) {
        const pages = await p.$$('.page');
        for (let k = 0; k < pages.length; k++) await pages[k].screenshot({ path: path.join(shotsDir, `${label}-p${k + 1}.png`) });
      }
      if (!args.includes('--no-pdf')) await p.pdf({ path: path.join(out, pdf), preferCSSPageSize: true, printBackground: true });
      await p.close();
    }
    // 한눈에 보기(컨택트 시트)
    if (!args.includes('--no-shots')) {
      const imgs = fs.readdirSync(shotsDir).filter(f => f.startsWith('slide-')).sort();
      const sheet = `<html><body style="margin:0;background:#2a2b30;font-family:sans-serif"><div style="display:grid;grid-template-columns:repeat(4,480px);gap:16px;padding:16px">${imgs.map(f => `<div><img src="${f}" style="width:480px;display:block"><div style="color:#ccc;font-size:14px;margin-top:4px">${f}</div></div>`).join('')}</div></body></html>`;
      fs.writeFileSync(path.join(shotsDir, 'overview.html'), sheet);
      const p = await browser.newPage({ viewport: { width: 2000, height: 800 } });
      await p.goto(fileUrl(path.join(shotsDir, 'overview.html')));
      await p.screenshot({ path: path.join(shotsDir, 'overview.png'), fullPage: true });
      await p.close();
      fs.rmSync(path.join(shotsDir, 'overview.html'));
    }
  } finally { await browser.close(); }
  console.log('pdf/shots:', path.relative(process.cwd(), out));
}
