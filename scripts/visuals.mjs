// classforge visuals — 선언형 삽화(좌표평면 그래프, 막대그래프)를 테마 클래스 SVG로 그린다.
// 손으로 그린 그래프는 기울기·눈금이 틀리기 쉬우므로, 수식과 값이 있는 그림은 여기서 계산해 그린다.
// 라벨은 선·점·다른 라벨과 부딪히지 않는 자리를 골라 놓는다(중요도: 점 > 보조선 > 직선 > 눈금).

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = n => Math.round(n * 100) / 100;
// 'free' 눈금의 기본 간격: 1·2·5×10ⁿ 중에서 골라 눈금이 5~8개쯤 나오게 한다.
function niceStep(range) {
  if (!(range > 0)) return 1;
  const raw = range / 6, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
}
// step(1·2·5×10ⁿ 중 하나)보다 한 단계 굵은 값 — 세로로 짧은 칸에서 눈금 간격이 라벨 크기보다
// 좁아 숫자끼리 겹치면(그 눈금은 자리가 없어 조용히 빠져 "1, 4"처럼 들쭉날쭉해진다) 이걸로 올려서
// 눈금 수 자체를 줄인다(1→2→5→10…).
function nextNiceStep(step) {
  const mag = Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
  const n = Math.round(step / mag);
  return (n <= 1 ? 2 : n <= 2 ? 5 : 10) * mag;
}
// 눈금 숫자를 step이 실제로 필요로 하는 소수 자리까지만 찍는다(부동소수점 오차로 0.2가
// 0.20000000000000004처럼 나오는 것을 막는다).
function tickDecimals(step) {
  if (!(step > 0)) return 0;
  const s = step.toPrecision(12).replace(/0+$/, '').replace(/\.$/, '');
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(s.length - i - 1, 6);
}
const fmtTick = (v, step) => String(Number(v.toFixed(tickDecimals(step))));
// 그 축에서 실제로 찍힐 눈금 숫자 중 가장 넓은 글자폭(px) — 소수 눈금("0.2")은 정수("2")보다
// 넓어서 기본 여백(pad)을 넘어갈 수 있으므로, pad를 정할 때 이 값을 미리 안다.
function maxTickTextW(lo, hi, st) {
  let w = 0;
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) w = Math.max(w, textW(fmtTick(v, st), FS['v-label-s']));
  return w;
}
// curves.fn을 함수로 컴파일한다(그래프를 실제로 그릴 때와 게이트가 예측값을 계산할 때가 같은 방식을 쓰도록
// 한 곳에서만 파싱한다 — gate.mjs의 E1-DATAFIT이 이 함수를 그대로 가져다 쓴다).
export function compileCurve(fn) {
  if (!/^[\dx+\-*/(). ]+$/.test(fn)) throw new Error(`curves.fn에는 숫자, x, + - * / ( )만 쓸 수 있습니다: ${fn}`);
  return new Function('x', `return (${fn});`);
}

let clipSeq = 0;   // 한 문서에 그래프가 여러 개여도 clipPath id가 겹치지 않게
const CLS = { accent: ['v-accent-s', 'v-accent', 'v-label-a'], ink: ['v-ink-s', 'v-ink', 'v-label'], muted: ['v-ink-s', 'v-muted', 'v-label-s'] };
const HALO = "paint-order='stroke' stroke='var(--paper, #fff)' stroke-width='9' stroke-linejoin='round'";
const FS = { 'v-label': 34, 'v-label-a': 34, 'v-label-s': 28 };

// ── 충돌 계산 ────────────────────────────────────────────
const textW = (t, fs) => [...String(t)].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 1.0 : /[A-Za-z0-9=+\-(),.·½²³ ]/.test(ch) ? 0.6 : 0.8) * fs, 0);
// text는 보통 문자열 하나지만, 아래 splitTwoLines()가 만든 [1행,2행] 배열일 수도 있다 — 그 경우
// 상자 너비는 더 넓은 줄 기준, 높이는 줄 수만큼 늘린다(줄 간격 1.15em).
function boxOf(x, y, t, fs, anchor) {   // SVG text (x,y는 기준선) → 사각형
  const lines = Array.isArray(t) ? t : [t];
  const w = Math.max(...lines.map(s => textW(s, fs))), lineH = fs * 1.15;
  const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return { l: left - 4, r: left + w + 4, t: y - fs * 0.95, b: y + fs * 0.22 + (lines.length - 1) * lineH };
}
// 수식·좌표(=, (, ), 숫자, 라틴 글자로 쓰는 변수)가 있는 라벨은 절대 줄바꿈하지 않는다 — "y=2x+1"을
// "y=2 / x+1"로, "(0, 1)"을 "(0, / 1)"로 접으면 교사가 보기에 식·좌표가 깨진 것처럼 보인다. 줄바꿈은
// 한글 문구(예: "a가 작고 양수")에서 공백 기준으로만 한다.
const isMathLike = t => (Array.isArray(t) ? t : [t]).some(s => /[=()]/.test(s) || /[A-Za-z]/.test(s) || /\d/.test(s));
// 가로로 아주 긴 한글 문구(단어가 여러 개)를 두 줄로 접는다 — 자리가 없을 때만 쓴다(1번 시도는
// 항상 한 줄). 가로로 긴 상자보다 세로로 조금 더 크고 가로는 훨씬 좁은 상자가 서로 다른 방향의
// 선들 사이에서 빈자리를 찾기 훨씬 쉽다. 수식·좌표는 접지 않는다(위 isMathLike).
function splitTwoLines(text) {
  if (isMathLike(text)) return null;
  const s = String(text), parts = s.split(' ');
  if (parts.length < 2) return null;
  const fs = 34, total = textW(s, fs);
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < parts.length; i++) {
    const diff = Math.abs(textW(parts.slice(0, i).join(' '), fs) - total / 2);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return [parts.slice(0, best).join(' '), parts.slice(best).join(' ')];
}
const inBox = (b, x, y) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;
function segHits(b, s) {
  if (inBox(b, s.x1, s.y1) || inBox(b, s.x2, s.y2)) return true;
  const edges = [[b.l, b.t, b.r, b.t], [b.r, b.t, b.r, b.b], [b.r, b.b, b.l, b.b], [b.l, b.b, b.l, b.t]];
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const cross = (a, c, d, e) => o(a, c, d) !== o(a, c, e) && o(d, e, a) !== o(d, e, c);
  return edges.some(([x1, y1, x2, y2]) => cross([s.x1, s.y1], [s.x2, s.y2], [x1, y1], [x2, y2]));
}
const boxHits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
// 상자에서 (cx,cy)까지의 최단 거리 — 점(마커) 라벨이 자기 마커를 가리거나 붙어 보이지 않게
// 하는 데 쓴다. free()의 dots 판정은 "자기 점"을 일부러 빼고 보므로(라벨을 점 옆에 붙일 수
// 있어야 하니까) 이걸로 별도의 최소 간격을 강제한다. 상자가 (cx,cy)를 감싸면(안쪽) 0을 준다.
function distToBox(b, cx, cy) {
  const dx = Math.max(b.l - cx, 0, cx - b.r), dy = Math.max(b.t - cy, 0, cy - b.b);
  return Math.hypot(dx, dy);
}
const LABEL_GAP = 6;   // 이미 놓인 라벨과는 이만큼 더 떨어뜨려 판정한다(딱 붙어 보이지 않게)
const inflate = (b, m) => ({ l: b.l - m, r: b.r + m, t: b.t - m, b: b.b + m });
// 직선(px,py)-(qx,qy)를 y∈[ylo,yhi]로 자른다(도메인 좌표, 파라메트릭 t로 양 끝을 안쪽으로 당김).
// 완전히 범위 밖이면 null. 렌더링되는 <line>이 실제로 보이는 부분만 갖도록 하는 데 쓴다 — clip-path로만
// 가리면 DOM에는 범위 밖 좌표가 그대로 남아, 게이트가 화면에 보이지도 않는 부분과의 "충돌"을 잘못 잡는다.
function clipLineToY(px, py, qx, qy, ylo, yhi) {
  if ((py < ylo && qy < ylo) || (py > yhi && qy > yhi)) return null;
  const at = t => [px + (qx - px) * t, py + (qy - py) * t];
  let t0 = 0, t1 = 1;
  const tAt = bound => (bound - py) / (qy - py);
  if (py < ylo) t0 = Math.max(t0, tAt(ylo)); else if (py > yhi) t0 = Math.max(t0, tAt(yhi));
  if (qy < ylo) t1 = Math.min(t1, tAt(ylo)); else if (qy > yhi) t1 = Math.min(t1, tAt(yhi));
  if (t0 >= t1) return null;
  const [ax, ay] = at(t0), [bx, by] = at(t1);
  return [ax, ay, bx, by];
}
// 점 배열(한 점근선 구간 안의 샘플들)을 y∈[ylo,yhi]로 잘라 여러 조각(run)으로 나눈다 — curves가
// y0/y1 밖으로 나갔다 들어오는 경우, 나가는/들어오는 지점을 보간해 정확히 경계에서 잘린 폴리라인을
// 만든다(위 clipLineToY와 같은 목적, 곡선은 샘플 점이 여럿이라 조각을 이어 붙인다).
function clipRunToY(run, ylo, yhi) {
  const within = y => y >= ylo && y <= yhi;
  const runs = [];
  let cur = [];
  for (let i = 0; i < run.length; i++) {
    const [x, y] = run[i];
    if (i > 0) {
      const [px, py] = run[i - 1];
      if (within(py) !== within(y)) {
        const yb = within(y) ? (py > yhi ? yhi : ylo) : (y > yhi ? yhi : ylo);
        const t = (yb - py) / (y - py);
        cur.push([px + (x - px) * t, yb]);
        if (!within(y)) { if (cur.length > 1) runs.push(cur); cur = []; }
      }
    }
    if (within(y)) cur.push([x, y]);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}
// 라벨 상자에서 선분 목록까지의 최단 거리(스크린 좌표) — B2-LABELOWN("라벨은 자기 선 가까이")과
// 같은 잣대를 빌드 시점에도 써서, 애초에 그 규칙을 어기는 자리에는 놓지 않는다. 상자 중심·네
// 꼭짓점·네 변의 중점(총 9개 표본점)에서 각 선분까지의 최단 거리 중 가장 작은 값을 쓴다 — 상자
// 전체와 선분의 정확한 최단 거리는 아니지만, 라벨 상자가 선분에 비해 크지 않아 충분히 가깝다.
function distPointToSeg(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy || 1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}
function boxDistToSegs(box, segs) {
  if (!segs || !segs.length) return Infinity;
  const { l, r, t, b } = box, mx = (l + r) / 2, my = (t + b) / 2;
  const pts = [[mx, my], [l, t], [r, t], [l, b], [r, b], [mx, t], [mx, b], [l, my], [r, my]];
  let best = Infinity;
  for (const [x, y] of pts) for (const s of segs) { const d = distPointToSeg(x, y, s); if (d < best) best = d; }
  return best;
}

/**
 * plot: { x:[min,max], y:[min,max], step?:1, yStep?, scale?:'equal'|'free', width?:800, height?:640, grid?:true,
 *         xLabel?:'시간(초)', yLabel?:'거리(m)',                                // 화살표 끝 축 이름(기본 x/y). 예전 이름 axes:{x,y}도 그대로 통한다
 *         lines:[{a,b,label?,style?:'accent'|'ink'|'muted',dash?,at?,
 *                 from?,to?,extend?:'dash'}]      // y = a·x + b. from~to 구간만 실선으로 그리고,
 *                                                  // extend:'dash'면 그 밖(x0~from, to~x1)은 점선 외삽으로 그린다.
 *                                                  // 공식의 예측선일 때는 label을 "예측: y = …" 식으로 쓰면 아래 data(측정값)와 짝을 이룬다
 *         curves:[{fn:'x*x-2', label?, style?}]                                // 간단한 식 (x만 사용)
 *         points:[{x,y,label?,style?,pos?:'ne'|'nw'|'se'|'sw'}]                // 좌표 하나를 콕 집어 보여줄 때(원 마커)
 *         data:[{label?, fact, points:[[x,y],…], style?:'ink'|'accent'|'muted', err?:number|number[]}]
 *                                                  // 실측값(마름모 마커 — points의 원과 모양이 달라 한눈에 구분된다).
 *                                                  // lines(예측)와 짝지어 "예측 vs 측정"을 보여줄 때 쓴다. err는 점마다 같은 y오차 폭(숫자)
 *                                                  // 또는 points와 같은 길이의 배열이면 세로 오차막대를 그린다. fact는 facts의 id —
 *                                                  // 값 자체는 게이트 S4-DATA가 그 fact.text에 있는지 대조한다(지어낸 수치 금지).
 *                                                  // style은 같은 plot의 lines/curves와 달라야 한다 — 같으면 마름모가 선에 묻혀
 *                                                  // 안 보인다(게이트 E1-DATASTYLE). data 기본값은 ink, lines/curves 기본값은 accent.
 *         segments:[{from:[x,y], to:[x,y], label?, style?, dash?}] }
 *
 * 계열 라벨(points/data/segments/lines/curves의 label)은 항상 그래프 안쪽(x0~x1, y0~y1이 그려지는
 * 사각형 안)에만 놓인다 — 화살표 끝을 지나거나 축 이름 자리로 새 나가지 않는다. x축 눈금 바로
 * 위·아래(곡선과 눈금 줄 사이의 좁은 띠)도 피한다 — 그 자리는 어느 계열 것인지 알아보기 어렵다.
 * points/data/segments의 라벨은 반드시 자기 점(들) 둘레만 훑는다(8방향 × 반지름 1×/1.6×/2.4×,
 * putAnchored/putDataLabel) — 자리가 없어도 점에서 멀리 보내지 않고 가장 덜 겹치는 자리에 놓는다
 * (게이트 B2-LABELANCHOR가 라벨-자기점 거리가 폰트 크기의 2.5배를 넘으면 잡아낸다). lines/curves의
 * 라벨(putSeries)은 선을 따라 여러 지점 × 위아래를 먼저 찾고, 그래도 없으면 그래프 안쪽에서 가장
 * 비어 있는 자리(대개 오른쪽 위 사분면)로 넘어간다.
 *
 * scale: 'equal' — 가로·세로 한 칸의 길이를 같게 그린다(다르면 기울기가 틀려 보인다). y=ax+b 같은
 *        수식 그래프에 쓴다. 'free' — x·y를 서로 다른 양(전압 V·전류 I, 압력·부피처럼)으로 보고
 *        각 축을 width×height(칸 크기)에 맞게 독립적으로 늘린다. 물리 데이터 그래프에 'equal'을
 *        쓰면 두 양의 눈금 폭 차이 때문에 그래프가 한 방향으로 납작해지고 데이터가 한쪽에 몰린다.
 *        생략하면: `data`가 있으면(빈 배열 제외) 'free', 그 외에는 'equal' — xLabel/yLabel 이름만으로는
 *        판단하지 않는다(기울기 비교처럼 축에 이름이 있어도 여전히 'equal'이어야 하는 수식 그래프가 있다).
 *        yStep(y축 눈금 간격)을 안 쓰면 'equal'에서는 step과 같고, 'free'에서는 눈금이 5~8개
 *        나오도록 1·2·5×10ⁿ 중에서 고른다.
 *        "예측 vs 측정" 그래프는 y 범위를 실측값에 맞추고(여유 10~20%) 억지로 늘리지 않는다.
 */
export function plot(p) {
  const [x0, x1] = p.x || [-5, 5], [y0, y1] = p.y || [-5, 5];
  let step = p.step || 1;
  // scale 자동 판정: data(실측값)가 있거나, 두 축 이름 모두에 단위가 괄호로 달려 있으면("전압 V (V)",
  // "전류 I (A)") 물리량 그래프로 보고 'free'. 단위가 있으면 아직 data(측정값)가 없는 가설 단계
  // 그래프(compare의 예상 곡선 등)도 물리량이 확실하므로 free로 친다 — 그래야 작은 칸에서도 데이터가
  // 아니라 칸 크기가 그래프를 짜부라뜨리지 않는다. 그 외(수식 그래프, 또는 "시간"/"거리"처럼 단위
  // 없이 이름만 있는 경우)는 'equal'(가로세로 한 칸을 같게) — 기울기를 비교하는 수식 그래프는 축에
  // 구체적인 이름이 있어도 여전히 'equal'이어야 하므로, 이름만으로는(단위 없이는) 판단하지 않는다.
  const hasData = Array.isArray(p.data) && p.data.length > 0;
  const hasUnit = s => typeof s === 'string' && /\([^)]+\)/.test(s);
  const hasUnitAxes = hasUnit(p.xLabel ?? p.axes?.x) && hasUnit(p.yLabel ?? p.axes?.y);
  const scale = p.scale || (hasData || hasUnitAxes ? 'free' : 'equal');
  let yStep = p.yStep || (scale === 'equal' ? step : niceStep(y1 - y0));
  // 기본 여백은 60px이지만, 소수 눈금(예: "0.2")이 그보다 넓으면 눈금이 잘리지 않게 늘린다.
  const pad = Math.max(60, Math.ceil(maxTickTextW(y0, y1, yStep)) + 24, Math.ceil(maxTickTextW(x0, x1, step) / 2) + 14);
  // 위쪽 여백은 화살촉만 있으면 된다 — 축 이름은 위가 아니라 화살표 옆(오른쪽)에 놓인다(아래
  // placeAxisLabel). compare 칸(220px)처럼 세로가 짧은 칸에서 위·아래에 똑같이 pad를 쓰면 실제
  // 그래프가 필요 이상으로 눌린다(예: 220px 칸에서 그래프 높이가 100px밖에 안 남음) — concept
  // 칸(792×582)의 부채꼴 라벨도 이 여유가 있어야 자리를 찾는다. y축 이름은 자기 자리(sy(y1)
  // 바로 위)를 placeAxisLabel이 곡선·직선과 안 겹치는지 확인하고 고르므로 이 축소 자체는 안전하다.
  const padTop = 40;
  let ux, uy;
  if (scale === 'equal') {
    // 가로·세로 한 칸의 길이를 같게 한다(다르면 기울기가 틀려 보인다). 남는 쪽은 viewBox를 줄인다.
    ux = uy = Math.min(((p.width || 800) - 2 * pad) / (x1 - x0), ((p.height || 640) - padTop - pad) / (y1 - y0));
  } else {
    // x·y가 서로 다른 양이므로 각자 칸을 꽉 채우는 단위를 따로 쓴다.
    ux = ((p.width || 800) - 2 * pad) / (x1 - x0);
    uy = ((p.height || 640) - padTop - pad) / (y1 - y0);
  }
  const W = Math.round(ux * (x1 - x0) + 2 * pad), H = Math.round(uy * (y1 - y0) + padTop + pad);
  const sx = x => pad + (x - x0) * ux;
  const sy = y => H - pad - (y - y0) * uy;
  // 세로로 짧은 칸에서 yStep이 촘촘하면 인접 눈금 숫자 상자끼리 겹쳐 그중 하나가 자리가 없어
  // 조용히 빠진다("1, 4"처럼 들쭉날쭉해 보인다) — 그 전에 상자가 안 겹치는 굵은 단계로 미리 올린다.
  // author가 명시한 step/yStep이라도 마찬가지다(정확한 간격보다 읽을 수 있는 게 우선이다).
  {
    const tickH = FS['v-label-s'] * 1.17;
    let tries = 0;
    while (uy * yStep < tickH * 1.15 && tries++ < 6) yStep = nextNiceStep(yStep);
  }
  {
    let tries = 0;
    while (tries++ < 6) {
      const w = maxTickTextW(x0, x1, step) + 8;
      if (ux * step >= w * 1.15) break;
      step = nextNiceStep(step);
    }
  }
  const out = [`<svg viewBox='0 0 ${W} ${H}' data-plot>`];
  const obstacles = [];   // 라벨이 피해야 할 선분 (SVG 좌표)
  const dots = [];        // 라벨이 피해야 할 점
  const placed = [];      // 이미 놓인 라벨 상자
  const labels = [];
  // 축 이름이 원래 W×H 밖으로 나가면(라벨이 길 때) 잘리는 대신 viewBox 자체를 넓힌다.
  let vbMinX = 0, vbMinY = 0, vbMaxX = W, vbMaxY = H;
  const growViewBox = b => { vbMinX = Math.min(vbMinX, b.l - 4); vbMinY = Math.min(vbMinY, b.t - 4); vbMaxX = Math.max(vbMaxX, b.r + 4); vbMaxY = Math.max(vbMaxY, b.b + 4); };
  const clipSeg = (xa, ya, xb, yb) => {   // 그래프 영역 안쪽 부분만 충돌 계산용 선분으로
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, x = xa + (xb - xa) * t, y = ya + (yb - ya) * t; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) pts.push([sx(x), sy(y)]); }
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1] });
    obstacles.push(...segs);
    return segs;
  };
  const tickZone = [];     // 눈금 숫자 자리(축 바로 옆 띠): 다른 라벨이 들어가면 눈금으로 오독된다
  // 그래프 데이터 영역(캔버스 전체가 아니라 실제 x0~x1, y0~y1이 그려지는 사각형) — 계열 라벨은
  // 이 안에만 놓는다(화살표 끝 밖·여백으로 새 나가지 않게).
  const PLOT_BOUNDS = { l: sx(x0) + 2, r: sx(x1) - 2, t: sy(y1) + 2, b: sy(y0) - 2 };
  const free = (b, isTick, bounds) => {
    const bb = bounds || { l: 2, r: W - 2, t: 2, b: H - 2 };
    return b.l >= bb.l && b.r <= bb.r && b.t >= bb.t && b.b <= bb.b
      && (isTick || !tickZone.some(z => boxHits(b, z)))
      && !obstacles.some(s => segHits(b, s))
      && !dots.some(d => b.l - 10 < d.x && b.r + 10 > d.x && b.t - 10 < d.y && b.b + 10 > d.y)
      && !placed.some(q => boxHits(inflate(b, LABEL_GAP), q));
  };
  // free()가 하나도 안 통과할 때(그래프가 너무 빽빽함) "그나마 덜 겹치는" 후보를 고르는 점수 —
  // 0이면 완전히 빈 자리, 클수록 더 많이·더 크게 겹친다. 영역 밖은 다른 무엇보다 나쁘게 친다.
  const scoreBox = (b, bounds) => {
    const bb = bounds || { l: 2, r: W - 2, t: 2, b: H - 2 };
    let s = 0;
    if (b.l < bb.l || b.r > bb.r || b.t < bb.t || b.b > bb.b) s += 1000;
    if (tickZone.some(z => boxHits(b, z))) s += 200;
    s += obstacles.filter(o => segHits(b, o)).length * 20;
    s += dots.filter(d => b.l - 10 < d.x && b.r + 10 > d.x && b.t - 10 < d.y && b.b + 10 > d.y).length * 20;
    s += placed.filter(q => boxHits(inflate(b, LABEL_GAP), q)).length * 10;
    return s;
  };
  // anchor가 있으면(점·데이터 라벨) 그 좌표를 data-anchor에 남긴다 — 게이트 B2-LABELANCHOR가
  // 라벨이 자기 점에서 너무 멀리 떨어지지 않았는지(폰트 크기의 몇 배 이내) 이걸로 잰다.
  // text가 splitTwoLines()의 [1행,2행] 배열이면 <text>를 줄마다 하나씩(같은 x, 줄 간격만큼 y를
  // 내려서) 따로 낸다 — 겹침 판정용 상자는 boxOf()가 이미 두 줄을 합쳐 하나로 계산해 둔다.
  // extraAttrs: 라벨 <text>에 더 붙일 속성 문자열(예: data-series='l0') — 계열(직선·곡선) 라벨을
  // 게이트 B2-LABELOWN이 자기 계열 선(같은 data-series의 <line>/<polyline>)과 짝지어 볼 수 있게 한다.
  const emit = (x, y, text, cls, a, anchor, extraAttrs) => {
    const lines = Array.isArray(text) ? text : [text];
    const lineH = (FS[cls] || 34) * 1.15;
    placed.push(boxOf(x, y, text, FS[cls] || 34, a));
    const ea = extraAttrs ? ` ${extraAttrs}` : '';
    lines.forEach((ln, i) => labels.push(`<text x='${r2(x)}' y='${r2(y + i * lineH)}' class='${cls}' text-anchor='${a}'${anchor && i === 0 ? ` data-anchor='${r2(anchor[0])},${r2(anchor[1])}'` : ''}${ea} ${HALO}>${esc(ln)}</text>`));
  };
  // cands: [[x,y,anchor],...] 첫 번째 빈자리에 놓는다. must면 빈자리가 없을 때 첫 후보에 놓는다(글자 테두리로 읽힘).
  const put = (cands, text, cls, must, bounds, extraAttrs) => {
    const isTick = cls === 'v-label-s' && /^-?[\d.]+$|^O$/.test(text);
    for (const [x, y, a] of cands) if (free(boxOf(x, y, text, FS[cls] || 34, a), isTick, bounds)) { emit(x, y, text, cls, a, undefined, extraAttrs); return true; }
    if (must && cands[0]) emit(...cands[0].slice(0, 2), text, cls, cands[0][2], undefined, extraAttrs);
    return false;
  };
  // 계열 라벨(점·데이터·보조선·직선·곡선)은 반드시 그래프 안쪽에만 놓는다 — 화살표 끝을 지나거나
  // 축 이름 자리로 새 나가면 안 된다. 원래 후보 중에 자리가 없으면 플롯 안쪽 우상단(대개 가장 비어
  // 있는 구석)부터 훑고, 거기도 없으면 플롯 전체(아래·왼쪽 포함)를 훑는다 — 선이 여러 개 한 점에서
  // 부채꼴로 퍼지는 경우 등, 진짜 빈자리가 우상단이 아니라 아래쪽 구석에만 있을 수 있다(원래
  // 우상단만 보던 버전은 이런 빈자리를 놓쳐 불필요하게 겹치는 자리로 새 나갔다). 그래도 다 막혀
  // 있으면(그래프가 매우 빽빽함) pickLeastBad가 그중 가장 덜 겹치는 자리를 고른다.
  const quadrantCands = () => {
    const qL = PLOT_BOUNDS.l + (PLOT_BOUNDS.r - PLOT_BOUNDS.l) * 0.5, qR = PLOT_BOUNDS.r - 8;
    const qT = PLOT_BOUNDS.t + 8, qB = PLOT_BOUNDS.t + (PLOT_BOUNDS.b - PLOT_BOUNDS.t) * 0.55;
    const cands = [];
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 4; rx++)
      cands.push([qL + (qR - qL) * (rx + 0.15) / 4, qT + (qB - qT) * (ry + 0.5) / 5, 'start']);
    const fL = PLOT_BOUNDS.l + 8, fR = PLOT_BOUNDS.r - 8, fT = PLOT_BOUNDS.t + 8, fB = PLOT_BOUNDS.b - 8;
    for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 7; rx++) for (const a of ['start', 'end'])
      cands.push([fL + (fR - fL) * (rx + 0.5) / 7, fT + (fB - fT) * (ry + 0.5) / 7, a]);
    return cands;
  };
  // sid: 이 라벨이 속한 계열의 id('l0'·'c1' 등, 도형을 그릴 때 매긴 것과 같다) — <text>에
  // data-series로 남겨 게이트 B2-LABELOWN이 같은 id의 <line>/<polyline>과 짝지어 보게 한다.
  // ownSegs/otherSegs: 그 계열만의 화면 선분 / 다른 모든 계열(다른 lines·curves)의 선분.
  // "라벨은 자기 선 가까이(1.5× 글자 크기 이내)·다른 선보다 가깝게" 규칙을 여기서 지킨다 — 우상단
  // 구석 등 플롯 전체를 훑는 대체 후보(quadrantCands)는 이 규칙을 어길 수 있으므로 반드시 걸러
  // 낸다. 그래도 자리가 없으면(그래프가 정말 빽빽함) 지시선(가는 선 하나)으로 라벨과 자기 선을
  // 이어 준다 — 라벨이 멀리 있어도 어느 선 것인지 눈으로 바로 알 수 있다.
  // exitPts: [[screenX, screenY, 'top'|'bottom'|'left'|'right'], ...] — 이 계열의 보이는 선이 그래프
  // 틀을 벗어나는 지점(들). 근처(own-line) 자리가 없을 때 "교과서식"으로 그 지점 바로 바깥에
  // 라벨을 놓는 데 쓴다(축 이름과 같은 방식).
  const putSeries = (cands, text, cls, sid, ownSegs, otherSegs, strokeCls, muted, exitPts) => {
    const fsz = FS[cls] || 34, maxOwn = fsz * 1.5;
    const ownOk = box => { const dOwn = boxDistToSegs(box, ownSegs); return dOwn <= maxOwn && dOwn <= boxDistToSegs(box, otherSegs); };
    const filt = (list, t) => list.filter(c => ownOk(boxOf(c[0], c[1], t, fsz, c[2])));
    const seriesAttr = `data-series='${sid}'`;
    // put()이 성공하면 free()가 이미 보장한 것 — 어떤 선(자기 것 포함)과도 실제로 안 닿는다.
    // own-line 규칙(가깝고, 다른 선보다 가까움)은 filt()가 후보를 거를 때 미리 적용해 둔다.
    const qc = quadrantCands();
    if (put(filt(cands, text), text, cls, false, PLOT_BOUNDS, seriesAttr)) return;
    if (put(filt(qc, text), text, cls, false, PLOT_BOUNDS, seriesAttr)) return;
    // 그래도 자리가 없으면(라벨 상자가 너무 넓어서) 균형 잡힌 두 줄로 접어 같은 후보들로 다시
    // 찾는다 — 수식·좌표(isMathLike)는 여기서 접히지 않는다(splitTwoLines가 null을 준다).
    const twoLine = splitTwoLines(text);
    if (twoLine && put([...filt(cands, twoLine), ...filt(qc, twoLine)], twoLine, cls, false, PLOT_BOUNDS, seriesAttr)) return;
    // own-line 규칙을 지키며 안 겹치는 자리가 안쪽에는 정말 없다 — 선이 그래프 틀을 벗어나는
    // 지점 바로 바깥에 놓는다(교과서에서 "y=2x+1"을 직선 끝에 다는 방식과 같다). 축 이름처럼
    // viewBox를 늘려서라도 놓는다.
    for (const [ex, ey, side] of exitPts || []) if (putExitLabel(text, cls, sid, side, ex, ey)) return;
    // 그것도 안 되면(exit 지점이 없거나, 두 계열의 exit이 겹치는 등) 작은 범례(색 견본 + 글자)를
    // 쓴다 — 플롯 안쪽 구석부터, 안 되면 바깥쪽에.
    if (putLegend(text, cls, sid, strokeCls, muted)) return;
    // 위 방법이 모두 막힌 극단적인 경우에만(있을 수 없을 만큼 빽빽함) 최후 수단으로 가장 덜
    // 겹치는 자리에 놓는다.
    const all = [...cands, ...qc];
    const noPlaced = all.filter(c => !placed.some(q => boxHits(inflate(boxOf(c[0], c[1], text, fsz, c[2]), LABEL_GAP), q)));
    const best = pickLeastBad((noPlaced.length ? noPlaced : all).map(c => [...c, cls, text]));
    emit(best[0], best[1], text, cls, best[2], undefined, seriesAttr);
  };
  // 계열 선이 그래프 틀(x0~x1, y0~y1)을 벗어나는 지점 바로 바깥에 라벨을 놓는다 — 화살표 끝
  // 축 이름과 같은 방식(freeIgnoringBounds+growViewBox)으로, 틀 밖으로 나가도 된다. side에 따라
  // 위/아래/좌/우 중 벗어나는 쪽으로만 나가고, 그 쪽을 따라 몇 자리를 훑어(다른 계열의 exit
  // 라벨과 겹칠 수 있어서) 겹치면 조금씩 옮긴다.
  const putExitLabel = (text, cls, sid, side, ex, ey) => {
    const fsz = FS[cls] || 34, gap = 14, step = fsz * 1.3;
    const cands = side === 'top' ? [0, 1, 2].map(k => [ex, ey - gap - k * step, 'middle'])
      : side === 'bottom' ? [0, 1, 2].map(k => [ex, ey + gap + fsz + k * step, 'middle'])
      : side === 'right' ? [0, 1, -1].map(k => [ex + gap, ey + k * step, 'start'])
      : [0, 1, -1].map(k => [ex - gap, ey + k * step, 'end']);
    for (const [x, y, a] of cands) {
      const box = boxOf(x, y, text, fsz, a);
      if (freeIgnoringBounds(box)) { emit(x, y, text, cls, a, undefined, `data-series='${sid}' data-label-mode='exit'`); growViewBox(box); return true; }
    }
    return false;
  };
  // 작은 범례: 계열 색·굵기의 짧은 선(견본) + 글자를 한 덩어리로 놓는다 — 라벨이 자기 선 가까이도,
  // 틀 밖 exit 자리도 못 찾을 때(두 계열의 exit이 너무 가깝는 등) 마지막으로 쓴다. 플롯 안쪽
  // 우상단 구석부터 세로로 훑고, 거기도 안 되면 틀 바깥 오른쪽(축 이름과 같은 자리)에 놓는다.
  const putLegend = (text, cls, sid, strokeCls, muted) => {
    const fsz = FS[cls] || 34, swatchW = 26, gap = 8, rowH = fsz * 1.35;
    const place = (rightX, outside) => {
      for (let k = 0; k < 6; k++) {
        const y = PLOT_BOUNDS.t + 26 + k * rowH;
        const textBox = boxOf(rightX, y, text, fsz, 'end');
        const swatchX2 = textBox.l - gap, swatchX1 = swatchX2 - swatchW;
        const combined = { l: swatchX1, r: textBox.r, t: Math.min(textBox.t, y - fsz * 0.28), b: Math.max(textBox.b, y + fsz * 0.28) };
        const ok = outside ? freeIgnoringBounds(combined) : free(combined, false, PLOT_BOUNDS);
        if (ok) {
          out.push(`<line x1='${r2(swatchX1)}' y1='${r2(y)}' x2='${r2(swatchX2)}' y2='${r2(y)}' class='${strokeCls || 'v-ink-s'}' stroke-width='5' stroke-linecap='round' ${muted ? "opacity='.5'" : ''} data-series='${sid}' data-label-mode='legend-swatch'/>`);
          emit(rightX, y, text, cls, 'end', undefined, `data-series='${sid}' data-label-mode='legend'`);
          placed.push(combined);
          if (outside) growViewBox(combined);
          return true;
        }
      }
      return false;
    };
    return place(PLOT_BOUNDS.r - 8, false) || place(sx(x1) + 34 + swatchW + gap + textW(Array.isArray(text) ? text[0] : text, fsz), true);
  };
  // 점·데이터·보조선 라벨은 "자기 자리 근처"에서만 찾는다 — 우상단 구석으로 보내면 어느 점의
  // 라벨인지 알아보기 힘들어진다. 8방향 × 반지름 3단계(라벨 높이의 1×, 1.6×, 2.4×)로 점점 넓혀
  // 가며 찾고, 그래도 자리가 없으면(그래프가 아주 빽빽함) 그중 가장 덜 겹치는 자리에 놓는다 —
  // quadrantCands()(먼 구석)로는 절대 보내지 않는다.
  // 방향 벡터는 모두 단위 벡터(길이 1)로 둔다 — 대각선도 (dx,dy)를 그냥 0.8/0.8처럼 쓰면 실제
  // 거리가 반지름보다 커져서(√2 배 가까이) "2.4×까지"라는 약속을 넘어 버린다.
  const D45 = Math.SQRT1_2;
  const RING_DIRS = { n: [0, -1, 'middle'], ne: [D45, -D45, 'start'], e: [1, 0, 'start'], se: [D45, D45, 'start'],
    s: [0, 1, 'middle'], sw: [-D45, D45, 'end'], w: [-1, 0, 'end'], nw: [-D45, -D45, 'end'] };
  const ringCands = (X, Y, cls, order) => {
    const fs = FS[cls] || 34;
    const dirs = [...new Set([...(order || []), 'ne', 'nw', 'se', 'sw', 'n', 's', 'e', 'w'])].filter(d => RING_DIRS[d]);
    const out = [];
    for (const mult of [1, 1.6, 2.4]) for (const d of dirs) {
      const [dx, dy, a] = RING_DIRS[d], r = fs * mult;
      out.push([X + dx * r, Y + dy * r, a]);
    }
    return out;
  };
  // 후보 중 하나도 안 비면 scoreBox가 가장 낮은(가장 덜 겹치는) 것을 고른다 — 앞에서부터 훑으므로
  // (반지름이 작은 순, order가 준 방향이 먼저) 점수가 같으면 더 가깝고·선호된 방향이 이긴다.
  const pickLeastBad = cands => {
    let best = null, bestScore = Infinity;
    for (const c of cands) { const sc = scoreBox(boxOf(c[0], c[1], c[4], FS[c[3]] || 34, c[2]), PLOT_BOUNDS); if (sc < bestScore) { bestScore = sc; best = c; } }
    return best;
  };
  // 점 라벨은 항상 한 줄이다(줄바꿈 없음 — "(0, 1)" 같은 좌표를 "(0, / 1)"로 접으면 깨져 보인다).
  // 링(8방향×3단계)으로 안 되면 수평으로 더 멀리(예: y축 위의 점이면 y축 왼쪽으로, 격자선과는
  // 겹쳐도 된다 — 격자선은 obstacles에 없다) 보내 보고, 그래도 없으면 플롯 전체를 훑는다.
  const farCands = (X, Y, cls, order) => {
    const fs = FS[cls] || 34;
    const dirs = [...new Set(['w', 'e', ...(order || [])])].filter(d => RING_DIRS[d]);
    const out = [];
    for (const mult of [3.2, 4.2, 5.6, 7.2]) for (const d of dirs) {
      const [dx, dy, a] = RING_DIRS[d], r = fs * mult;
      out.push([X + dx * r, Y + dy * r, a]);
    }
    return out;
  };
  // minGap: 자기 마커(원)와 최소 이만큼(중심에서 상자까지) 떨어뜨린다 — 반지름이 작은 링(1×)은
  // 라벨을 점 아래(s·se·sw)에 놓을 때 글자 위쪽 여백(어센더)이 점 쪽으로 되돌아와 마커에 닿거나
  // 겹칠 수 있어서(자기 점은 free()가 일부러 봐주므로 거기서는 안 걸러진다), 그 방향만 큰 반지름
  // 링으로 건너뛰게 한다. 마커에서 떨어진 후보가 하나도 없으면(극히 드묾) 원래 후보로 되돌아간다.
  // 여러 단계로 자리를 찾는다: ① 자기 점 주변 링, tickZone(눈금 자리)까지 지킴 → ② 링, tickZone만
  // 눈감음(점이 축에 바짝 붙어 있으면 링 전체가 눈금 띠에 걸릴 수 있다) → ③ 수평으로 더 멀리(격자선
  // 겹침 허용) → ④ 그래도 없으면 플롯 전체(quadrantCands)에서 찾는다 → ⑤ 그래도 없으면(그래프가
  // 극도로 빽빽함) 가장 덜 겹치는 자리를 고른다. minGap(자기 마커와의 최소 간격)은 ④까지 지킨다.
  const putAnchored = (X, Y, text, cls, order, minGap) => {
    const clearsFor = t => c => !minGap || distToBox(boxOf(c[0], c[1], t, FS[cls] || 34, c[2]), X, Y) >= minGap;
    const tryPool = (poolCands, isTick) => {
      const cl = clearsFor(text);
      for (const [x, y, a] of poolCands) if (cl([x, y, a]) && free(boxOf(x, y, text, FS[cls] || 34, a), isTick, PLOT_BOUNDS)) return [x, y, a];
      return null;
    };
    const ring = ringCands(X, Y, cls, order), far = farCands(X, Y, cls, order), quad = quadrantCands();
    const cl = clearsFor(text);
    let hit = tryPool(ring, false) || tryPool(ring, true);
    if (!hit) hit = tryPool(far, true);
    if (hit) { const [x, y, a] = hit; emit(x, y, text, cls, a, [X, Y]); return; }
    // 플롯 틀(PLOT_BOUNDS) 안에서는(격자선 겹침까지 허용해도) 자리가 없다 — 점이 축에 바짝 붙어
    // 있으면(예: y축 위의 점) 좁은 틀 안에서는 수평으로 아무리 밀어도 자리가 없을 수 있다. 그때는
    // 틀 경계까지 무시하고(선·축·다른 라벨만 피하면 된다) 더 밀어 본다 — 축 이름처럼 필요하면
    // viewBox를 늘린다.
    for (const [x, y, a] of far) {
      if (!cl([x, y, a])) continue;
      const box = boxOf(x, y, text, FS[cls] || 34, a);
      if (freeIgnoringBounds(box)) { emit(x, y, text, cls, a, [X, Y]); growViewBox(box); return; }
    }
    if (!hit) hit = tryPool(quad, true);
    if (hit) { const [x, y, a] = hit; emit(x, y, text, cls, a, [X, Y]); return; }
    // 위 단계가 다 free()를 못 찾으면(그래프가 극도로 빽빽함) 그 후보들을 모두 합쳐 가장 덜
    // 겹치는 자리를 고른다 — 링만 보면 far·quadrant 중에 더 나은 자리가 있어도 놓친다.
    const all = [...ring, ...far, ...quad];
    const pool = minGap ? all.filter(c => cl(c)) : all;
    const [x, y, a] = pickLeastBad((pool.length ? pool : all).map(c => [...c, cls, text]));
    emit(x, y, text, cls, a, [X, Y]);
  };
  // data 라벨: 마지막 점부터(자기 계열의 대표 점) 링을 훑는다 — 마지막 점 옆이 안 되면 그다음
  // 안쪽 점 옆을 본다. err(오차막대) 캡·수염도 obstacles에 이미 들어 있어 그 위에 겹치지 않는다.
  const putDataLabel = (points, text, cls) => {
    const order = ['ne', 'se', 'nw', 'sw', 'e', 'w'];
    const tried = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const [px, py] = points[i], X = sx(px), Y = sy(py);
      const cands = ringCands(X, Y, cls, order);
      for (const [x, y, a] of cands) if (free(boxOf(x, y, text, FS[cls] || 34, a), false, PLOT_BOUNDS)) { emit(x, y, text, cls, a, [X, Y]); return; }
      tried.push(...cands.map(c => [...c, cls, text, X, Y]));
    }
    const best = pickLeastBad(tried);
    emit(best[0], best[1], text, cls, best[2], [best[5], best[6]]);
  };

  // 격자
  if (p.grid !== false) {
    for (let x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step) out.push(`<line x1='${r2(sx(x))}' y1='${r2(sy(y0))}' x2='${r2(sx(x))}' y2='${r2(sy(y1))}' class='v-line' stroke-width='1.5' opacity='.55'/>`);
    for (let y = Math.ceil(y0 / yStep) * yStep; y <= y1 + 1e-9; y += yStep) out.push(`<line x1='${r2(sx(x0))}' y1='${r2(sy(y))}' x2='${r2(sx(x1))}' y2='${r2(sy(y))}' class='v-line' stroke-width='1.5' opacity='.55'/>`);
  }
  // 축과 화살표 — 주요 그래프 축은 primary(design.md "팔레트")
  const ax = Math.min(Math.max(0, y0), y1), ay = Math.min(Math.max(0, x0), x1);
  out.push(`<line x1='${r2(sx(x0))}' y1='${r2(sy(ax))}' x2='${r2(sx(x1) + 18)}' y2='${r2(sy(ax))}' class='v-primary-s' stroke-width='4'/>`);
  out.push(`<line x1='${r2(sx(ay))}' y1='${r2(sy(y0))}' x2='${r2(sx(ay))}' y2='${r2(sy(y1) - 18)}' class='v-primary-s' stroke-width='4'/>`);
  out.push(`<path d='M${r2(sx(x1) + 30)} ${r2(sy(ax))} l-16 -9 v18 z' class='v-primary'/><path d='M${r2(sx(ay))} ${r2(sy(y1) - 30)} l-9 16 h18 z' class='v-primary'/>`);
  obstacles.push({ x1: sx(x0), y1: sy(ax), x2: sx(x1) + 30, y2: sy(ax) }, { x1: sx(ay), y1: sy(y0), x2: sx(ay), y2: sy(y1) - 30 });

  // 그래프 영역 밖으로 나가는 선은 잘라 낸다
  const cid = `cf-clip-${++clipSeq}`;
  out.push(`<defs><clipPath id='${cid}'><rect x='${pad}' y='${padTop}' width='${W - 2 * pad}' height='${H - padTop - pad}'/></clipPath></defs>`);
  const clip = `clip-path='url(#${cid})'`;

  // 도형 (라벨은 나중에)
  // 각 직선·곡선에 식별자(data-series)를 매겨 DOM에 남긴다 — 게이트 B2-LABELOWN이 "이 라벨이
  // 자기 계열 선 가까이 있는지"를 이 id로 라벨(data-series)과 선(data-series)을 짝지어 잰다.
  // seriesSegs[id]는 그 계열만의(다른 계열 제외) 화면 선분 목록 — 라벨 배치 때 "내 선까지 거리"
  // 계산에도 그대로 쓴다(게이트와 같은 잣대를 빌드 시점에 미리 적용해 둔다).
  const seriesSegs = {};
  p.lines?.forEach((l, li) => {
    const sid = `l${li}`;
    const [s] = CLS[l.style || 'accent'];
    const w = l.style === 'muted' ? 6 : 7, op = l.style === 'muted' ? "opacity='.5'" : '';
    const domFrom = l.from ?? x0, domTo = l.to ?? x1;   // from~to만 실선, 그 밖은 extend:'dash'일 때만 점선 외삽
    const mySegs = [];
    const seg = (fx, tx, dashed) => {
      const yfx = l.a * fx + l.b, ytx = l.a * tx + l.b;
      // y0~y1 밖으로 나가는 부분은 clip-path(화면 표시)뿐 아니라 좌표 자체도 잘라 낸다 — 안 그러면
      // DOM에 남는 <line> 좌표가 화면에 보이지도 않는 범위까지 뻗어 있어, 게이트의 라벨-선 관통
      // 검사(실제 DOM 좌표를 그대로 읽는다)가 보이지 않는 부분과의 "관통"을 잘못 잡아낸다.
      const clipped = clipLineToY(fx, yfx, tx, ytx, y0, y1);
      if (!clipped) return;
      const [cx1, cy1, cx2, cy2] = clipped;
      out.push(`<line x1='${r2(sx(cx1))}' y1='${r2(sy(cy1))}' x2='${r2(sx(cx2))}' y2='${r2(sy(cy2))}' class='${s}' stroke-width='${w}' stroke-linecap='round' ${op} ${dashed || l.dash ? "stroke-dasharray='14 12'" : ''} data-series='${sid}' ${clip}/>`);
      mySegs.push(...clipSeg(fx, yfx, tx, ytx));
    };
    seg(domFrom, domTo, false);
    if (l.extend === 'dash') {
      if (domFrom > x0) seg(x0, domFrom, true);
      if (domTo < x1) seg(domTo, x1, true);
    }
    seriesSegs[sid] = mySegs;
  });
  const curveFns = [];
  (p.curves || []).forEach((c, ci) => {
    const sid = `c${ci}`;
    const f = compileCurve(c.fn);
    curveFns.push(f);
    const [s] = CLS[c.style || 'accent'];
    // 1/x 같은 식은 점근선 근처에서 f(x)가 ±Infinity(또는 화면 밖으로 치솟는 거대한 값)가 된다.
    // 그대로 이으면 -Infinity가 points 속성에 그대로 찍혀 SVG가 깨지거나(B8 콘솔 오류로만 뒤늦게 드러남),
    // 값이 유한해도 점근선 양쪽(-큰값 → +큰값)을 잇는 선이 그래프 한가운데를 가로질러 그어진다.
    // 화면 범위보다 훨씬 먼 점은 건너뛰고 그 자리에서 선을 끊어 새로 시작한다.
    const YLIM = Math.max(Math.abs(y0), Math.abs(y1)) + (y1 - y0) * 4 + 1;
    const mySegs = [];
    let seg = [], broke = false;
    const flush = () => {
      // y0~y1 안에 있는 부분만 그린다(위 lines와 같은 이유 — clip-path만으로는 DOM 좌표가 화면
      // 밖까지 남아 게이트가 보이지 않는 부분과의 관통을 잘못 잡는다). 한 조각(seg)이 경계를
      // 넘나들면 여러 폴리라인으로 쪼개질 수 있다(clipRunToY가 경계에서 정확히 잘라 잇는다).
      for (const run of clipRunToY(seg, y0, y1)) {
        out.push(`<polyline points='${run.map(([x, y]) => `${r2(sx(x))},${r2(sy(y))}`).join(' ')}' class='${s}' stroke-width='7' stroke-linejoin='round' data-series='${sid}' ${clip}/>`);
        for (let i = 1; i < run.length; i++) mySegs.push(...clipSeg(run[i - 1][0], run[i - 1][1], run[i][0], run[i][1]));
      }
      seg = [];
    };
    for (let i = 0; i <= 200; i++) {
      const x = x0 + (x1 - x0) * i / 200, y = f(x);
      if (!Number.isFinite(y) || Math.abs(y) > YLIM) { flush(); broke = true; continue; }
      seg.push([x, y]);
    }
    flush();
    seriesSegs[sid] = mySegs;
    if (broke) console.warn(`plot.curves: "${c.fn}"에 점근선(정의되지 않거나 화면 밖으로 치솟는 구간)이 있어 그 앞뒤를 끊어서 그렸습니다`);
  });
  for (const g of p.segments || []) {
    const [s] = CLS[g.style || 'ink'];
    out.push(`<line x1='${r2(sx(g.from[0]))}' y1='${r2(sy(g.from[1]))}' x2='${r2(sx(g.to[0]))}' y2='${r2(sy(g.to[1]))}' class='${s}' stroke-width='5' ${g.dash !== false ? "stroke-dasharray='10 9'" : ''}/>`);
    obstacles.push({ x1: sx(g.from[0]), y1: sy(g.from[1]), x2: sx(g.to[0]), y2: sy(g.to[1]) });
  }
  for (const pt of p.points || []) {
    const [, f] = CLS[pt.style || 'accent'];
    out.push(`<circle cx='${r2(sx(pt.x))}' cy='${r2(sy(pt.y))}' r='11' class='${f}' stroke='var(--paper, #fff)' stroke-width='4'/>`);
    dots.push({ x: sx(pt.x), y: sy(pt.y) });
  }
  // data(실측값): points(원)와 다른 마름모 마커로 그려 "예측선 vs 측정점"이 한눈에 구분되게 한다.
  // err가 있으면 세로 오차막대(양끝에 짧은 가로 캡)도 함께 그린다.
  for (const d of p.data || []) {
    const [strokeCls, fillCls] = CLS[d.style || 'ink'];
    (d.points || []).forEach(([x, y], i) => {
      const X = sx(x), Y = sy(y);
      const e = Array.isArray(d.err) ? d.err[i] : d.err;
      if (e) {
        const yTop = sy(y + e), yBot = sy(y - e);
        out.push(`<line x1='${r2(X)}' y1='${r2(yTop)}' x2='${r2(X)}' y2='${r2(yBot)}' class='${strokeCls}' stroke-width='4'/>`);
        out.push(`<line x1='${r2(X - 9)}' y1='${r2(yTop)}' x2='${r2(X + 9)}' y2='${r2(yTop)}' class='${strokeCls}' stroke-width='4'/>`);
        out.push(`<line x1='${r2(X - 9)}' y1='${r2(yBot)}' x2='${r2(X + 9)}' y2='${r2(yBot)}' class='${strokeCls}' stroke-width='4'/>`);
        // 세로 수염뿐 아니라 양끝 가로 캡도 라벨이 피해야 할 장애물이다(캡 위에 라벨이 겹치는 회귀가 있었다)
        obstacles.push({ x1: X, y1: yTop, x2: X, y2: yBot }, { x1: X - 9, y1: yTop, x2: X + 9, y2: yTop }, { x1: X - 9, y1: yBot, x2: X + 9, y2: yBot });
      }
      out.push(`<polygon points='${r2(X)},${r2(Y - 12)} ${r2(X + 12)},${r2(Y)} ${r2(X)},${r2(Y + 12)} ${r2(X - 12)},${r2(Y)}' class='${fillCls}' stroke='var(--paper, #fff)' stroke-width='4'/>`);
      dots.push({ x: X, y: Y });
    });
  }

  // 눈금 숫자가 들어갈 띠를 예약: x축 아래 한 줄, y축 왼쪽 한 칸. x축 쪽은 축 아래(눈금 숫자)뿐
  // 아니라 축 바로 위(곡선과 축 사이)까지 넓게 잡는다 — 그 좁은 틈에 라벨을 놓으면 어느 계열
  // 것인지도 모르게 축 옆에 붕 떠 보인다(계열 라벨은 그 계열 옆에 있어야 한다).
  tickZone.push({ l: sx(x0) - 10, r: sx(x1) + 10, t: sy(ax) - 56, b: sy(ax) + 46 });
  tickZone.push({ l: sx(ay) - 64, r: sx(ay) - 4, t: sy(y1) - 10, b: sy(y0) + 10 });

  // 축 이름 놓기: 다른 라벨(점·직선·곡선·눈금)을 모두 배치한 맨 마지막에 놓는다(아래 실행부).
  // free()는 "원래 W×H 안에 들어가야 한다"는 조건이 있어서 못 쓴다 — 축 이름은 길면 일부러 원래
  // W×H 밖으로 나가도록 두고 나중에 viewBox를 늘릴 것이므로, 그 조건만 뺀 별도 판정을 쓴다.
  // tickZone(눈금 숫자 자리)는 일부러 뺐다 — 축 이름은 문장이라 눈금 숫자로 오독될 리 없고, y축 눈금
  // 띠는 세로로 플롯 전체 높이만큼 길어서 가로로 넓은 축 이름은 세로로 어디로 옮겨도 항상 걸리게 된다.
  const freeIgnoringBounds = b => !obstacles.some(s => segHits(b, s))
    && !dots.some(d => b.l - 10 < d.x && b.r + 10 > d.x && b.t - 10 < d.y && b.b + 10 > d.y) && !placed.some(q => boxHits(inflate(b, LABEL_GAP), q));
  const placeAxisLabel = (cands, text) => {
    let chosen = null;
    for (const [x, y, a] of cands) {
      const box = boxOf(x, y, text, FS['v-label-s'], a);
      if (freeIgnoringBounds(box)) { chosen = [x, y, a, box]; break; }
    }
    if (!chosen) { const [x, y, a] = cands[0]; chosen = [x, y, a, boxOf(x, y, text, FS['v-label-s'], a)]; }
    const [x, y, a, box] = chosen;
    emit(x, y, text, 'v-label-s', a);
    growViewBox(box);
  };
  // 라벨: 점 → 데이터 → 보조선 → 직선 → 곡선 → 눈금 순서로 빈자리에 놓는다
  for (const pt of p.points || []) {
    if (!pt.label) continue;
    const [, , cls] = CLS[pt.style || 'accent'];
    const X = sx(pt.x), Y = sy(pt.y);
    const order = [pt.pos || 'nw', 'nw', 'ne', 'w', 'e', 'se', 'sw'].filter((v, i, a) => a.indexOf(v) === i);
    const k = dots.findIndex(d => d.x === X && d.y === Y), self = dots.splice(k, 1);   // 자기 점은 피하지 않는다
    putAnchored(X, Y, pt.label, cls, order, 19);   // 마커 반지름(11)+halo+여백만큼 최소 간격을 둔다
    dots.push(...self);
  }
  // data 라벨: 계열마다 하나만(마지막 점 옆에) — 점마다 달면 실측값처럼 여러 점일 때 서로 겹쳐 어지럽다.
  // 이 라벨이 사실상 범례 역할을 한다(측정값 계열임을 표시).
  for (const d of p.data || []) {
    if (!d.label || !d.points?.length) continue;
    const [, , cls] = CLS[d.style || 'ink'];
    // 자기 계열의 점들은 잠시 빼둔다(라벨을 그 옆에 붙여야 하므로)
    const selfDots = d.points.map(([x, y]) => ({ x: sx(x), y: sy(y) }));
    selfDots.forEach(sd => { const k = dots.findIndex(dd => dd.x === sd.x && dd.y === sd.y); if (k >= 0) dots.splice(k, 1); });
    putDataLabel(d.points, d.label, cls);
    dots.push(...selfDots);
  }
  for (const g of p.segments || []) {
    if (!g.label) continue;
    const [, , cls] = CLS[g.style || 'ink'];
    const mx = (sx(g.from[0]) + sx(g.to[0])) / 2, my = (sy(g.from[1]) + sy(g.to[1])) / 2, horiz = g.from[1] === g.to[1];
    putAnchored(mx, my, g.label, cls, horiz ? ['s', 'n'] : ['e', 'w', 'se', 'ne']);
  }
  // 계열 id별 "다른 모든 계열"의 선분 — 라벨-소유 규칙(own-line)에서 "다른 선보다 가까우면 안 된다"를
  // 잴 때 쓴다. seriesSegs는 위 도형 그리기 루프에서 lines·curves 둘 다 채워 뒀다.
  const otherSegsFor = sid => Object.entries(seriesSegs).filter(([k]) => k !== sid).flatMap(([, v]) => v);
  // 그 계열의 화면 선분 목록(seriesSegs[sid])의 첫/끝 점이 그래프 틀 경계(x0·x1·y0·y1)에 닿아
  // 있으면 그게 "보이는 선이 틀을 벗어나는 지점"이다(clipLineToY/clipRunToY가 이미 경계에서 정확히
  // 잘라 뒀으므로 좌표가 정확히 그 경계와 같다) — putSeries의 exit-라벨 후보로 쓴다. 안쪽(예: from/to를
  // 좁혀서 틀 안에서 끝나는 선)이면 side가 null이라 exit 후보에서 빠진다.
  const exitPtsFor = sid => {
    const segs = seriesSegs[sid];
    if (!segs || !segs.length) return [];
    const sideOfScreenPt = (px, py) => {
      const EPS = 2;
      if (Math.abs(py - sy(y1)) < EPS) return 'top';
      if (Math.abs(py - sy(y0)) < EPS) return 'bottom';
      if (Math.abs(px - sx(x1)) < EPS) return 'right';
      if (Math.abs(px - sx(x0)) < EPS) return 'left';
      return null;
    };
    const first = segs[0], last = segs[segs.length - 1];
    const out = [];
    const sb = sideOfScreenPt(last.x2, last.y2); if (sb) out.push([last.x2, last.y2, sb]);
    const sa = sideOfScreenPt(first.x1, first.y1); if (sa) out.push([first.x1, first.y1, sa]);
    return out;
  };
  p.lines?.forEach((l, li) => {
    if (!l.label) return;
    const sid = `l${li}`;
    const [strokeCls, , cls] = CLS[l.style || 'accent'];
    const domFrom = l.from ?? x0, domTo = l.to ?? x1;   // 라벨은 실선 구간(from~to) 안에 놓는다
    // 선의 양 끝점 근처는 라벨이 피해야 할 자리로 등록한다 — 안 그러면 "끝점 바로 옆"을 우선하는
    // 아래 후보 순서 때문에 라벨이 정확히 선 끝에 걸치는 사고가 난다(끝점도 다른 점처럼 취급).
    dots.push({ x: sx(domFrom), y: sy(l.a * domFrom + l.b) }, { x: sx(domTo), y: sy(l.a * domTo + l.b) });
    // 여러 직선이 한 점(주로 원점)에서 부채꼴로 퍼질 때: 그 점 가까이에 라벨을 놓으면 다른 선·
    // 라벨과 다닥다닥 붙어 겹친다. 이웃 직선들과 세로로 가장 많이 벌어지는 쪽 끝에서 70~85%
    // 지점부터(원점 등에서 최대한 떨어뜨려) 안쪽으로 훑는다. author가 at을 줬으면 그 자리를
    // 최우선으로 쓰되, 겹치면(자리가 없으면) 그 근처를 앞뒤로 더 찾아본다 — at 하나만 후보로
    // 두면 겹칠 때 갈 곳이 없어 아무 데나(다른 라벨 위 포함) 놓이던 문제가 있었다.
    const others = (p.lines || []).filter(o => o !== l);
    const span = domTo - domFrom;
    const gapAt = x => { const y = l.a * x + l.b; return others.length ? Math.min(...others.map(o => Math.abs(y - (o.a * x + o.b)))) : Infinity; };
    const fromHigh = gapAt(domTo) >= gapAt(domFrom);
    // 원점 쪽 끝을 우선 피하되(선호하는 쪽을 먼저 훑는다), 글자 상자가 넓어서(한글 여러 글자) 그
    // 쪽마저 다른 직선의 보이는 구간과 겹치는 경우에 대비해 반대쪽 끝도 차선책으로 남겨 둔다 —
    // free()가 실제 충돌 여부를 정확히 판정하므로, 후보를 넉넉히 주는 편이 여기서 도메인 y값만
    // 보고 미리 방향을 좁히는 것보다 안전하다.
    const sweepFracs = [0.8, 0.72, 0.85, 0.64, 0.9, 0.56, 0.48, 0.4, 0.32, 0.24, 0.16, 0.08];
    const endHigh = sweepFracs.map(f => domTo - span * f), endLow = sweepFracs.map(f => domFrom + span * f);
    const sweepXs = fromHigh ? [...endHigh, ...endLow] : [...endLow, ...endHigh];
    const atXs = l.at === undefined ? [] : [l.at, ...[0.06, -0.06, 0.12, -0.12, 0.18, -0.18, 0.26, -0.26].map(d => l.at + d * span)];
    const xs = [...atXs, ...sweepXs].filter(x => x > domFrom - 1e-9 && x < domTo + 1e-9);
    // 각 지점에서 접선에 수직인 방향으로 오프셋한다(고정폭 위·아래보다 완만한 선에서도 고르게
    // 떨어진다). 방향은 같은 x에서 다른 직선이 어느 쪽(스크린 좌표로 위/아래)에 있는지 보고,
    // 그 반대쪽(비어 있는 쪽)을 먼저 시도한다 — 반대편도 후보로 남겨(차선책) 완전히 막혔을 때
    // 대비한다. 여러 반지름(가까운 것부터 먼 것까지)도 함께 두어, 가까운 자리가 다른 선의 보이는
    // 구간과 겹치면 더 멀리 밀려날 여지를 준다.
    const tx = ux, ty = -uy * l.a, tlen = Math.hypot(tx, ty) || 1;
    const px = ty / tlen, py = -tx / tlen;   // 접선을 시계 방향으로 90도 돌린 값(기본은 "위쪽")
    const cands = xs.flatMap(x => {
      const y = l.a * x + l.b;
      if (y <= y0 || y >= y1) return [];
      const X = sx(x), Y = sy(y);
      let dot = 0;
      for (const o of others) dot += py * (sy(o.a * x + o.b) - Y);
      const flip = dot > 0 ? -1 : 1;   // 이웃이 기본 방향 쪽에 있으면 반대로 뒤집는다
      const [dx, dy] = [px * flip, py * flip];
      const out = [];
      for (const r of [24, 30, 20, 38, 50, 64]) out.push([X + dx * r, Y + dy * r, dx >= 0 ? 'start' : 'end']);
      for (const r of [24, 38, 50]) out.push([X - dx * r, Y - dy * r, -dx >= 0 ? 'start' : 'end']);   // 반대쪽(차선책)
      return out;
    });
    putSeries(cands, l.label, cls, sid, seriesSegs[sid], otherSegsFor(sid), strokeCls, l.style === 'muted', exitPtsFor(sid));
  });
  (p.curves || []).forEach((c, ci) => {
    if (!c.label) return;
    const sid = `c${ci}`;
    const [strokeCls, , cls] = CLS[c.style || 'accent'], f = curveFns[ci];
    // 곡선도 직선과 같은 이유로 양 끝점을 라벨이 피해야 할 자리로 등록한다.
    if (Number.isFinite(f(x0))) dots.push({ x: sx(x0), y: sy(f(x0)) });
    if (Number.isFinite(f(x1))) dots.push({ x: sx(x1), y: sy(f(x1)) });
    // 곡선도 마찬가지로 여러 지점 × 양쪽(위·아래)을 후보로 둔다.
    const cands = Array.from({ length: 18 }, (_, k) => x1 - (x1 - x0) * (0.04 + 0.05 * k)).filter(x => Number.isFinite(f(x)) && f(x) > y0 && f(x) < y1).flatMap(x => {
      const X = sx(x), Y = sy(f(x));
      return [[X + 18, Y - 18, 'start'], [X - 18, Y - 18, 'end'], [X + 18, Y + 44, 'start'], [X - 18, Y + 44, 'end']];
    });
    putSeries(cands, c.label, cls, sid, seriesSegs[sid], otherSegsFor(sid), strokeCls, c.style === 'muted', exitPtsFor(sid));
  });
  // 눈금 숫자: 자리가 없으면(선·점·라벨과 겹치면) 그 눈금은 숫자를 생략한다 — 격자로 셀 수 있다
  const every = Math.max(1, Math.ceil((x1 - x0) / step / 10));
  const everyY = Math.max(1, Math.ceil((y1 - y0) / yStep / 10));
  const edge = (v, lo, hi) => Math.abs(v - lo) < 1e-9 || Math.abs(v - hi) < 1e-9;
  // "O"(원점)도 다른 눈금 숫자와 같은 충돌 검사를 받게 한다 — 상자를 살짝 부풀려서(±6) 두어
  // 실제 폰트 렌더링이 상자 추정치보다 조금 더 클 때도 바로 위·아래 눈금과 붙어 보이지 않게 하고,
  // 그래도 너무 가까우면(예: 촘촘한 y축에서 -1과 O) 나중에 놓이는 그 눈금 쪽이 생략되게 한다.
  // 단, 두 축이 실제 (0,0)에서 만날 때만 "O"를 쓴다 — x 범위가 0을 포함하지 않으면(예: 진동수 5~10×10¹⁴)
  // 세로축은 x0에 그려지는데, 그 교차점에 "O"를 붙이면 학생이 거기를 원점으로 읽어 세로축 절편을
  // 잘못 읽는다(release/photoelectric 10번 실사고 — W≈2.3 eV를 0.25 eV로 읽게 됨). 그때는 "O" 대신
  // 교차점의 실제 눈금값을 아래 눈금 루프가 적는다.
  const atOrigin = Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9;
  if (atOrigin) {
    const oX = sx(ay) - 14, oY = sy(ax) + 38;
    const oBox = boxOf(oX, oY, 'O', FS['v-label-s'], 'end');
    const oBoxPadded = { l: oBox.l - 6, r: oBox.r + 6, t: oBox.t - 6, b: oBox.b + 6 };
    if (free(oBoxPadded, true)) { placed.push(oBoxPadded); labels.push(`<text x='${r2(oX)}' y='${r2(oY)}' class='v-label-s' text-anchor='end' ${HALO}>O</text>`); }
  }
  for (let i = 0, x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step, i++)
    if (Math.abs(x) > 1e-9 && i % every === 0 && (!edge(x, x0, x1) || (!atOrigin && Math.abs(x - ay) < 1e-9))) put([[sx(x), sy(ax) + 38, 'middle']], fmtTick(x, step), 'v-label-s');
  for (let i = 0, y = Math.ceil(y0 / yStep) * yStep; y <= y1 + 1e-9; y += yStep, i++)
    if (Math.abs(y) > 1e-9 && i % everyY === 0 && (!edge(y, y0, y1) || (!atOrigin && Math.abs(y - ax) < 1e-9))) put([[sx(ay) - 14, sy(y) + 10, 'end']], fmtTick(y, yStep), 'v-label-s');

  // 축 이름은 맨 마지막에 놓는다 — 점·직선·곡선·눈금 라벨이 먼저 자기 자리를 차지하게 두고,
  // 축 이름은 그 나머지 빈 자리를 찾는다(더 구체적인 정보를 담은 라벨이 우선한다).
  // x축 이름은 화살표 끝 바로 오른쪽(anchor='start', 오른쪽으로만 자라서 y축 눈금 숫자 열과는
  // 애초에 안 부딪힌다)을 1순위로 하고, 자리가 없으면 화살표 끝 바로 아래(눈금 줄과 같은 높이,
  // 그 한 줄 더 아래로 떨어뜨리지 않는다)로 옮긴다.
  placeAxisLabel([
    [sx(x1) + 34, sy(ax) + 10, 'start'],
    [sx(x1) + 34, sy(ax) + 46, 'start'],
    [sx(x1) - 4, sy(ax) + 56, 'end'],
    [sx(x1) - 4, sy(ax) + 90, 'end'],
  ], p.xLabel ?? p.axes?.x ?? 'x');
  placeAxisLabel([0, 1, 2, 3].map(k => [sx(ay) + 16, sy(y1) - 16 - k * 30, 'start']), p.yLabel ?? p.axes?.y ?? 'y');

  out.push(...labels, '</svg>');
  if (vbMinX !== 0 || vbMinY !== 0 || vbMaxX !== W || vbMaxY !== H)
    out[0] = `<svg viewBox='${r2(vbMinX)} ${r2(vbMinY)} ${r2(vbMaxX - vbMinX)} ${r2(vbMaxY - vbMinY)}' data-plot>`;
  return out.join('');
}

/**
 * bars: { items:[{label, value, hot?}], unit?:'℃', max?:number, min?:number, width?:800, height?:560 }
 * 값은 facts에 있어야 한다(S4가 대조).
 */
export function bars(b) {
  const W = b.width || 800, H = b.height || 560, padL = 24, padT = 60;
  const items = b.items || [];
  const vals = items.map(i => i.value);
  const hi = b.max ?? Math.max(0, ...vals) * 1.15, lo = b.min ?? Math.min(0, ...vals) * 1.25;
  const padB = lo === 0 && b.min === undefined ? 64 : 20;   // 모두 양수면 항목 이름 자리를 기준선 아래에
  const span = (hi - lo) || 1, plotH = H - padT - padB;
  const y = v => padT + (hi - v) / span * plotH;
  const bw = (W - padL * 2) / items.length;
  const out = [`<svg viewBox='0 0 ${W} ${H}' data-bars>`];
  out.push(`<line x1='${padL}' y1='${r2(y(0))}' x2='${W - padL}' y2='${r2(y(0))}' class='v-primary-s' stroke-width='4'/>`);
  items.forEach((it, i) => {
    const x = padL + i * bw + bw * 0.18, w = bw * 0.64, top = y(Math.max(0, it.value)), bot = y(Math.min(0, it.value));
    out.push(`<rect x='${r2(x)}' y='${r2(top)}' width='${r2(w)}' height='${r2(Math.max(2, bot - top))}' rx='6' class='${it.hot ? 'v-accent' : 'v-secondary'}'/>`);   // 강조 막대 코럴, 나머지 secondary
    const vy = it.value >= 0 ? top - 16 : bot + 38;
    out.push(`<text x='${r2(x + w / 2)}' y='${r2(vy)}' class='${it.hot ? 'v-label-a' : 'v-label'}' text-anchor='middle'>${esc(it.value)}${esc(b.unit || '')}</text>`);
    // 항목 이름: 양수 막대는 기준선 아래, 음수 막대는 기준선 위
    out.push(`<text x='${r2(x + w / 2)}' y='${r2(it.value >= 0 ? y(0) + 42 : y(0) - 14)}' class='v-label-s' text-anchor='middle'>${esc(it.label)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

// dims: 들어갈 칸의 기본 크기(글자가 줄어들지 않도록 viewBox를 칸에 맞춘다). 작성자가 width/height를 주면 그 값이 우선.
export function declarative(v, dims = {}) {
  if (v && typeof v === 'object' && v.plot) return plot({ ...dims, ...v.plot });
  if (v && typeof v === 'object' && v.bars) return bars({ ...dims, ...v.bars });
  return null;
}
