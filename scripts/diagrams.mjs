// classforge diagrams — 정밀 도식(기하·광학·회로·입자 모형)과 인라인 수식($...$)을 LaTeX으로 그린다.
// 함수·데이터 그래프는 visuals.mjs(plot/bars)를 그대로 쓴다 — 이 모듈은 "선·기호를 정확히 그려야 하는" 것 전용.
//
// 엔진 우선순위: 이 PC에 설치된 시스템 LaTeX(MiKTeX·TeX Live — latex+dvisvgm)을 먼저 쓰고, 없으면
// node-tikzjax(오프라인 WASM TeX)로 대체한다(findTexBin). 시스템 LaTeX는 dvisvgm --no-fonts로 글자까지
// 전부 벡터 경로(<path>)로 바꿔 주므로 폰트 임베딩·브라우저 글꼴 매칭이 아예 필요 없고 더 정확하다 —
// node-tikzjax는 <text>+font-family로 남아 별도로 폰트를 심어야 한다(그 갈래만 남겨 둔 이유).
// build.mjs가 어느 엔진을 썼는지는 out/.diagram-engine.json에 남긴다.
//
// 구조:
//   1. toTikzSpec(v)        — lesson.json의 {tikz}/{refraction}/{circuit}/{particles}/{geometry}를 받아
//                             TikZ 소스 + 라벨 목록으로 정규화한다(순수 함수, 브라우저·파일 접근 없음).
//   2. prepareDiagrams()    — lesson 전체를 훑어 필요한 도식을 모두 컴파일하고 <lesson>/diagrams/<hash>.svg에
//                             캐시한다(컴파일은 async라 build.mjs가 HTML을 만들기 전에 미리 끝내 둔다).
//   3. lookupDiagramSync()  — build.mjs의 visual()이 그 캐시 파일을 동기로 읽어 쓴다(images.mjs의 manifest
//                             패턴과 같다 — 무거운 작업은 미리, 렌더링은 동기 문자열 조립).
//   4. prepareFormulas()/lookupFormulaSync() — 슬라이드·활동지·지도안 어디에나 있는 인라인 `$...$` 수식을
//                             같은 방식(미리 컴파일 → <lesson>/diagrams/math-<hash>.svg 캐시 → 동기 조회)으로 조판한다.
//
// 한글(과 그 외 비라틴) 글자는 TeX 글꼴에 없으므로 우리가 직접 <text>로 얹는다(design.md 참고) — 네
// 헬퍼(refraction/circuit/particles/geometry)의 한글 라벨(매질 이름, 소자 이름 등)은 그래서 TikZ에
// 넘기지 않고 우리가 겹쳐 그린다. 반대로 수식·라틴 기호 라벨(θᵢ, n₁, 점 이름 A/B/C 등)은 이제 TikZ가
// `\node`로 직접 조판한다(LABEL_TEX_COLOR) — 실제 LaTeX 조판이라 더 정확하고, 시스템 LaTeX면 폰트
// 임베딩도 필요 없다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SKILL, launch } from './lib.mjs';

// ── TeX 엔진 찾기 ────────────────────────────────────────────────────────
// PATH에 있으면 그대로 쓰고, 없으면 흔한 설치 경로를 차례로 본다(교사 PC마다 설치 방식이 다르다).
// CLASSFORGE_TEX_BIN 환경변수로 직접 지정할 수도 있다. 못 찾으면 null(node-tikzjax로 대체).
let TEX_BIN_CACHE;
export function findTexBin() {
  if (TEX_BIN_CACHE !== undefined) return TEX_BIN_CACHE;
  const exe = process.platform === 'win32' ? '.exe' : '';
  const hasBoth = dir => {
    const latex = path.join(dir, `latex${exe}`), dvisvgm = path.join(dir, `dvisvgm${exe}`);
    return (fs.existsSync(latex) && fs.existsSync(dvisvgm)) ? { latex, dvisvgm } : null;
  };
  try {
    execFileSync('latex', ['--version'], { stdio: 'ignore' });
    execFileSync('dvisvgm', ['--version'], { stdio: 'ignore' });
    return (TEX_BIN_CACHE = { latex: 'latex', dvisvgm: 'dvisvgm' });
  } catch { /* PATH에 없음 — 아래 알려진 경로들을 본다 */ }
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = [
    process.env.CLASSFORGE_TEX_BIN,
    path.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),   // MiKTeX(사용자 설치, Windows)
    'C:/Program Files/MiKTeX/miktex/bin/x64',                          // MiKTeX(시스템 설치)
    path.join(home, 'AppData', 'Roaming', 'MiKTeX', 'miktex', 'bin', 'x64'),
    '/Library/TeX/texbin',                                             // TeX Live(macOS, MacTeX)
    '/usr/local/texlive/2025/bin/x86_64-linux', '/usr/local/texlive/2024/bin/x86_64-linux',
    '/usr/bin',                                                        // TeX Live(Linux, apt 등)
  ].filter(Boolean);
  for (const d of dirs) { const r = hasBoth(d); if (r) return (TEX_BIN_CACHE = r); }
  return (TEX_BIN_CACHE = null);
}

// latex(DVI) → dvisvgm(SVG). 임시 폴더에서 실행하고 끝나면 지운다. 실패하면 그대로 throw(호출부가
// node-tikzjax로 대체하거나 CSS 대체로 넘어간다).
function runTexToSvg(texDoc, dvisvgmArgs, bin) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-tex-'));
  const debug = process.env.CF_TIKZ_DEBUG === '1';
  try {
    const texFile = path.join(tmp, 'input.tex');
    fs.writeFileSync(texFile, texDoc, 'utf8');
    if (debug) console.error(`--- tex doc ---\n${texDoc}\n---`);
    try {
      execFileSync(bin.latex, ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${tmp}`, texFile],
        { cwd: tmp, stdio: debug ? 'inherit' : 'pipe' });
    } catch (e) {
      // execFileSync가 던지는 에러의 .message는 "Command failed: ..."뿐이라 실제로 뭐가 틀렸는지(어느
      // 줄, 어떤 LaTeX 에러) 안 보인다 — stdout/stderr(latex의 실제 로그)에서 "!"로 시작하는 에러 줄과
      // 그 위아래 몇 줄을 뽑아 메시지에 붙인다. tikzLibHint(compileOne)가 이 텍스트에서 "Unknown arrow
      // tip"·"I do not know the key" 같은 라이브러리 관련 패턴을 찾으므로, 그 패턴이 실제로 메시지 안에
      // 있어야 힌트가 나온다.
      const log = String(e.stdout || e.stderr || '');
      const lines = log.split(/\r?\n/);
      const errIdx = lines.findIndex(l => l.startsWith('!'));
      const excerpt = errIdx >= 0 ? lines.slice(errIdx, errIdx + 6).join(' ') : log.slice(-400);
      throw new Error(`latex 실패: ${excerpt || e.message}`);
    }
    const svgFile = path.join(tmp, 'output.svg');
    execFileSync(bin.dvisvgm, [...dvisvgmArgs, path.join(tmp, 'input.dvi'), '-o', svgFile],
      { cwd: tmp, stdio: debug ? 'inherit' : 'pipe' });
    return fs.readFileSync(svgFile, 'utf8');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── 색 산티넬: TikZ 색 이름 → 테마 클래스 ──────────────────────────────────
// 실제 그림에는 절대 나오지 않을 값(0xFE00xx)을 골라, 렌더링된 SVG에서 그 값을 찾아 테마 클래스로
// 맞바꾼다. fill과 stroke는 서로 다른 클래스(채움 전용 vs '-s' 선 전용, design.md 관례)로 대응하므로
// 한 도형에 같은 산티넬을 채움+선 둘 다로 쓰지 않는다(예: 채움+테두리 상자는 fill=cfsoft, draw=cfink처럼
// 서로 다른 색을 준다 — diagrams.mjs가 만드는 헬퍼는 이 규칙을 지킨다).
// cfland·cfsea·cfsky: 지도 전용(design.md "SVG 삽화 작성법" 표의 v-land/v-sea/v-sky) — 교과 강조색과
// 무관하게 지도는 늘 이 색을 쓴다. deck.css/print.css에 이미 정의돼 있던 CSS 클래스인데
// SENTINEL/CLASS_FOR에는 빠져 있어서(territory 마이그레이션에서 발견) TikZ에서 cfland 등을 색 이름으로
// 써도 실제로는 아무 테마 클래스로도 안 바뀌었다 — 이제 다른 산티넬과 같은 방식으로 연결한다.
// export하는 이유: scripts/test-diagrams.mjs가 (컴파일 없이 빠르게) "산티넬 이름이 실제로 테마
// 클래스에 연결돼 있나"를 직접 확인한다 — SENTINEL에는 있는데 CLASS_FOR 짝이 없는 사고(이번에 cfland
// 등에서 실제로 있었다: CSS 클래스는 deck.css/print.css에 이미 있었는데 여기 연결이 빠져 있었다)를
// LaTeX을 안 돌리고도 잡는다.
export const SENTINEL = { cfaccent: '#fe0011', cfink: '#fe0012', cfmuted: '#fe0013', cfsoft: '#fe0014', cfland: '#fe0015', cfsea: '#fe0016', cfsky: '#fe0017' };
export const CLASS_FOR = {
  '#fe0011': { fill: 'v-accent', stroke: 'v-accent-s' },
  '#fe0012': { fill: 'v-ink', stroke: 'v-ink-s' },
  // v-muted·v-soft는 채움 전용 테마 클래스라 선(-s) 짝이 없다 — 그 색으로 선을 그리면(권장하지 않음)
  // 점선 보조선 클래스(v-line)로 대신 맞춘다(선이 사라지는 것보다는 낫다).
  '#fe0013': { fill: 'v-muted', stroke: 'v-line' },
  '#fe0014': { fill: 'v-soft', stroke: 'v-line' },
  '#fe0015': { fill: 'v-land', stroke: 'v-land-s' },
  '#fe0016': { fill: 'v-sea', stroke: 'v-sea-s' },
  '#fe0017': { fill: 'v-sky', stroke: 'v-line' },   // v-sky는 선 짝이 없다(하늘은 보통 테두리를 안 그린다)
};
// 라벨 자리 표시 전용 마커 색(테마 클래스 없음) — 좌표만 읽고 지운다. 라벨마다 서로 다른 색을 쓴다:
// dvi2svg는 같은 색·스타일이 연달아 나오면 하나의 <g fill=…>로 묶어버리는데(우리 실제 도형에는 문제
// 없지만) 마커를 전부 같은 색으로 찍으면 여러 개가 한 그룹으로 뭉쳐 마커별로 좌표를 못 읽는다.
const markHex = i => '#fe10' + (i & 0xff).toString(16).padStart(2, '0');

const rad = d => d * Math.PI / 180;
const num = n => Math.round(n * 10000) / 10000;
const ang = (x, y) => Math.atan2(y, x) * 180 / Math.PI;   // 표준수학 각(도, +x축 기준 반시계)
const norm = (x, y) => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; };
// a→b로 스윕하되 항상 최단 방향(|스윕|≤180°)을 골라, arc가 반대로 한 바퀴 도는 사고를 막는다.
function arcBetween(aDeg, bDeg, r) {
  let diff = bDeg - aDeg;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return { start: aDeg, end: aDeg + diff, r, mid: aDeg + diff / 2 };
}
function arcTex(cls, arc) {
  const sx = arc.r * Math.cos(rad(arc.start)), sy = arc.r * Math.sin(rad(arc.start));
  return `\\draw[${cls}, thick] (${num(sx)},${num(sy)}) arc (${num(arc.start)}:${num(arc.end)}:${num(arc.r)});`;
}
function arcLabel(arc, text, cls, off = 0.4, tex) {
  const lr = arc.r + off;
  return { x: num(lr * Math.cos(rad(arc.mid))), y: num(lr * Math.sin(rad(arc.mid))), text, cls: cls || 'v-label-s', anchor: 'middle', tex };
}
// 한글 라벨은 우리가 겹쳐 그리지만(오버레이), 수식·라틴 기호 라벨은 TikZ가 직접 \node로 조판한다
// (design.md "정밀 도식은 TikZ로" 참고) — tex 필드가 있으면 buildTexSource/buildFullTexDocument가
// 마커 대신 \node를 만든다. cls는 그 글자색을 고를 색 산티넬로 대응된다(아래).
const LABEL_TEX_COLOR = { 'v-label': 'cfink', 'v-label-a': 'cfaccent', 'v-label-s': 'cfmuted' };
const texLabel = (x, y, tex, unicodeText, cls, anchor) => ({ x: num(x), y: num(y), text: unicodeText, cls: cls || 'v-label', anchor: anchor || 'middle', tex });

// geometry() 등에서 저작자가 준 라벨 글자가 "글자 하나(+아래첨자+프라임)" 모양의 순수 기호면 자동으로
// TikZ 수식으로 돌린다 — "3cm"처럼 자유 문장인 라벨은 수식 모드로 잘못 조판되면(이탤릭 등) 오히려
// 어색해지므로 그런 경우는 그대로 오버레이(한글 라벨과 같은 경로)로 남긴다.
const HANGUL = /[가-힣]/;
const GREEK_TO_TEX = { α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', θ: '\\theta', λ: '\\lambda', μ: '\\mu', π: '\\pi', φ: '\\phi', ω: '\\omega',
  Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta', Λ: '\\Lambda', Π: '\\Pi', Φ: '\\Phi', Ω: '\\Omega' };
const SUB_TO_TEX = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  ᵢ: 'i', ⱼ: 'j', ₖ: 'k', ₗ: 'l', ₘ: 'm', ₙ: 'n', ₒ: 'o', ₚ: 'p', ᵣ: 'r', ₛ: 's', ₜ: 't', ᵤ: 'u', ᵥ: 'v', ₓ: 'x', ₐ: 'a', ₑ: 'e', ₕ: 'h' };
const SYMBOL_RE = /^([A-Za-zΑ-Ωα-ω])([₀-₉ᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓₐₑₕ]*)(['′])?$/;
function symbolToTex(text) {
  const m = SYMBOL_RE.exec(text);
  if (!m) return undefined;
  const base = GREEK_TO_TEX[m[1]] || m[1];
  const sub = [...m[2]].map(c => SUB_TO_TEX[c] ?? c).join('');
  return base + (sub ? `_{${sub}}` : '') + (m[3] ? "'" : '');
}
const labelAuto = (x, y, text, cls, anchor) => ({ x: num(x), y: num(y), text, cls: cls || 'v-label', anchor: anchor || 'middle', tex: HANGUL.test(text) ? undefined : symbolToTex(text) });
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 헬퍼: refraction (굴절 — 스넬 법칙으로 각도를 정확히 계산) ────────────────
// n1·sinθi = n2·sinθr. **굴절광은 입사광과 진행 방향의 수평 부호가 같다** — 입사광이 2사분면에서
// 원점으로 들어오면(위쪽에서 왼쪽으로 기움) 굴절광은 반드시 4사분면으로 나간다(왼쪽에서 들어와
// 오른쪽 아래로 계속). 법선(수직 점선) 반대편(3사분면)으로 그리면 물리적으로 틀렸다 — 실제로 그런
// 버그가 있었다(design.md 2-3 참고). from:"left"(기본)|"right"로 입사 방향을 고른다.
// 반사광(showReflected)은 입사광과 수평 부호가 같고 수직만 뒤집힌다(같은 매질로 되돌아간다).
// n1>n2이고 입사각이 임계각을 넘으면 전반사(TIR)만 일어난다 — 이때 굴절광은 그리지 않고 반사광만
// (항상, 실선) 그린다. 각 라벨은 법선과 광선 "사이"(호의 이등분선 위, 호보다 조금 바깥)에 놓는다.
function refraction(o) {
  const { n1 = 1, n2, incidentDeg, media = [], showReflected = false, from = 'left', L = 2.3, arcR = 0.55 } = o;
  if (!(n2 > 0) || !(incidentDeg >= 0)) throw new Error('refraction: n2, incidentDeg가 필요합니다');
  const sgn = from === 'right' ? -1 : 1;   // 입사광이 원점으로 "들어오는" 진행 방향의 수평 부호
  const sinThetaR = n1 / n2 * Math.sin(rad(incidentDeg));
  const tir = sinThetaR > 1;   // 전반사: n1>n2이고 입사각이 임계각을 넘어 굴절각이 정의되지 않음
  const thetaR = tir ? null : Math.asin(sinThetaR) * 180 / Math.PI;
  const src = [], labels = [];
  src.push(`\\draw[cfink] (${-L},0) -- (${L},0);`);
  src.push(`\\draw[cfink, dashed, thin] (0,${num(-L * 0.92)}) -- (0,${num(L * 0.92)});`);
  // 입사광: source(원점 반대 방향)→원점. source 위치 = (-sgn·sinθi, cosθi)·L.
  const iDir = [-sgn * Math.sin(rad(incidentDeg)), Math.cos(rad(incidentDeg))];
  const iPt = iDir.map(v => num(v * L * 0.85));
  src.push(`\\draw[cfaccent, thick, -{Stealth[scale=1.6]}] (${iPt[0]},${iPt[1]}) -- (0,0);`);
  const incArc = arcBetween(90, ang(...iDir), arcR);
  src.push(arcTex('cfaccent', incArc));
  labels.push(arcLabel(incArc, 'θᵢ', 'v-label-a', 0.4, '\\theta_i'));
  // 반사광: 원점→(sgn·sinθi, cosθi)·L(입사광과 수평 부호 같음, 수직만 반전). 전반사면 유일한 출력광이라
  // showReflected와 무관하게 항상 그리고, 실선·강조색으로(부분 반사와 시각적으로 구별한다).
  const fDir = [sgn * Math.sin(rad(incidentDeg)), Math.cos(rad(incidentDeg))];
  if (showReflected || tir) {
    const fLen = tir ? 0.85 : 0.7, reflCls = tir ? 'cfaccent' : 'cfmuted';
    const fPt = fDir.map(v => num(v * L * fLen));
    src.push(`\\draw[${reflCls}, thick, ${tir ? '' : 'dashed, '}-{Stealth[scale=1.6]}] (0,0) -- (${fPt[0]},${fPt[1]});`);
    const refl = arcBetween(90, ang(...fDir), arcR * (tir ? 1 : 0.75));
    src.push(arcTex(reflCls, refl));
    labels.push(tir ? arcLabel(refl, 'θᵢ', 'v-label-a', 0.4, '\\theta_i') : arcLabel(refl, 'θᵢ′', 'v-label-s', 0.32, "\\theta_i'"));
  }
  // 굴절광(전반사가 아닐 때만): 원점→(sgn·sinθr, -cosθr)·L — 수평 부호가 입사광과 "같다"(여기가
  // 예전 버그: -sgn을 잘못 써서 반대쪽 3사분면으로 나갔었다).
  if (!tir) {
    const rDir = [sgn * Math.sin(rad(thetaR)), -Math.cos(rad(thetaR))];
    const rPt = rDir.map(v => num(v * L * 0.85));
    src.push(`\\draw[cfaccent, thick, -{Stealth[scale=1.6]}] (0,0) -- (${rPt[0]},${rPt[1]});`);
    const refArc = arcBetween(-90, ang(...rDir), arcR);
    src.push(arcTex('cfaccent', refArc));
    labels.push(arcLabel(refArc, 'θᵣ', 'v-label-a', 0.4, '\\theta_r'));
  }
  // 매질 이름 라벨: 광선이 지나가지 않는 "빈" 위·아래 모서리에 둔다 — 입사광의 반대쪽(위쪽 빈 자리)과
  // 굴절광의 반대쪽(아래쪽 빈 자리)은 sgn과 무관하게 항상 계산되므로 from:"left"/"right" 어느 쪽이든,
  // 전반사든 아니든 광선과 겹치지 않는다(이전 버그: 입사광과 "같은" 위쪽 자리에 둬서 광선을 가로질렀다).
  const upperEmptyX = sgn * L * 0.85, lowerEmptyX = -sgn * L * 0.85;
  if (media[0]) labels.push({ x: num(upperEmptyX), y: num(L * 0.22), text: media[0], cls: 'v-label-s', anchor: upperEmptyX > 0 ? 'end' : 'start' });
  if (media[1]) labels.push({ x: num(lowerEmptyX), y: num(-L * 0.22), text: media[1], cls: 'v-label-s', anchor: lowerEmptyX > 0 ? 'end' : 'start' });
  return { src: src.join('\n'), labels, packages: [], tikzLibraries: 'arrows.meta', kind: 'refraction',
    computed: { refractedDeg: tir ? null : Math.round(thetaR * 10) / 10, tir, from } };
}

// ── 헬퍼: circuit (회로 — circuitikz, 직렬·병렬) ──────────────────────────
// 전지(cell)는 아래 변에(긴 가는 선=+ 극성은 circuitikz battery1 기호가 이미 지킨다), 나머지 소자는
// 위 변(직렬)이나 나뉜 가지(병렬)에 순서대로 놓는다. 우리 라벨은 전부 소자 이름을 그 위/아래에
// 겹쳐 놓아(TikZ 글자를 안 쓴다). 나머지(circuitikz 소자 자체) 선은 검정 기본값 그대로 둔다 —
// bipole 내부 선까지 cfink로 강제하면 기호(예: 전류계 원) 일부가 채움으로 덮여 깨지는 경우가 있어,
// 도형은 원래 색(검정=잉크와 사실상 같은 명암비)으로 두고 우리가 그린 전선만 테마색을 입힌다.
// ammeter·voltmeter·galvanometer: circuitikz의 `ammeter`/`voltmeter`는 화살표(가동 코일형) 기호라 우리
// 교과서 관례(동그라미+글자, 화살표 없음)와 다르다 — 화살표 없는 `rmeter, t=A`/`t=V`/`t=G`를 대신 쓴다
// (계기는 전부 "글자 있는 동그라미"). rheostat(가변저항)은 circuitikz `vR`(저항 기호 + 화살표),
// electrode(전극 — 전기분해 등 일반 전극 쌍)는 콘덴서 기호(`C`, 평행판)로 대신한다.
const BIPOLE = { cell: 'battery1', lamp: 'lamp', ammeter: 'rmeter, t=A', voltmeter: 'rmeter, t=V', galvanometer: 'rmeter, t=G', resistor: 'R', rheostat: 'vR', switch: 'switch', electrode: 'C' };
const DEFAULT_LABEL = { cell: '전지', lamp: '전구', ammeter: '전류계', voltmeter: '전압계', galvanometer: '검류계', resistor: '저항', rheostat: '가변저항', switch: '스위치', electrode: '전극', photocell: '광전관' };
// 전지는 항상 (0,0)→(W,0)에 battery1로 그린다(series·parallel 둘 다 이 함수 하나를 쓴다) —
// cell.variable:true("가변 전원"처럼 전압을 바꿀 수 있는 전원)면 그 위에 대각선 화살표를 얹는다.
// circuitikz에는 rheostat(vR)처럼 "가변 전지" 전용 내장 기호가 없어, 가변 소자 표기의 일반 관례
// (기호를 가로지르는 화살표 — vR도 결국 저항 기호 위에 이 화살표를 얹은 것)를 손으로 그린다.
function drawCellSymbol(cell, W) {
  const src = [`\\draw[cfink] (0,0) to[battery1] (${num(W)},0);`];
  if (cell.variable) {
    const mid = num(W / 2), d = 0.38;
    src.push(`\\draw[cfaccent, thick, -{Stealth[scale=1.1]}] (${num(mid - d)},${num(-d)}) -- (${num(mid + d)},${num(d)});`);
  }
  return src.join('\n');
}
// 계기 세 종류(전류계·전압계·검류계)는 서로 다른 기호(A/V/G)라 라벨도 반드시 자기 종류를 가리켜야
// 한다 — ammeter에 "검류계"처럼 다른 계기 이름을 주면(실제로 있었던 실수: A로 그려 놓고 "검류계"라고
// 적음) 그림과 글이 어긋난다. label을 아예 안 주면 DEFAULT_LABEL로 자동 채워지므로 문제없고, "전류계
// 1"처럼 자기 종류 이름에 번호만 붙이는 것도 된다 — 오직 "다른 계기의 이름이 들어간 경우"만 막는다.
const METER_LABEL = { ammeter: '전류계', voltmeter: '전압계', galvanometer: '검류계' };
function circuitBipole(el) {
  const bip = BIPOLE[el.type];
  if (!bip) throw new Error(`circuit: 알 수 없는 소자 type "${el.type}" (${Object.keys(BIPOLE).join('|')}|photocell)`);
  if (METER_LABEL[el.type] && el.label) {
    for (const [otherType, otherName] of Object.entries(METER_LABEL)) {
      if (otherType !== el.type && el.label.includes(otherName)) {
        throw new Error(`circuit: ${el.type}(${METER_LABEL[el.type]})에 label "${el.label}"을 줬는데 ${otherType}(${otherName}) 이름과 모순됩니다 — 그림(기호)과 글자가 어긋나면 안 됩니다. "${METER_LABEL[el.type]}"나 "${METER_LABEL[el.type]} 1"처럼 자기 종류 이름을 쓰세요`);
      }
    }
  }
  return bip;
}
// ── 광전관(photocell): circuitikz에 없는 기호라 손으로 그린다 ──────────────
// 진공관(원)+한쪽엔 곡면 음극(광전자가 나오는 큰 판)+반대쪽엔 직선 양극(가는 막대)+선택적 입사광
// 화살표. 극성은 el.cathode("-"|"+", 기본"-")로 정한다 — 음극이 전지의 어느 극에 연결되는지를
// 뜻하고, el.reverse:true면 뒤집는다(정지 전압 실험처럼 광전자를 감속시키려면 극성을 반대로 놓는다 —
// design.md 참고). 우리 회로는 항상 (0,0)→(W,0)로 battery1을 그리는데, circuitikz battery1은
// "시작점 쪽(x가 작은 쪽)이 +, 끝점 쪽(x가 큰 쪽)이 -"다(실측 확인 — 긴 가는 선이 + 쪽에 나온다).
// 소자는 그 top 배선(직렬) 위나 가지(병렬) 위에서 왼쪽 끝(x0)이 항상 +쪽 마디, 오른쪽 끝(x1)이 항상
// -쪽 마디에 물린다(가운데 다른 소자가 몇 개 있어도 마찬가지 — 직렬 고리라 좌우가 바뀌지 않는다).
// 그래서 "음극이 -"면 음극을 오른쪽(x1 쪽)에, "+"면 왼쪽(x0 쪽)에 그린다 — 라벨(음극/양극)은 이
// 판정에서 그대로 파생되므로 서로 모순될 수 없다(사용자가 라벨 텍스트를 따로 못 준다).
function photocellSymbol(x0, x1, H, el) {
  let cathode = el.cathode === '+' ? '+' : '-';
  if (el.reverse) cathode = cathode === '-' ? '+' : '-';
  const cathodeOnLeft = cathode === '+';   // 왼쪽(x0)=+ 마디이므로, 음극이 +쪽이면 왼쪽에 그린다
  const mid = num((x0 + x1) / 2), r = 0.85;
  const leadL = num(mid - r), leadR = num(mid + r);
  const cx = num(cathodeOnLeft ? mid - 0.5 : mid + 0.5);
  const ax = num(cathodeOnLeft ? mid + 0.5 : mid - 0.5);
  const bend = cathodeOnLeft ? 'bend right' : 'bend left';   // 진공관 안쪽 벽 쪽으로(중심에서 먼 쪽으로) 볼록하게
  const src = [
    `\\draw[cfink] (${x0},${H}) -- (${leadL},${H});`,
    `\\draw[cfink] (${leadR},${H}) -- (${x1},${H});`,
    `\\draw[cfink] (${mid},${H}) circle (${r});`,
    // 음극: 곡면(오목한 큰 판, 광전자 방출면)
    `\\draw[cfaccent, thick] (${cx},${num(H + 0.45)}) to[${bend}=55] (${cx},${num(H - 0.45)});`,
    `\\draw[cfink] (${cathodeOnLeft ? leadL : leadR},${H}) -- (${cx},${H});`,
    // 양극: 직선 막대(음극보다 작게 — 실제 광전관처럼)
    `\\draw[cfink, thick] (${ax},${num(H + 0.32)}) -- (${ax},${num(H - 0.32)});`,
    `\\draw[cfink] (${cathodeOnLeft ? leadR : leadL},${H}) -- (${ax},${H});`,
  ];
  // 음극/양극 라벨: "관 중심에서 가로로 밀어 관 밖으로 빼는" 방식(이전 시도)은 라벨이 2글자라
  // 상자가 넓어서, 반지름을 살짝 넘겨도 실측(getBoundingClientRect)하면 그 글자 상자 모서리가
  // 관 테두리나 자기 쪽 전극판 곡선(bend 곡선은 cx보다 더 바깥까지 볼록하게 튀어나온다)에 그대로
  // 걸렸다(B2-CROSS 실사고, release/photoelectric 11번) — "점 하나가 원 밖"과 "글자 상자 전체가
  // 원·곡선 밖"은 다른 조건인데 전자만 계산했던 게 원인이다. 그래서 가로 위치는 아예 손대지 않고
  // (전극과 x가 같아 어느 라벨인지 헷갈릴 일이 없다) 세로로만 관 밑에 둔다.
  // r+0.3까지 좁혀 봤지만(실측으로 확인: 어센트가 위로 뻗는 "관 밑" 배치는 원 경계(dx=0.5에서
  // H-0.6875)까지 어센트(~0.45단위)가 다시 파고들 여유가 필요해 r+0.3(점 기준 여유 0.40)로는
  // 부족했다 — 실제 gate.mjs B2-CROSS 재발로 확인) r+0.5로 되돌린다. "관 바로 밑"을 더 좁히려면
  // 전극 x(0.5)에서 살짝 더 바깥으로(원 경계가 낮아지는 방향) 밀어야 하는데, 그러면 음극·양극이
  // "그 전극 것"이라는 정렬을 깨므로 하지 않는다 — 대신 series 쪽 H를 넉넉히 잡아(아래 참고)
  // "가깝다는 느낌"을 그림 비율로 맞춘다.
  const labelDy1 = num(r + 0.5);
  const labels = [
    { x: cx, y: num(H - labelDy1), text: '음극', cls: 'v-label-s', anchor: 'middle' },
    { x: ax, y: num(H - labelDy1), text: '양극', cls: 'v-label-s', anchor: 'middle' },
  ];
  // 이름표("광전관")는 그 밑에 한 줄 더 두고 정중앙에 둔다. "관 자체에 붙이자"고 위로 옮겨 봤지만
  // (v13 초안) 병렬에서는 그 자리가 바로 위 가지의 기본 라벨 자리(branchGap의 절반 지점)와 겹쳤다
  // (실측 B2-TEXTOVERLAP: "광전관"↔"전압계") — branchGap이 아무리 넉넉해도 "위"는 다음 가지가
  // 쓰는 자리라 안전하지 않다. 그래서 다시 "밑"으로 되돌리되, 이 자리가 전지 배선(y=0)을 넘지
  // 않도록 호출부(series)가 H를 충분히 크게 잡는다(아래 circuitSeries 참고) — photocellSymbol은
  // H가 곧 "이 소자 줄에서 그 아래 배선까지의 거리"라고 가정한다(series는 실제로 그렇고, parallel은
  // branchGap 자체가 늘 넉넉해 이 가정이 항상 성립한다).
  const outDir = cathodeOnLeft ? -1 : 1;   // 음극이 있는 쪽 — "빛" 라벨을 그 반대쪽으로 밀 때 참고
  labels.push({ x: mid, y: num(H - labelDy1 - 0.9), text: el.label || DEFAULT_LABEL.photocell, cls: 'v-label-s', anchor: 'middle' });
  if (el.light !== false) {
    // 입사광: 진공관 바깥 위쪽에서 음극(광전자가 나오는 판) 쪽으로 — 유리관을 뚫고 들어가는 것처럼
    // 관 경계(반지름 r) 안쪽까지 화살표가 이어진다(실제로 빛은 유리를 통과하므로 맞는 표현이다).
    // "빛" 라벨은 화살표 위에 얹지 않고 화살표 중간 높이 옆에 놓는다 — 위에 쌓으면 이름표
    // ("광전관")를 놓을 자리와 부딪힌다(실제로 겪은 문제). 옆으로 미는 양(0.32)은 일부러 작게
    // 잡았다 — 병렬 배치에서는 이 소자 칸이 가지의 맨 끝(가지 갈림점 바로 옆)일 수 있어 관에서
    // x0까지의 실제 여유가 좁고(실측 ~0.86단위), 글자 1자 폭(~0.38단위)까지 더하면 이전 값(0.6)은
    // 그 바깥쪽 진입선을 실측상 넘어섰다(B2-CROSS 실사고).
    const topY = num(H + r + 0.75), botY = num(H + 0.55), midY = num((topY + botY) / 2);
    src.push(`\\draw[cfaccent, thick, -{Stealth[scale=1.4]}] (${cx},${topY}) -- (${cx},${botY});`);
    labels.push({ x: num(cx + outDir * 0.32), y: midY, text: '빛', cls: 'v-label-s', anchor: outDir > 0 ? 'start' : 'end' });
  }
  return { src: src.join('\n'), labels };
}
// series·parallel(주회선·가지) 세 군데 loop가 전부 이 함수 하나로 소자 하나를 그린다 — photocell은
// 손으로 그린 진공관+극성 라벨을, 나머지는 그냥 circuitikz bipole 하나를 낸다. segs에는 이 소자의
// "바깥쪽 두 끝"만 넣는다(photocell 내부 장식선은 좌표를 전부 공유 변수(mid·r)에서 계산해 손으로
// 잘못 옮겨 적을 방법이 없으므로 연결 확인 대상에서 뺀다 — 실제로 검사해야 하는 건 소자가 이웃과
// 맞물리는 바깥쪽 두 마디다, blind3-pe 사고가 난 자리). photocell은 이름표("광전관")까지
// photocellSymbol이 관 자체 기준으로 직접 배치해 innerLabels에 넣으므로 outerLabelText를 안 준다
// (호출부의 기본 위치 H+0.85는 series처럼 H가 작은 배치에서 전지 배선을 넘어가 버린 실사고가
// 있었다 — H에 기대지 않는 자리를 photocellSymbol 안에서 고정으로 정한다).
function drawCircuitElement(el, x0, x1, y, segs) {
  segs.push([[x0, y], [x1, y]]);
  if (el.type === 'photocell') {
    const pc = photocellSymbol(x0, x1, y, el);
    return { src: pc.src, innerLabels: pc.labels, skipOuterLabel: true };
  }
  return { src: `\\draw[cfink] (${x0},${y}) to[${circuitBipole(el)}] (${x1},${y});`, outerLabelText: el.label || DEFAULT_LABEL[el.type], innerLabels: [] };
}
// 헬퍼가 만든 배선이 실제로 다 이어졌는지 빌드 시점에 검증한다 — blind3-pe에서 실제로 있었던 사고
// (손으로 좌표를 옮겨 적다 도선 끝(x=2.6)이 소자 판(x=2.8)에 안 닿음)를 우리 헬퍼가 똑같이 저지르면
// 잡아낸다. segs의 각 항목은 [[x0,y0],[x1,y1]](그 배선의 양 끝) — 각 끝은 자기 배선이 아닌 다른
// 배선의 어느 끝과 0.01 단위 이내로 맞닿아야 한다. export하는 이유: scripts/test-diagrams.mjs가 일부러
// 끊어진 segs를 만들어 이 함수가 실제로 잡아내는지(항상 통과만 하는 게 아닌지) 직접 검증한다.
export function checkCircuitConnectivity(segs, kind) {
  const TOL = 0.01;
  const pts = [];
  segs.forEach((seg, i) => seg.forEach(p => pts.push({ i, p })));
  for (const { i, p } of pts) {
    const ok = pts.some(({ i: j, p: q }) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < TOL);
    if (!ok) throw new Error(`circuit(${kind}): 배선이 끊어져 있습니다 — (${p[0]},${p[1]}) 지점이 다른 배선과 안 이어짐`);
  }
}
function circuit(o) {
  return o.layout === 'parallel' ? circuitParallel(o) : circuitSeries(o);
}
function circuitSeries(o) {
  const els = o.elements || [];
  const cellIdx = els.findIndex(e => e.type === 'cell');
  const cell = cellIdx >= 0 ? els[cellIdx] : null;
  const rest = els.filter((_, i) => i !== cellIdx);
  const n = Math.max(rest.length, 1);
  // photocell은 극성 라벨(음극·양극)과 이름표("광전관")를 관 밑에 두 줄로 쌓는다(photocellSymbol
  // 참고) — 기본 H(1.9)로는 그 두 줄이 전지 배선(y=0)을 넘어가 버렸다(fresh reviewer 실사고:
  // "광전관"이 전지 옆에 놓임, series는 parallel의 branchGap 같은 여유가 없다). photocell이 있을
  // 때만 top rail을 더 높여(H=2.9) 그 두 줄이 들어갈 자리를 만든다 — 없을 때는 기존 그대로 둔다
  // (다른 회로의 비율·B5-VISUAL을 안 건드리려고).
  const hasPhotocell = rest.some(e => e.type === 'photocell');
  const segW = 2.7, H = hasPhotocell ? 2.9 : 1.9, W = segW * n;
  const src = [], labels = [], segs = [];
  // 소자(전지·전구·전류계 등)를 그리는 \draw에도 [cfink]를 줘야 한다 — 안 주면 circuitikz 기본
  // 검정·기본 굵기로 남아 CSS의 v-ink-s 스케일(선 굵기 통일) 대상에서 빠진다(전지 판이 유독 가늘어
  // 보이던 원인).
  // -0.85: concept 슬라이드(칸이 작아 --cf-label-scale이 작게 나오는 쪽)처럼 로컬 단위 라벨이 더 크게
  // 렌더될 때도 전지 기호와 안 겹치도록 여유를 둔다(B2-CROSS 실측으로 확인 — blind2/ohm의 병렬 회로가
  // 더 좁은 -0.9에서도 "전지"가 살짝 걸렸다).
  if (cell) { src.push(drawCellSymbol(cell, W)); labels.push({ x: num(W / 2), y: -0.85, text: cell.label || DEFAULT_LABEL.cell, cls: 'v-label-s', anchor: 'middle' }); }
  else src.push(`\\draw[cfink] (0,0) -- (${num(W)},0);`);
  segs.push([[0, 0], [num(W), 0]]);
  src.push(`\\draw[cfink] (0,0) -- (0,${H});`, `\\draw[cfink] (${num(W)},0) -- (${num(W)},${H});`);
  segs.push([[0, 0], [0, H]], [[num(W), 0], [num(W), H]]);
  if (rest.length) {
    rest.forEach((el, i) => {
      const x0 = num(i * segW), x1 = num((i + 1) * segW);
      const d = drawCircuitElement(el, x0, x1, H, segs);
      src.push(d.src);
      if (!d.skipOuterLabel) labels.push({ x: num((x0 + x1) / 2), y: d.outerLabelY ?? num(H + 0.85), text: d.outerLabelText, cls: 'v-label-s', anchor: 'middle' });
      labels.push(...d.innerLabels);
    });
  } else { src.push(`\\draw[cfink] (0,${H}) -- (${num(W)},${H});`); segs.push([[0, H], [num(W), H]]); }   // 전지만 있는 회로(소자 없음) — 위 변을 그냥 도선으로
  checkCircuitConnectivity(segs, 'series');
  return { src: src.join('\n'), labels, packages: ['circuitikz'], tikzLibraries: '', kind: 'circuit' };
}
// 병렬: 전지 → (선택) 분기 전 주회선 소자(예: 총 전류를 재는 전류계) → 갈림점에서 가지(branches,
// 각각 직렬 소자 목록) 두 개 이상으로 나뉘었다가 → 다시 만나는 점 → 오른쪽 변 → 전지로 돌아온다.
// 가지는 주회선보다 위쪽에 사다리처럼 쌓는다(branches[0]이 주회선 바로 위, 그다음이 그 위…) —
// 라벨은 각 가지 선 "아래"(주회선이나 그 앞 가지 쪽)에 두어 위 가지 선과 안 겹치게 한다.
function circuitParallel(o) {
  const els = o.elements || [];
  const cell = els.find(e => e.type === 'cell') || null;
  const mainEls = els.filter(e => e.type !== 'cell');
  const branches = o.branches || [];
  // branchGap은 가지 사이 간격 — 미터 기호(반지름 ~0.55)가 위아래로 튀어나오고, 슬라이드에
  // 맞춰 축소될 때 --cf-label-scale로 라벨 글자·선 굵기가 로컬 단위 기준 커지므로(디코드 참고:
  // 세로로 긴 병렬 회로는 vbH가 커서 scale이 작아지고, 그만큼 라벨이 로컬 단위로 더 크게 렌더된다),
  // 고정 TikZ 단위 간격은 넉넉하게 잡아야 겹침이 안 생긴다(B2-CROSS로 실측 확인됨).
  // photocell이 있다고 branchGap 자체를 키우진 않는다 — 시도해봤지만 그림이 세로로 더 길어지면서
  // 슬롯(예: 1696×598, 가로로 넓다)에 맞출 때 축소율이 커져 B5-VISUAL(그림이 칸의 30% 미만만 차지)에
  // 새로 걸렸다. 대신 photocellSymbol 안에서 음극·양극 라벨 자체를 관에서 더 떨어뜨리고(bottomGap) 그
  // 두 라벨끼리도 더 벌려서(labelCx/labelAx) 이 branchGap 안에서 해결한다.
  const segW = 2.7, branchGap = 2.6, preGap = 1.1, postGap = 1.1, H = 1.9;
  const splitX = mainEls.length ? preGap + segW * (mainEls.length - 1) + segW : preGap;
  const maxBranchLen = Math.max(1, ...branches.map(b => b.length));
  const joinX = splitX + segW * maxBranchLen;
  const W = joinX + postGap;
  const src = [], labels = [], segs = [];
  // -1.3: concept 슬라이드처럼 칸이 작아 --cf-label-scale이 작을 때(로컬 단위 라벨이 더 크게 렌더)도
  // 여유가 있어야 한다 — blind2/ohm(콘셉트 슬라이드의 병렬 회로)에서 -0.9로는 "전지" 라벨 위쪽이 전지로
  // 내려오는 세로선과 실제로 겹쳤다(B2-CROSS 실측, getBoundingClientRect로 확인).
  if (cell) { src.push(drawCellSymbol(cell, W)); labels.push({ x: num(W / 2), y: -1.3, text: cell.label || DEFAULT_LABEL.cell, cls: 'v-label-s', anchor: 'middle' }); }
  else src.push(`\\draw[cfink] (0,0) -- (${num(W)},0);`);
  segs.push([[0, 0], [num(W), 0]]);
  src.push(`\\draw[cfink] (0,0) -- (0,${H});`, `\\draw[cfink] (${num(W)},0) -- (${num(W)},${H});`);
  segs.push([[0, 0], [0, H]], [[num(W), 0], [num(W), H]]);
  // 분기 전 주회선
  if (mainEls.length) {
    const w = splitX / mainEls.length;
    mainEls.forEach((el, i) => {
      const x0 = num(i * w), x1 = num((i + 1) * w);
      const d = drawCircuitElement(el, x0, x1, H, segs);
      src.push(d.src);
      if (!d.skipOuterLabel) labels.push({ x: num((x0 + x1) / 2), y: d.outerLabelY ?? num(H + 0.85), text: d.outerLabelText, cls: 'v-label-s', anchor: 'middle' });
      labels.push(...d.innerLabels);
    });
  } else { src.push(`\\draw[cfink] (0,${H}) -- (${num(splitX)},${H});`); segs.push([[0, H], [num(splitX), H]]); }
  // 갈림점 이후 오른쪽 변까지
  src.push(`\\draw[cfink] (${num(joinX)},${H}) -- (${num(W)},${H});`);
  segs.push([[num(joinX), H], [num(W), H]]);
  // 가지들: 갈림점(splitX,H)에서 각 가지 높이로 올라갔다가 가지를 지나 다시 내려온다(사다리꼴)
  branches.forEach((branch, bi) => {
    const by = num(H + branchGap * (bi + 1));
    // 라벨은 이 가지 선과 그 아래(이전 가지 또는 주회선) 사이 빈 간격 한가운데 둔다 —
    // 위아래 어느 쪽 미터 기호에도 가깝게 붙지 않도록.
    const labelY = num(by - branchGap / 2);
    src.push(`\\draw[cfink] (${num(splitX)},${H}) -- (${num(splitX)},${by});`);
    src.push(`\\draw[cfink] (${num(joinX)},${H}) -- (${num(joinX)},${by});`);
    segs.push([[num(splitX), H], [num(splitX), by]], [[num(joinX), H], [num(joinX), by]]);
    if (branch.length) {
      const w = (joinX - splitX) / branch.length;
      branch.forEach((el, i) => {
        const x0 = num(splitX + i * w), x1 = num(splitX + (i + 1) * w);
        const d = drawCircuitElement(el, x0, x1, by, segs);
        src.push(d.src);
        if (!d.skipOuterLabel) labels.push({ x: num((x0 + x1) / 2), y: d.outerLabelY ?? labelY, text: d.outerLabelText || `가지 ${bi + 1}`, cls: 'v-label-s', anchor: 'middle' });
        labels.push(...d.innerLabels);
      });
    } else { src.push(`\\draw[cfink] (${num(splitX)},${by}) -- (${num(joinX)},${by});`); segs.push([[num(splitX), by], [num(joinX), by]]); }
  });
  checkCircuitConnectivity(segs, 'parallel');
  return { src: src.join('\n'), labels, packages: ['circuitikz'], tikzLibraries: '', kind: 'circuit' };
}

// ── 헬퍼: particles (입자 모형 — 압축 전/후 비교, 결정적 배치) ─────────────
// arrangement:'grid'는 항상 같은 자리, 'random-fixed-seed'는 seed(기본 1)로 고정된 난수 자리 —
// 같은 lesson.json은 항상 같은 그림이 나온다(캐시 히트와도 맞아떨어진다).
function placeParticles(w, h, count, r, rng, arrangement) {
  const pts = [];
  const m = r * 1.15;
  if (arrangement === 'grid' || count <= 1) {
    const cols = Math.ceil(Math.sqrt(count * w / h)) || 1;
    const rows = Math.ceil(count / cols) || 1;
    const dx = (w - 2 * m) / Math.max(cols - 1, 1), dy = (h - 2 * m) / Math.max(rows - 1, 1);
    for (let i = 0; i < count; i++) {
      const c = i % cols, rIdx = Math.floor(i / cols);
      pts.push([cols > 1 ? m + c * dx : w / 2, rows > 1 ? m + rIdx * dy : h / 2]);
    }
    return pts;
  }
  let tries = 0;
  while (pts.length < count && tries < count * 400) {
    tries++;
    const x = m + rng() * (w - 2 * m), y = m + rng() * (h - 2 * m);
    if (pts.every(([px, py]) => Math.hypot(px - x, py - y) >= 2 * r + 0.06)) pts.push([x, y]);
  }
  while (pts.length < count) pts.push(...placeParticles(w, h, count - pts.length, r, rng, 'grid'));   // 자리가 없으면 격자로 채워 개수는 항상 맞춘다
  return pts;
}
function particles(o) {
  const boxes = o.boxes || [];
  const rng = mulberry32(o.seed ?? 1);
  const src = [], labels = [];
  let cursor = 0;
  for (const box of boxes) {
    const { w, h, count, r = 0.13, label } = box;
    const x0 = box.x ?? cursor, y0 = box.y ?? 0;
    src.push(`\\draw[cfink] (${num(x0)},${num(y0)}) rectangle (${num(x0 + w)},${num(y0 + h)});`);
    for (const [px, py] of placeParticles(w, h, count, r, rng, box.arrangement || 'random-fixed-seed'))
      src.push(`\\fill[cfaccent] (${num(x0 + px)},${num(y0 + py)}) circle (${num(r)});`);
    if (label) labels.push({ x: num(x0 + w / 2), y: num(y0 - 0.42), text: label, cls: 'v-label-s', anchor: 'middle' });
    if (box.x === undefined) cursor = x0 + w + 1.0;
  }
  return { src: src.join('\n'), labels, packages: [], kind: 'particles' };
}

// ── 헬퍼: geometry (도형 — 점·변·각·직각 표시·길이) ───────────────────────
function geometry(o) {
  const points = o.points || [];
  const P = Object.fromEntries(points.map(p => [p.id, p]));
  const cx = points.reduce((s, p) => s + p.x, 0) / (points.length || 1);
  const cy = points.reduce((s, p) => s + p.y, 0) / (points.length || 1);
  const src = [], labels = [];
  for (const s of o.segments || []) {
    const a = P[s.from], b = P[s.to];
    src.push(`\\draw[cfink, thick] (${num(a.x)},${num(a.y)}) -- (${num(b.x)},${num(b.y)});`);
  }
  for (const p of points) {
    src.push(`\\fill[cfink] (${num(p.x)},${num(p.y)}) circle (0.045);`);
    if (p.label !== false && (p.label || p.id)) {
      const [dx, dy] = norm(p.x - cx, p.y - cy);
      labels.push(labelAuto(p.x + dx * 0.42, p.y + dy * 0.42, p.label || p.id, 'v-label'));
    }
  }
  for (const a of o.angles || []) {
    const at = P[a.at], from = P[a.from], to = P[a.to];
    const arc = arcBetween(ang(from.x - at.x, from.y - at.y), ang(to.x - at.x, to.y - at.y), a.r || 0.45);
    const sx = at.x + arc.r * Math.cos(rad(arc.start)), sy = at.y + arc.r * Math.sin(rad(arc.start));
    src.push(`\\draw[cfaccent, thick] (${num(sx)},${num(sy)}) arc (${num(arc.start)}:${num(arc.end)}:${num(arc.r)});`);
    if (a.label) labels.push(labelAuto(at.x + (arc.r + 0.38) * Math.cos(rad(arc.mid)), at.y + (arc.r + 0.38) * Math.sin(rad(arc.mid)), a.label, 'v-label-a'));
  }
  for (const r of o.rightAngles || []) {
    const at = P[r.at], from = P[r.from], to = P[r.to], s = r.size || 0.22;
    const [d1x, d1y] = norm(from.x - at.x, from.y - at.y), [d2x, d2y] = norm(to.x - at.x, to.y - at.y);
    const p1 = [at.x + d1x * s, at.y + d1y * s], p2 = [p1[0] + d2x * s, p1[1] + d2y * s], p3 = [at.x + d2x * s, at.y + d2y * s];
    src.push(`\\draw[cfink] (${num(p1[0])},${num(p1[1])}) -- (${num(p2[0])},${num(p2[1])}) -- (${num(p3[0])},${num(p3[1])});`);
  }
  for (const l of o.lengths || []) {
    const a = P[l.from], b = P[l.to];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const [nx, ny] = [-(b.y - a.y) / len, (b.x - a.x) / len];
    if (l.label) labels.push({ x: num(mx + nx * 0.34), y: num(my + ny * 0.34), text: l.label, cls: 'v-label-s', anchor: 'middle' });
  }
  return { src: src.join('\n'), labels, packages: [], kind: 'geometry' };
}

// ── 헬퍼: vectors (선택 — 화살표 + 크기/방향 라벨) ────────────────────────
function vectors(o) {
  const src = [], labels = [];
  for (const v of o.arrows || []) {
    const from = v.from || [0, 0];
    src.push(`\\draw[${v.style === 'muted' ? 'cfmuted' : 'cfaccent'}, thick, -{Stealth[scale=1.6]}] (${num(from[0])},${num(from[1])}) -- (${num(v.to[0])},${num(v.to[1])});`);
    if (v.label) {
      const mx = (from[0] + v.to[0]) / 2, my = (from[1] + v.to[1]) / 2;
      const len = Math.hypot(v.to[0] - from[0], v.to[1] - from[1]) || 1;
      const [nx, ny] = [-(v.to[1] - from[1]) / len, (v.to[0] - from[0]) / len];
      labels.push({ x: num(mx + nx * 0.3), y: num(my + ny * 0.3), text: v.label, cls: v.style === 'muted' ? 'v-label-s' : 'v-label-a', anchor: 'middle' });
    }
  }
  return { src: src.join('\n'), labels, packages: [], tikzLibraries: 'arrows.meta', kind: 'vectors' };
}

// ── 정규화: lesson.json의 visual 값 → {src, labels, packages, tikzLibraries, kind, width, height} ──
// 이 함수는 순수 함수다(파일·네트워크 접근 없음) — gate.mjs도 이걸 그대로 가져다 써서 라벨 글자를
// S4-NUM(수치 근거) 대조에 포함시킨다(같은 정규화를 두 곳에서 다시 만들지 않는다).
export function toTikzSpec(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.tikz) return { src: v.tikz.src, labels: v.tikz.labels || [], packages: v.tikz.packages || [], tikzLibraries: v.tikz.tikzLibraries || '', kind: 'tikz', width: v.tikz.width, height: v.tikz.height };
  if (v.refraction) return { ...refraction(v.refraction), width: v.refraction.width, height: v.refraction.height };
  if (v.circuit) return { ...circuit(v.circuit), width: v.circuit.width, height: v.circuit.height };
  if (v.particles) return { ...particles(v.particles), width: v.particles.width, height: v.particles.height };
  if (v.geometry) return { ...geometry(v.geometry), width: v.geometry.width, height: v.geometry.height };
  if (v.vectors) return { ...vectors(v.vectors), width: v.vectors.width, height: v.vectors.height };
  return null;
}

// dvisvgm은 <g id='page1'>과 글자 경로 <path id='g0-65'>처럼 문서마다 같은 규칙으로 id를 붙인다 —
// 도식·수식 여러 개가 한 HTML 페이지에 같이 들어가면(우리가 항상 하는 일이다) id가 겹쳐서 <use
// xlink:href="#g0-65">가 자기 문서가 아닌 엉뚱한 도식의 글자를 가리킬 수 있다(B8-DUPID가 잡아낸
// 실측 버그). 캐시에 쓰기 직전에 그 SVG 하나만의 접두어를 모든 id·참조에 붙여 전역에서 유일하게 만든다.
function namespaceIds(svg, prefix) {
  const ids = new Set([...svg.matchAll(/\sid=['"]([^'"]+)['"]/g)].map(m => m[1]));
  let out = svg;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const newId = `${prefix}-${id}`;
    out = out.replace(new RegExp(`id=(['"])${esc}\\1`, 'g'), `id="${newId}"`)
      .replace(new RegExp(`href=(['"])#${esc}\\1`, 'g'), `href="#${newId}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${newId})`);
  }
  return out;
}

function colorPreamble() {
  return Object.entries(SENTINEL).map(([name, hex]) => `\\definecolor{${name}}{HTML}{${hex.slice(1).toUpperCase()}}`).join('\n');
}
// 라벨마다: 한글(오버레이) 라벨이면 지름 0.3pt의 작은 채움점을 서로 다른 색으로 그 tikz 좌표에 찍어
// 둔다(TikZ의 scope·rotate·scale을 우리가 다시 계산하지 않고, 렌더링 후 그 점의 화면 좌표를 읽어
// 우리 <text>를 정확히 겹친다). 수식·라틴 기호 라벨(l.tex가 있음)이면 TikZ가 직접 \node로 조판하게
// 시킨다 — 마커가 필요 없다(위치도 색도 이미 정확하다).
// dvisvgm(DVI 경로 — latex도 node-tikzjax의 WASM tex도 둘 다 DVI를 거친다)은 \fill[...opacity=0.3]로
// 그래픽 상태의 불투명도를 바꾸면 그다음 그리기 명령에도 그 값이 새어 나간다 — PDF ExtGState처럼
// 명령마다 자동으로 안 끊긴다(실제로 겪은 문제: 반투명 땅(0.3) 하나 그렸더니 그 뒤 모든 칠이 같이
// 흐려짐, 곱해져 0.06까지 떨어졌다는 보고). TikZ의 `{...}` 지역 스코프로 감싸도(중괄호) 이 누수는 안
// 막힌다(실측 확인) — 그 명령 바로 뒤에 원시 pgf 명령 `\pgfsetfillopacity{1}`을 직접 넣어야 그래픽
// 상태가 실제로 되돌아간다(이것도 실측 확인, 사용자가 수동으로 하던 그 방법). "opacity=" 키가 있는
// 명령을 전부 찾아 그 명령이 끝나는 세미콜론 바로 뒤에 자동으로 끼워 넣는다 — 저작자가 매번 안 잊어도
// 되게.
const OPACITY_CMD_RE = /\bopacity\s*=\s*[\d.]+[^;]*;/g;
// export하는 이유: scripts/test-diagrams.mjs가 LaTeX 없이 문자열만으로 "opacity= 명령 뒤에 리셋이
// 실제로 끼워지나"를 바로 확인한다(실제 누수 재현·수정 확인은 컴파일이 필요해 느리므로 문자열
// 변환만 빠르게 단위 테스트하고, 진짜 SVG 출력 확인은 이번 작업에서 수동으로 이미 했다).
export function resetFillOpacityLeaks(body) {
  return body.replace(OPACITY_CMD_RE, m => `${m}\n\\pgfsetfillopacity{1}`);
}
function assembleBody(spec) {
  let body = /\\begin\{tikzpicture\}/.test(spec.src) ? spec.src : `\\begin{tikzpicture}\n${spec.src}\n\\end{tikzpicture}`;
  body = resetFillOpacityLeaks(body);
  const labels = spec.labels || [];
  // 색 이름 번호(cfmarkI)는 항상 원본 labels 배열의 인덱스와 맞춘다(postProcess의 markHexes도 같은
  // 인덱스로 만든다) — 수식 라벨을 걸러내고 새로 세면 아래 \fill의 번호와 어긋나 정의 안 된 색을
  // 참조하게 된다(버그였음: filter 후 다시 매긴 인덱스와 extra의 원본 인덱스가 달랐다).
  const markColors = labels.map((l, i) => l.tex ? '' : `\\definecolor{cfmark${i}}{HTML}{${markHex(i).slice(1).toUpperCase()}}`).join('\n');
  const extra = labels.map((l, i) => l.tex
    ? `\\node[${LABEL_TEX_COLOR[l.cls] || 'cfink'}] at (${num(l.x)},${num(l.y)}) {$${l.tex}$};`
    : `\\fill[cfmark${i}] (${num(l.x)},${num(l.y)}) circle (0.15pt);`).join('\n');
  const withExtra = extra ? body.replace(/\\end\{tikzpicture\}\s*$/, `${extra}\n\\end{tikzpicture}`) : body;
  return { markColors, withExtra };
}
// 저수준 {tikz}(design.md "저수준 tikz")를 손으로 쓸 때 tikzLibraries를 깜빡하기 쉽다 — 예:
// -{Stealth[scale=1.6]} 같은 화살촉엔 arrows.meta가 있어야 하는데, 그 필드 자체가 design.md 예시에도
// 없었다(blind3-pe에서 실제로 컴파일이 깨졌다). 매번 안 잊게, 자주 쓰는 라이브러리는 항상 불러온다 —
// 헬퍼(refraction·circuit·particles·geometry·vectors)가 저마다 지정한 tikzLibraries와도 합쳐진다
// (중복은 저절로 걸러진다, TikZ는 이미 불러온 라이브러리를 다시 불러와도 에러 없음). 필요 이상으로
// 몇 개 더 불러와도 컴파일 시간·출력 결과에 실질적 영향은 없다.
const DEFAULT_TIKZ_LIBS = 'arrows.meta,calc,angles,quotes,positioning,decorations.pathmorphing';
function mergeLibs(extra) {
  const set = new Set(DEFAULT_TIKZ_LIBS.split(','));
  for (const lib of String(extra || '').split(',').map(s => s.trim()).filter(Boolean)) set.add(lib);
  return [...set].join(',');
}
// node-tikzjax(대체 엔진)용 — documentclass·usepackage는 node-tikzjax의 texPackages/tikzLibraries
// 옵션으로 따로 넘긴다(README 참고), 그래서 본문에는 안 넣는다.
function buildTexSource(spec) {
  const { markColors, withExtra } = assembleBody(spec);
  return `\\begin{document}\n${colorPreamble()}\n${markColors}\n${withExtra}\n\\end{document}`;
}
// 시스템 LaTeX(주 엔진)용 — 완전한 문서 하나를 직접 만든다(standalone 클래스가 tikz를 자동으로 불러온다).
function buildFullTexDocument(spec) {
  const { markColors, withExtra } = assembleBody(spec);
  const pkgs = (spec.packages || []).map(p => `\\usepackage{${p}}`).join('\n');
  const libs = `\\usetikzlibrary{${mergeLibs(spec.tikzLibraries)}}`;
  return `\\documentclass[tikz]{standalone}\n${pkgs}\n${libs}\n\\begin{document}\n${colorPreamble()}\n${markColors}\n${withExtra}\n\\end{document}`;
}

// 렌더링 방식(색 산티넬 후처리, 라벨 배치, 선 굵기 CSS 등)을 바꿀 때마다 올린다 — 캐시 키에 섞여
// 들어가므로 값을 올리면 예전 규칙으로 그려 둔 <lesson>/diagrams/*.svg가 전부 새로 컴파일된다.
// lesson.json이 안 바뀌어도 diagrams.mjs 자체가 바뀌면 캐시를 무효화해야 하는 경우에 쓴다.
const RENDER_VERSION = 13;   // v3: circuit \draw에 [cfink] 추가(소자·전지 선 굵기를 배선과 통일) / v4: 전지 라벨 여백 확대(concept 슬라이드처럼 작은 칸에서도 안 겹치게), data-engine 속성 추가 / v5: 기본 tikzLibraries(DEFAULT_TIKZ_LIBS) 항상 로드 — 전처리(preamble)가 바뀌므로 캐시 무효화 / v6: circuit에 photocell·rheostat·electrode 추가, 극성 검증·배선 연결 자가진단 / v7: galvanometer 추가, 계기 라벨-종류 모순 검증 / v8: 지도 산티넬(cfland·cfsea·cfsky) 추가, fill-opacity 누수 자동 복구(\pgfsetfillopacity{1}) / v9: photocell 음극·양극 라벨을 관 밑에서 더 떨어뜨리고 서로도 더 벌림(branchGap은 안 건드림) / v10: photocell 라벨 배치 다시 설계(가로로 밀기) — 실측(getBoundingClientRect) 결과 여전히 B2-CROSS 발생 / v11: photocell 라벨 재설계 — 음극·양극은 가로 이동 없이 자기 전극 x 그대로 관 밑(r+0.5)에, "광전관"은 그보다 더 밑, "빛"은 화살표 옆으로 작게(0.32)만 — 실제 렌더 실측(Playwright getBoundingClientRect)으로 여백을 다시 산출해 검증(series·parallel 둘 다 확인) / v12: cell.variable:true — 전지 기호 위에 대각선 화살표를 얹어 "가변 전원" 표시(drawCellSymbol 공통화) / v13: photocell "광전관" 이름표가 series처럼 H가 작은 배치에서 전지 배선 너머로 밀려난 실사고(fresh reviewer) — "관 자체 위(양극 쪽)"로 옮겨 봤더니 이번엔 parallel에서 바로 위 가지의 기본 라벨 자리와 겹쳐(B2-TEXTOVERLAP) 되돌림. 최종: 이름표는 그대로 "관 밑, 음극·양극보다 한 줄 더"(mid, H-r-0.5-0.9) 유지하되 drawCircuitElement의 범용 outerLabel 경로 대신 photocellSymbol이 직접 배치(skipOuterLabel)하고, circuitSeries가 photocell이 있을 때만 H를 1.9→2.9로 높여 그 두 줄이 전지 배선(y=0) 안쪽에 들어가게 함; 음극·양극은 r+0.3까지 좁혀봤지만 실측(gate.mjs)에서 B2-CROSS 재발해 r+0.5로 유지
export function diagramHash(spec) {
  return crypto.createHash('sha256').update(JSON.stringify({ v: RENDER_VERSION, src: spec.src, labels: spec.labels, packages: spec.packages, tikzLibraries: spec.tikzLibraries, kind: spec.kind })).digest('hex').slice(0, 20);
}

// BaKoMa(node-tikzjax 번들, LPPL 문서와 별개로 BaKoMa Fonts Licence — CREDITS.md)를 실제 쓰인
// font-family만 골라 그 도식 SVG 안에 넣는다. 우리 네 헬퍼는 TikZ에 글자를 넘기지 않으므로(위 설명)
// 저수준 {tikz}에서 저작자가 직접 $...$ 수식·라틴 글자를 쓴 경우에만 실제로 들어간다.
const BAKOMA_DIR = path.join(SKILL, 'node_modules', 'node-tikzjax', 'css', 'bakoma', 'ttf');
function embedFonts(svg, families) {
  const rules = families.map(fam => {
    const file = path.join(BAKOMA_DIR, `${fam}.ttf`);
    if (!fs.existsSync(file)) return '';
    return `@font-face{font-family:'${fam}';src:url(data:font/ttf;base64,${fs.readFileSync(file).toString('base64')}) format('truetype');}`;
  }).filter(Boolean).join('');
  return rules ? svg.replace(/^(<svg[^>]*>)/, `$1<defs><style>${rules}</style></defs>`) : svg;
}

async function postProcess(rawSvg, spec, page) {
  await page.setContent(`<!doctype html><html><body style="margin:0">${rawSvg}</body></html>`);
  const fontFamilies = await page.evaluate(() => [...new Set([...document.querySelectorAll('svg text')].map(t => t.getAttribute('font-family')).filter(Boolean))]);
  let svg = await page.evaluate(({ classFor, markHexes, labels }) => {
    const svgEl = document.querySelector('svg');
    // dvisvgm은 width/height를 CSS px(96dpi)로, viewBox는 bp(72dpi)로 써서 width/viewBox 비율이
    // 1이 아니다(보통 4/3) — getCTM()은 "뷰포트"(width/height 기준) 좌표로 돌려주므로 그대로 쓰면
    // 마커 좌표가 4/3배 어긋난다. width/height를 viewBox 크기와 똑같이 맞춰 그 비율을 1로 만든 뒤
    // 좌표를 구한다(이후 어차피 둘 다 지운다 — design.md는 viewBox만 남긴다).
    const vb = svgEl.viewBox.baseVal;
    svgEl.setAttribute('width', vb.width);
    svgEl.setAttribute('height', vb.height);
    // dvi2svg는 채움 하나짜리 도형(예: \fill 점)도 그 <g>에 fill·stroke를 둘 다 적어 넣는다(자손이
    // 실제로 선을 쓰지 않아도) — 그 stroke 값을 곧이곧대로 클래스로 바꾸면 v-*-s의 fill:none이 상속돼
    // 정작 채워야 할 도형이 안 보이게 된다(예: 입자 점). 자손 중 "자기 stroke 속성이 없어(=상속받아)
    // 실제로 선에 쓰는" 그리기 요소가 하나라도 있을 때만 그 stroke 클래스를 붙인다.
    const DRAW_TAGS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
    // el 자신이 그리기 요소면(선택자에 그 stroke 속성 자체로 걸렸다) 항상 참 — 그 속성을 테마 클래스로
    // 덮어써야 한다. el이 <g>면 자손 중 "자기 stroke 속성이 없어(=el한테서 상속) 실제로 선에 쓰는"
    // 그리기 요소가 있는지만 본다(자기 stroke가 있는 자손은 다른 색을 스스로 정한 것이므로 무시).
    const usesInheritedStroke = (el, isRoot = true) => DRAW_TAGS.has(el.tagName)
      ? (isRoot || !el.hasAttribute('stroke'))
      : [...el.children].some(c => usesInheritedStroke(c, false));
    for (const [hex, cls] of Object.entries(classFor)) {
      for (const el of svgEl.querySelectorAll(`[fill="${hex}"],[fill="${hex.toUpperCase()}"]`)) el.classList.add(cls.fill);
      for (const el of svgEl.querySelectorAll(`[stroke="${hex}"],[stroke="${hex.toUpperCase()}"]`)) if (usesInheritedStroke(el)) el.classList.add(cls.stroke);
    }
    const pt = svgEl.createSVGPoint();
    const centerOf = hex => {
      if (!hex) return null;   // 수식·라틴 라벨(tex 모드)은 마커가 없다 — TikZ가 이미 정확한 자리에 그렸다
      const el = svgEl.querySelector(`[fill="${hex}"],[fill="${hex.toUpperCase()}"]`);
      if (!el) return null;
      const bb = el.getBBox(); pt.x = bb.x + bb.width / 2; pt.y = bb.y + bb.height / 2;
      const ctm = el.getCTM();
      const g = ctm ? pt.matrixTransform(ctm) : pt;
      el.remove();
      // getCTM()은 "뷰포트"(viewBox의 min이 (0,0)인 좌표) 기준으로 돌려준다 — path의 d 속성이나
      // 우리가 찍을 <text x y>가 쓰는 viewBox 자체 좌표계로 되돌리려면 viewBox의 min을 다시 더한다.
      return { x: g.x + vb.x, y: g.y + vb.y };
    };
    const centers = markHexes.map(centerOf);
    const NS = 'http://www.w3.org/2000/svg';
    labels.forEach((l, i) => {
      const c = centers[i]; if (!c) return;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', c.x); t.setAttribute('y', c.y);
      t.setAttribute('class', l.cls || 'v-label');
      t.setAttribute('text-anchor', l.anchor || 'middle');
      t.textContent = l.text;
      svgEl.appendChild(t);
    });
    // dvisvgm의 원래 viewBox는 "잉크"(선·채움)에 딱 맞게 빠듯이 잡혀 있다 — 라벨이 그 경계에 걸치면
    // 화면에서 잘리는 것을 넘어, 크로미움이 그 자리에 완전히 다른 글자를 그리는 렌더링 결함까지
    // 실측으로 확인됐다(예: "B"가 "E"로 보임 — 경계에 걸친 서브셋 웹폰트 글리프를 잘못 그리는 버그로
    // 보인다). 라벨 중심점마다 고정 여백만 둘러 뷰박스를 넉넉히 키운다 — 지금 이 페이지엔 아직 최종
    // 글꼴(Pretendard)이 아니라 브라우저 기본 글꼴이 연결돼 있어, 렌더된 <text>의 getBBox()로 재면
    // 실제보다 부풀려져 그림이 칸에서 작아 보이게 된다(B5-VISUAL) — 그래서 크기가 아니라 "자리"만 확보한다.
    const pad = 10;
    let minX = vb.x, minY = vb.y, maxX = vb.x + vb.width, maxY = vb.y + vb.height;
    for (const c of centers) {
      if (!c) continue;
      minX = Math.min(minX, c.x - pad); minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad); maxY = Math.max(maxY, c.y + pad);
    }
    svgEl.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    svgEl.removeAttribute('width'); svgEl.removeAttribute('height');   // design.md: viewBox만
    return svgEl.outerHTML;
  }, { classFor: CLASS_FOR, markHexes: (spec.labels || []).map((l, i) => l.tex ? null : markHex(i)), labels: spec.labels || [] });
  if (fontFamilies.length) svg = embedFonts(svg, fontFamilies);
  svg = svg.replace(/^<svg /, `<svg data-diagram="${spec.kind}" `);
  return svg;
}

// ── 캐시된 컴파일 (lesson 폴더 기준) ────────────────────────────────────
function cacheFile(dir, hash) { return path.join(dir, 'diagrams', `${hash}.svg`); }

// node-tikzjax는 최초 호출 시에만 불러온다(시스템 LaTeX이 있으면 아예 안 쓸 수도 있다 — 그때는
// WASM을 메모리에 올릴 필요가 없다).
let _tex2svgPromise;
function lazyNodeTikzjax() {
  if (!_tex2svgPromise) _tex2svgPromise = import('node-tikzjax').then(mod => mod.default?.default || mod.default);
  return _tex2svgPromise;
}

// 캐시 파일 자체에 data-engine 속성을 심어 둔다(data-diagram=kind와 같은 자리) — 그래야 캐시 적중
// 때도(=이번 빌드에서 컴파일을 안 해서 engine 변수 자체가 없을 때도) "예전에 어느 엔진으로 그렸는지"를
// 파일만 읽어 알 수 있다. 팀 요청: out/.diagram-engine.json이 캐시 적중 도식도 빠짐없이 기록해야 한다
// (전에는 새로 컴파일한 것만 세서, 도식이 전부 캐시에서 나온 재빌드는 diagrams가 빈 {}로 나왔다).
function readCachedEngine(file) {
  const m = fs.readFileSync(file, 'utf8').match(/data-engine="([^"]+)"/);
  return m ? m[1] : 'unknown';   // v3 이전 캐시처럼 속성이 없는 예전 파일 대비
}
// TikZ 컴파일 실패 메시지에 "라이브러리를 안 불러왔나?" 힌트를 붙인다 — 자주 겪는 실수(화살촉 스타일
// 쓰면서 arrows.meta 안 불러오기 등)가 낯선 LaTeX 로그(예: "Unknown arrow tip name", pgfkeys 관련
// 에러)로만 나오면 원인을 못 찾는다. 기본 라이브러리(DEFAULT_TIKZ_LIBS)는 이제 항상 불러오지만, 그
// 밖의(pgfplots 안 라이브러리 등) 더 특수한 라이브러리가 빠지면 여전히 이런 에러가 날 수 있다.
const TIKZ_LIB_ERROR_RE = /unknown arrow tip|i do not know the key|unknown option for key|undefined control sequence.*\\tikzset|library.*not found|no such library/i;
function tikzLibHint(message) {
  if (!TIKZ_LIB_ERROR_RE.test(message)) return '';
  return ` — tikzLibraries가 빠졌을 수 있습니다(design.md 저수준 {tikz} 참고, 기본값 "${DEFAULT_TIKZ_LIBS}" 밖의 라이브러리가 필요하면 visual.tikz.tikzLibraries에 콤마로 추가하세요, 예: "decorations.markings")`;
}
async function compileOne(spec, lessonDir, page) {
  const hash = diagramHash(spec);
  const file = cacheFile(lessonDir, hash);
  if (fs.existsSync(file)) return { hash, cached: true, ms: 0, engine: readCachedEngine(file), kind: spec.kind };
  const t0 = Date.now();
  const debug = process.env.CF_TIKZ_DEBUG === '1';
  let raw, engine, systemErr;
  const bin = findTexBin();
  if (bin) {
    try {
      // --no-fonts: dvisvgm이 글자까지 전부 벡터 경로로 바꿔 준다 — 브라우저 글꼴 매칭·임베딩이
      // 필요 없고(그 경계 클리핑 렌더링 결함도 원천적으로 피한다), 오프라인으로 완결된다.
      raw = runTexToSvg(buildFullTexDocument(spec), ['--no-fonts'], bin);
      engine = 'system';
    } catch (e) {
      systemErr = e;
      if (debug) console.error(`시스템 LaTeX 컴파일 실패(${spec.kind}) — node-tikzjax로 대체합니다: ${e.message}`);
    }
  }
  if (!raw) {
    const tex2svg = await lazyNodeTikzjax();
    const texSrc = buildTexSource(spec);
    if (debug) console.error(`--- tikz src (${spec.kind}, node-tikzjax) ---\n${texSrc}\n---`);
    const texPackages = Object.fromEntries((spec.packages || []).map(p => [p, '']));
    // disableOptimize: svgo가 기본으로 켜져 있으면 같은 색·같은 스타일의 도형(우리 라벨 앵커 마커들처럼)을
    // 하나의 <path>로 합쳐버릴 수 있다 — 그러면 마커마다 따로 좌표를 읽을 수 없게 된다(라벨이 엉뚱한
    // 자리로 뭉침). 우리가 후처리에서 폭·높이를 이미 벗겨내고 색도 다시 입히므로 svgo 최적화는 필요 없다.
    try {
      raw = await tex2svg(texSrc, { texPackages, tikzLibraries: mergeLibs(spec.tikzLibraries), showConsole: debug, disableOptimize: true });
      engine = 'node-tikzjax';
    } catch (e) {
      // 두 엔진 다 실패했다 — 둘 중 라이브러리 문제로 보이는 메시지를 찾아 힌트를 붙여 다시 던진다
      // (시스템 LaTeX 에러가 보통 더 읽기 쉽다 — 진짜 latex 로그라서).
      const hint = tikzLibHint(e.message) || (systemErr && tikzLibHint(systemErr.message)) || '';
      const base = systemErr ? `system: ${systemErr.message.split('\n')[0]} / node-tikzjax: ${e.message.split('\n')[0]}` : e.message;
      throw new Error(`TikZ 컴파일 실패(${spec.kind})${hint}\n${base}`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (debug) fs.writeFileSync(path.join(path.dirname(file), `.debug-${hash}.raw.svg`), raw);
  let svg = namespaceIds(await postProcess(raw, spec, page), `d${hash}`);
  svg = svg.replace(/<svg /, `<svg data-engine="${engine}" `);
  fs.writeFileSync(file, svg, 'utf8');
  return { hash, cached: false, ms: Date.now() - t0, engine, kind: spec.kind };
}

// lesson.json 어디든(슬라이드·활동지 figure/draw·지도안) 있는 도식 visual을 전부 모은다.
export function collectDiagramSpecs(node, out = []) {
  if (Array.isArray(node)) { node.forEach(n => collectDiagramSpecs(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.visual !== undefined) { const s = toTikzSpec(node.visual); if (s) out.push(s); }
    if (node.base !== undefined) { const s = toTikzSpec(node.base); if (s) out.push(s); }
    if (node.answer !== undefined && typeof node.answer === 'object') { const s = toTikzSpec(node.answer); if (s) out.push(s); }
    for (const k of Object.keys(node)) if (k !== 'visual') collectDiagramSpecs(node[k], out);
  }
  return out;
}

// circuitBipole·checkCircuitConnectivity 등이 던지는 에러는 이미 "무엇이 왜 틀렸는지·어떻게 고치는지"를
// 담고 있지만 "몇 번 슬라이드였는지"는 모른다(순수 함수라 lesson.json 전체 구조를 모른다) — 여기서
// 위치만 앞에 붙여 사람이 한 줄로 읽을 수 있게 한다. build.mjs가 이 에러를 잡아 스택 없이 이 메시지만
// 보여준다(CLASSFORGE_DEBUG=1이면 원본 스택도 같이 — build.mjs 참고). 한 헬퍼 에러당 한 번만 감싸도록
// isDiagramError로 표시해 두고(여러 단계에서 다시 감싸는 사고 방지), 원본은 cause로 붙여 둔다.
function wrapDiagramError(e, where) {
  if (e.isDiagramError) return e;
  const err = new Error(`${where} — ${e.message}`);
  err.cause = e;
  err.isDiagramError = true;
  return err;
}
// build.mjs가 렌더 전에 한 번 호출한다 — 컴파일은 async라 여기서 미리 전부 캐시해 둔다.
// lesson.slides[]·worksheet 문항·지도안을 하나씩 훑어야(전체를 한 번에 collectDiagramSpecs하지 않고)
// 헬퍼가 던지는 에러에 "몇 번 슬라이드/문항인지"를 붙일 수 있다.
export async function prepareDiagrams(lesson, lessonDir) {
  const specs = [];
  const locationOf = new Map();   // spec 객체 -> "5번 슬라이드" 같은 위치 설명(컴파일 에러에도 붙인다)
  const collectAt = (node, where) => {
    if (node === undefined || node === null) return;
    const before = specs.length;
    try { collectDiagramSpecs(node, specs); }
    catch (e) { throw wrapDiagramError(e, where); }
    for (let i = before; i < specs.length; i++) locationOf.set(specs[i], where);
  };
  (lesson.slides || []).forEach((s, i) => collectAt(s, `${i + 1}번 슬라이드`));
  for (const sec of lesson.worksheet?.sections || []) {
    (sec.items || []).forEach((item, i) => collectAt(item, `활동지 "${sec.title || ''}" ${i + 1}번 문항`));
  }
  collectAt(lesson.plan, '지도안');
  const byHash = new Map();
  for (const s of specs) byHash.set(diagramHash(s), s);
  if (!byHash.size) return { count: 0, compiled: 0, cached: 0, ms: 0, logs: [], engines: {}, diagrams: [] };
  const browser = await launch();
  const logs = [];
  const engines = {};
  const diagrams = [];   // 새로 컴파일했든 캐시에서 읽었든, 도식 하나하나(helper·engine·cached)를 전부 기록한다
  let compiled = 0, cached = 0, ms = 0;
  try {
    const page = await browser.newPage();
    for (const spec of byHash.values()) {
      let r;
      try { r = await compileOne(spec, lessonDir, page); }
      catch (e) { throw wrapDiagramError(e, locationOf.get(spec) || `(${spec.kind}, 위치 확인 불가)`); }
      diagrams.push({ helper: r.kind, engine: r.engine, cached: r.cached });
      engines[r.engine] = (engines[r.engine] || 0) + 1;   // 캐시 적중도 이제 engine을 알아서(readCachedEngine) 같이 센다
      if (r.cached) cached++;
      else { compiled++; ms += r.ms; logs.push(`${spec.kind} ${r.hash} — ${r.ms}ms (${r.engine})`); }
    }
    await page.close();
  } finally { await browser.close(); }
  return { count: byHash.size, compiled, cached, ms, logs, engines, diagrams };
}

// plot/bars와 달리 도식은 lesson 전체를 훑어 미리 컴파일해 두므로(캐시 해시가 슬라이드 칸 크기와
// 무관해야 재사용이 된다) TikZ 좌표(bp)와 화면 px의 비율을 캐시 시점에는 알 수 없다. 대신 v-label*
// 클래스가 --cf-label-scale(deck.css/print.css)로 나눠 쓰므로, 조회 시점에 이 칸의 표시 크기를 알면
// 그 변수 하나만 svg 루트에 얹어 라벨을 항상 34/28px로 맞출 수 있다.
// 같은 도식·수식이 한 문서(슬라이드+활동지+정답지+지도안 등)에 여러 번 나오면(예: 같은 공식을
// 본문과 정답지에서 둘 다 씀) 캐시 파일은 하나뿐이라 넣을 때마다 "같은" id가 그대로 복사돼 B8-DUPID
// (id 중복)로 걸린다 — 캐시에 구운 해시 기반 prefix(dHASH-/mHASH-)만으로는 "내용이 같다"만 구분하지
// "이 문서에서 몇 번째로 삽입됐다"는 구분하지 못하기 때문. 조회(embed)할 때마다 한 번 더
// namespaceIds()를 태워 전역 카운터로 매 삽입을 유일하게 만든다(빌드 프로세스 안에서만 쓰고 버리는
// 값이라 파일마다 다시 0부터 시작할 필요도 없다 — 그냥 계속 증가만 하면 충돌이 날 수가 없다).
let _embedSeq = 0;
const DEFAULT_DIM = { width: 1000, height: 650 };
export function lookupDiagramSync(v, dims, lessonDir) {
  const spec = toTikzSpec(v);
  if (!spec) return null;
  const file = cacheFile(lessonDir, diagramHash(spec));
  if (!fs.existsSync(file)) throw new Error(`도식이 컴파일되지 않음(${spec.kind}) — build.mjs가 prepareDiagrams()를 먼저 호출했는지 확인하세요: ${file}`);
  let svg = fs.readFileSync(file, 'utf8');
  svg = namespaceIds(svg, `i${_embedSeq++}`);
  const vb = svg.match(/viewBox="[^ "]+ [^ "]+ ([^ "]+) ([^ "]+)"/);
  if (!vb) return svg;
  const [vbW, vbH] = [parseFloat(vb[1]), parseFloat(vb[2])];
  const targetW = spec.width || dims?.width || DEFAULT_DIM.width;
  const targetH = spec.height || dims?.height || DEFAULT_DIM.height;
  const scale = Math.min(targetW / vbW, targetH / vbH) || 1;
  return svg.replace(/<svg /, `<svg style="--cf-label-scale:${scale.toFixed(4)}" `);
}

// ── 인라인 수식($...$) — 실제 LaTeX으로 조판 ──────────────────────────────────
// build.mjs의 md()가 렌더링에 쓴다. 게이트(S2·E1-SYMBOL·S4)는 이 모듈을 거치지 않고 lesson.json의
// $...$ 원문을 그대로 읽으므로(design.md "수식 인라인 표기") 여기서 뭘 하든 게이트 채점과는 무관하다.
// diagramHash의 RENDER_VERSION과 같은 목적 — 수식 렌더링 방식을 바꾸면(예: 함수명 정규화 추가) 값을
// 올려 캐시를 무효화한다. 수식과 도식은 서로 다른 부분을 바꿀 수 있어 버전 번호를 따로 둔다.
const FORMULA_RENDER_VERSION = 5;   // v3: raw <svg 앵커 버그 수정(v2 이하 캐시는 전부 data-ascent가 없는 깨진 파일이었다) / v4: 유니코드 수식 기호(≈·°·×·÷·±·−) 지원 / v5: $$..$$ 디스플레이 수식(\displaystyle) 지원
// display가 다르면(inline vs display) 같은 texSrc라도 조판 결과(줄 간격·크기 계산에 쓰는 \displaystyle
// 유무)가 달라지므로 해시에 같이 섞는다 — 안 그러면 캐시가 서로 덮어써진다.
export function formulaHash(texSrc, display = false) { return crypto.createHash('sha256').update(`${FORMULA_RENDER_VERSION}:${display ? 'd' : 'i'}:${texSrc}`).digest('hex').slice(0, 20); }
function mathCacheFile(dir, hash) { return path.join(dir, 'diagrams', `math-${hash}.svg`); }
// sin/cos/tan/log 등을 \ 없이 쓰면 LaTeX이 그냥 변수 나열(s·i·n을 각각 이탤릭 곱)로 조판해 기울어져
// 보인다 — 실제 연산자로 쓰려면 \sin처럼 백슬래시가 있어야 한다(design.md "수식 인라인 표기"). 저작자가
// 잊어버리기 쉬운 실수라 컴파일 전에 자동으로 고쳐 준다. 이미 \가 붙어 있으면(음의 후방탐색) 건드리지 않는다.
const BARE_FN_RE = /(?<!\\)\b(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|log|ln|exp|lim|min|max|det|gcd|sec|csc|cot)\b/g;
function normalizeMathFn(texSrc) { return texSrc.replace(BARE_FN_RE, '\\$1'); }
// 자주 쓰는 유니코드 기호(≈·°·×·÷·±·− 등)를 흔히 그냥 붙여 쓰는데, 옛 latex(→dvi, pdflatex 아님)는
// inputenc 없인 다바이트 UTF-8을 한 글자씩 못 읽어 컴파일 자체가 실패한다(예전에 evidence-demo의
// "θᵣ≈32°" 수식이 CSS로 조용히 대체되던 원인). inputenc[utf8]로 바이트를 해독하게 한 다음,
// newunicodechar로 "이 글자를 보면 이 TeX 명령으로 바꿔라"를 등록해 둔다 — 실제 실행해 latex+dvisvgm
// 파이프라인으로 끝까지 검증했다(scratch 테스트, 문제없음). 한글(\text{} 안)은 여기 포함 안 시켰다 —
// kotex은 plain latex(dvi 경로)에 얹기엔 폰트·인코딩 설정이 무겁고 깨질 위험이 있고, 지금 스킬 어디에도
// \text{한글}을 쓰는 실제 수식이 없어 검증할 방법이 없다. 필요해지면 도식과 같은 마커+오버레이 방식을
// (Playwright로 위치 찾아 우리 <text>를 얹는) 수식에도 붙이는 게 더 안전하다.
const UNICODE_MATH_PREAMBLE = [
  '\\usepackage[utf8]{inputenc}',
  '\\usepackage{newunicodechar}',
  '\\newunicodechar{≈}{\\approx}',
  '\\newunicodechar{°}{^\\circ}',
  '\\newunicodechar{×}{\\times}',
  '\\newunicodechar{÷}{\\div}',
  '\\newunicodechar{±}{\\pm}',
  '\\newunicodechar{−}{-}',   // U+2212(진짜 마이너스 기호) — 수식 모드의 "-"가 이미 마이너스로 조판된다
].join('\n');
function buildFormulaDocument(texSrc, display = false) {
  // standalone의 preview 옵션 + dvisvgm --bbox=preview: 수식 잉크에 딱 맞는 사각형을 얻고, 그 사각형의
  // 위쪽(ascent)·아래쪽(depth)이 기준선(baseline) 기준으로 정확히 얼마인지도 알 수 있다(아래 참고) —
  // 본문 글자와 세로로 정확히 맞추는 데(vertical-align) 이 두 값이 필요하다.
  // display(=="$$..$$"로 쓴 핵심 공식)면 \displaystyle을 붙인다 — \frac·\sum·\lim처럼 인라인/디스플레이가
  // 다르게 조판되는 명령이 실제로 커진다(분수 줄이 두꺼워지고, 첨자가 위아래로 붙는 등). 글자 "크기"
  // 자체는 여기서 안 키운다 — build.mjs 쪽 .math-display가 더 큰 font-size 컨테이너에 담고, SVG는
  // em 단위라 그 안에서 자동으로 비례해 커진다(제목·본문 크기가 달라도 같은 방식으로 맞추는 기존 체계와 동일).
  const normalized = normalizeMathFn(texSrc);
  const body = display ? `\\displaystyle ${normalized}` : normalized;
  return `\\documentclass[preview,border=0pt]{standalone}\n\\usepackage{amsmath}\n\\usepackage{amssymb}\n${UNICODE_MATH_PREAMBLE}\n\\begin{document}\n$${body}$\n\\end{document}`;
}
async function compileFormula(texSrc, lessonDir, bin, display = false) {
  const hash = formulaHash(texSrc, display);
  const file = mathCacheFile(lessonDir, hash);
  if (fs.existsSync(file)) return { hash, cached: true };
  // .test()는 전역(g) 플래그 정규식의 lastIndex를 건드려 재사용 시 오작동할 수 있으므로(다음 호출이
  // 중간부터 시작) normalizeMathFn 결과와 비교하는 방식으로 안전하게 "바뀌었는지"만 확인한다.
  const normalizedPreview = normalizeMathFn(texSrc);
  if (normalizedPreview !== texSrc) console.warn(`경고: 수식 "${texSrc}"의 함수 이름에 \\가 빠져 있어 자동으로 붙였습니다(예: sin→\\sin) — lesson.json에서도 \\를 붙여 쓰세요.`);
  const raw = runTexToSvg(buildFormulaDocument(texSrc, display), ['--no-fonts', '--bbox=preview'], bin);
  // dvisvgm --bbox=preview는 viewBox의 min-y를 -(ascent)로, 전체 높이를 ascent+depth로 잡아 준다
  // (표준 SVG 좌표는 y가 아래로 자라므로 기준선=0은 min-y가 -ascent일 때와 같다). 이 두 값만으로
  // "글자 크기(em) 기준 세로 크기·기준선 오프셋"을 구할 수 있어 별도 사이드카 파일이 필요 없다 —
  // svg 루트에 data-* 속성으로 같이 적어 둔다.
  const vb = raw.match(/viewBox=['"]([^'"]+)['"]/);
  let ascentPt = 0, depthPt = 0;
  if (vb) { const [, minY, , h] = vb[1].trim().split(/\s+/).map(Number); ascentPt = -minY; depthPt = h - ascentPt; }
  // dvisvgm 출력은 <?xml ...?>·주석 줄이 <svg> 태그보다 앞에 오므로 "^<svg "(문자열 맨 앞)로는
  // 절대 안 걸린다 — 앵커 없이 첫 <svg 태그를 바로 찾는다(도식 쪽 postProcess는 DOM outerHTML을
  // 거쳐 그 서두가 이미 없어져서 같은 실수를 해도 우연히 통과했었다 — 여기는 raw 문자열을 직접 다뤄
  // 실제로 걸려 있던 버그. 이 버그가 있으면 data-ascent가 안 붙어 lookupFormulaSync가 항상 null을
  // 돌려주고, build.mjs가 매번 조용히 CSS 대체 렌더링으로 넘어간다 — LaTeX 컴파일 자체는 성공해도
  // 화면엔 절대 안 쓰였다).
  let svg = raw.replace(/<svg /, `<svg data-ascent="${ascentPt.toFixed(4)}" data-depth="${depthPt.toFixed(4)}" fill="currentColor" `)
    .replace(/\swidth=['"][^'"]*['"]/, '').replace(/\sheight=['"][^'"]*['"]/, '');
  svg = namespaceIds(svg, `m${hash}`);   // page1·gN-NN 같은 dvisvgm id가 다른 수식·도식과 안 겹치게(B8-DUPID)
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg, 'utf8');
  return { hash, cached: false };
}
// lesson.json 어디든(슬라이드·활동지·지도안 문자열) 있는 $...$ 수식을 전부 모은다(중복 없이).
// $$...$$(디스플레이 수식, design.md "수식 인라인 표기")도 같이 찾는다 — 먼저 시도해야 "$"쪽 패턴이
// 여는/닫는 $$ 중 한 글자씩만 집어먹는 식으로 어긋나게 매칭되는 걸 막는다. 같은 texSrc라도 inline과
// display는 다른 조판 결과(\displaystyle 유무)라 별도 항목으로 둔다(키에 display 여부를 같이 넣어 중복 제거).
const FORMULA_RE = /\$\$([^$\n]+?)\$\$|\$([^$\n]+)\$/g;
export function collectFormulas(node, out = new Map()) {
  if (typeof node === 'string') {
    for (const m of node.matchAll(FORMULA_RE)) {
      const display = m[1] !== undefined, expr = display ? m[1] : m[2];
      out.set(`${display ? 'd' : 'i'}:${expr}`, { expr, display });
    }
    return out;
  }
  if (Array.isArray(node)) { node.forEach(n => collectFormulas(n, out)); return out; }
  if (node && typeof node === 'object') { for (const k of Object.keys(node)) collectFormulas(node[k], out); }
  return out;
}
// build.mjs가 렌더 전에 한 번 호출한다. 시스템 LaTeX이 없으면 아무것도 안 하고 경고만 남긴다 —
// build.mjs의 md()가 그 경우 예전 CSS 렌더링(mathExpr)으로 자동 대체한다.
export async function prepareFormulas(lesson, lessonDir) {
  const formulas = [...collectFormulas(lesson).values()];
  if (!formulas.length) return { count: 0, compiled: 0, cached: 0, available: true };
  const bin = findTexBin();
  if (!bin) {
    console.warn('경고: 시스템 LaTeX(MiKTeX·TeX Live)을 찾지 못해 수식을 CSS로 대체합니다 — SKILL.md 0단계(글꼴) 참고, CLASSFORGE_TEX_BIN으로 경로를 지정할 수도 있습니다.');
    return { count: formulas.length, compiled: 0, cached: 0, available: false };
  }
  let compiled = 0, cached = 0;
  for (const { expr, display } of formulas) {
    try { const r = await compileFormula(expr, lessonDir, bin, display); if (r.cached) cached++; else compiled++; }
    catch (e) { console.warn(`경고: 수식 "${expr}" 조판 실패 — CSS로 대체합니다: ${e.message.split('\n')[0]}`); }
  }
  return { count: formulas.length, compiled, cached, available: true };
}
// build.mjs의 md()가 쓰는 동기 조회 — prepareFormulas가 이미 캐시해 둔 뒤에만 값이 있다(없으면 null,
// 호출부가 CSS 렌더링으로 대체한다). em 단위로 돌려줘 본문 글자 크기가 달라져도(제목 72px·본문 42px 등)
// 함께 커지고 작아진다 — standalone 기본 글자 크기 10pt를 1em으로 본다.
export function lookupFormulaSync(texSrc, lessonDir, display = false) {
  const file = mathCacheFile(lessonDir, formulaHash(texSrc, display));
  if (!fs.existsSync(file)) return null;
  let svg = fs.readFileSync(file, 'utf8');
  svg = namespaceIds(svg, `i${_embedSeq++}`);   // 같은 수식이 문서에 여러 번 나올 때 id 중복(B8-DUPID) 방지
  const m = svg.match(/data-ascent="([^"]+)" data-depth="([^"]+)"/);
  if (!m) return null;
  const ascentPt = parseFloat(m[1]), depthPt = parseFloat(m[2]);
  const emHeight = (ascentPt + depthPt) / 10, emDepth = depthPt / 10;
  const cls = display ? 'tex-math tex-math-display' : 'tex-math';
  return svg.replace(/<svg /, `<svg class="${cls}" style="height:${emHeight.toFixed(4)}em;vertical-align:${(-emDepth).toFixed(4)}em" `);
}
