// classforge visuals — 선언형 삽화(좌표평면 그래프, 막대그래프)를 테마 클래스 SVG로 그린다.
// 손으로 그린 그래프는 기울기·눈금이 틀리기 쉬우므로, 수식과 값이 있는 그림은 여기서 계산해 그린다.
// 라벨은 선·점·다른 라벨과 부딪히지 않는 자리를 골라 놓는다(중요도: 점 > 보조선 > 직선 > 눈금).

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = n => Math.round(n * 100) / 100;
let clipSeq = 0;   // 한 문서에 그래프가 여러 개여도 clipPath id가 겹치지 않게
const CLS = { accent: ['v-accent-s', 'v-accent', 'v-label-a'], ink: ['v-ink-s', 'v-ink', 'v-label'], muted: ['v-ink-s', 'v-muted', 'v-label-s'] };
const HALO = "paint-order='stroke' stroke='var(--paper, #fff)' stroke-width='9' stroke-linejoin='round'";
const FS = { 'v-label': 34, 'v-label-a': 34, 'v-label-s': 28 };

// ── 충돌 계산 ────────────────────────────────────────────
const textW = (t, fs) => [...String(t)].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 1.0 : /[A-Za-z0-9=+\-(),.·½²³ ]/.test(ch) ? 0.6 : 0.8) * fs, 0);
function boxOf(x, y, t, fs, anchor) {   // SVG text (x,y는 기준선) → 사각형
  const w = textW(t, fs), h = fs * 0.95;
  const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return { l: left - 4, r: left + w + 4, t: y - h, b: y + fs * 0.22 };
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

/**
 * plot: { x:[min,max], y:[min,max], step?:1, width?:800, height?:640, grid?:true,
 *         xLabel?:'시간(초)', yLabel?:'거리(m)',                                // 화살표 끝 축 이름(기본 x/y). 예전 이름 axes:{x,y}도 그대로 통한다
 *         lines:[{a,b,label?,style?:'accent'|'ink'|'muted',dash?,at?,
 *                 from?,to?,extend?:'dash'}]      // y = a·x + b. from~to 구간만 실선으로 그리고,
 *                                                  // extend:'dash'면 그 밖(x0~from, to~x1)은 점선 외삽으로 그린다
 *         curves:[{fn:'x*x-2', label?, style?}]                                // 간단한 식 (x만 사용)
 *         points:[{x,y,label?,style?,pos?:'ne'|'nw'|'se'|'sw'}]
 *         segments:[{from:[x,y], to:[x,y], label?, style?, dash?}] }
 */
export function plot(p) {
  const pad = 60;
  const [x0, x1] = p.x || [-5, 5], [y0, y1] = p.y || [-5, 5];
  const step = p.step || 1;
  // 가로·세로 한 칸의 길이를 같게 한다(다르면 기울기가 틀려 보인다). 남는 쪽은 viewBox를 줄인다.
  const unit = Math.min(((p.width || 800) - 2 * pad) / (x1 - x0), ((p.height || 640) - 2 * pad) / (y1 - y0));
  const W = Math.round(unit * (x1 - x0) + 2 * pad), H = Math.round(unit * (y1 - y0) + 2 * pad);
  const sx = x => pad + (x - x0) * unit;
  const sy = y => H - pad - (y - y0) * unit;
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
  const free = (b, isTick) => b.l >= 2 && b.r <= W - 2 && b.t >= 2 && b.b <= H - 2
    && (isTick || !tickZone.some(z => boxHits(b, z)))
    && !obstacles.some(s => segHits(b, s))
    && !dots.some(d => b.l - 10 < d.x && b.r + 10 > d.x && b.t - 10 < d.y && b.b + 10 > d.y)
    && !placed.some(q => boxHits(b, q));
  const emit = (x, y, text, cls, a) => { placed.push(boxOf(x, y, text, FS[cls] || 34, a)); labels.push(`<text x='${r2(x)}' y='${r2(y)}' class='${cls}' text-anchor='${a}' ${HALO}>${esc(text)}</text>`); };
  // cands: [[x,y,anchor],...] 첫 번째 빈자리에 놓는다. must면 빈자리가 없을 때 첫 후보에 놓는다(글자 테두리로 읽힘).
  const put = (cands, text, cls, must) => {
    const isTick = cls === 'v-label-s' && /^-?[\d.]+$|^O$/.test(text);
    for (const [x, y, a] of cands) if (free(boxOf(x, y, text, FS[cls] || 34, a), isTick)) { emit(x, y, text, cls, a); return true; }
    if (must && cands[0]) emit(...cands[0].slice(0, 2), text, cls, cands[0][2]);
    return false;
  };

  // 격자
  if (p.grid !== false) {
    for (let x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step) out.push(`<line x1='${r2(sx(x))}' y1='${r2(sy(y0))}' x2='${r2(sx(x))}' y2='${r2(sy(y1))}' class='v-line' stroke-width='1.5' opacity='.55'/>`);
    for (let y = Math.ceil(y0 / step) * step; y <= y1 + 1e-9; y += step) out.push(`<line x1='${r2(sx(x0))}' y1='${r2(sy(y))}' x2='${r2(sx(x1))}' y2='${r2(sy(y))}' class='v-line' stroke-width='1.5' opacity='.55'/>`);
  }
  // 축과 화살표
  const ax = Math.min(Math.max(0, y0), y1), ay = Math.min(Math.max(0, x0), x1);
  out.push(`<line x1='${r2(sx(x0))}' y1='${r2(sy(ax))}' x2='${r2(sx(x1) + 18)}' y2='${r2(sy(ax))}' class='v-ink-s' stroke-width='4'/>`);
  out.push(`<line x1='${r2(sx(ay))}' y1='${r2(sy(y0))}' x2='${r2(sx(ay))}' y2='${r2(sy(y1) - 18)}' class='v-ink-s' stroke-width='4'/>`);
  out.push(`<path d='M${r2(sx(x1) + 30)} ${r2(sy(ax))} l-16 -9 v18 z' class='v-ink'/><path d='M${r2(sx(ay))} ${r2(sy(y1) - 30)} l-9 16 h18 z' class='v-ink'/>`);
  obstacles.push({ x1: sx(x0), y1: sy(ax), x2: sx(x1) + 30, y2: sy(ax) }, { x1: sx(ay), y1: sy(y0), x2: sx(ay), y2: sy(y1) - 30 });

  // 그래프 영역 밖으로 나가는 선은 잘라 낸다
  const cid = `cf-clip-${++clipSeq}`;
  out.push(`<defs><clipPath id='${cid}'><rect x='${pad}' y='${pad}' width='${W - 2 * pad}' height='${H - 2 * pad}'/></clipPath></defs>`);
  const clip = `clip-path='url(#${cid})'`;

  // 도형 (라벨은 나중에)
  for (const l of p.lines || []) {
    const [s] = CLS[l.style || 'accent'];
    const w = l.style === 'muted' ? 6 : 7, op = l.style === 'muted' ? "opacity='.5'" : '';
    const domFrom = l.from ?? x0, domTo = l.to ?? x1;   // from~to만 실선, 그 밖은 extend:'dash'일 때만 점선 외삽
    const seg = (fx, tx, dashed) => {
      out.push(`<line x1='${r2(sx(fx))}' y1='${r2(sy(l.a * fx + l.b))}' x2='${r2(sx(tx))}' y2='${r2(sy(l.a * tx + l.b))}' class='${s}' stroke-width='${w}' stroke-linecap='round' ${op} ${dashed || l.dash ? "stroke-dasharray='14 12'" : ''} ${clip}/>`);
      clipSeg(fx, l.a * fx + l.b, tx, l.a * tx + l.b);
    };
    seg(domFrom, domTo, false);
    if (l.extend === 'dash') {
      if (domFrom > x0) seg(x0, domFrom, true);
      if (domTo < x1) seg(domTo, x1, true);
    }
  }
  const curveFns = [];
  for (const c of p.curves || []) {
    if (!/^[\dx+\-*/(). ]+$/.test(c.fn)) throw new Error(`curves.fn에는 숫자, x, + - * / ( )만 쓸 수 있습니다: ${c.fn}`);
    const f = new Function('x', `return (${c.fn});`);
    curveFns.push(f);
    const pts = [];
    for (let i = 0; i <= 200; i++) { const x = x0 + (x1 - x0) * i / 200; pts.push([x, f(x)]); }
    const [s] = CLS[c.style || 'accent'];
    out.push(`<polyline points='${pts.map(([x, y]) => `${r2(sx(x))},${r2(sy(y))}`).join(' ')}' class='${s}' stroke-width='7' stroke-linejoin='round' ${clip}/>`);
    for (let i = 1; i < pts.length; i++) clipSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
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

  // 눈금 숫자가 들어갈 띠를 예약: x축 아래 한 줄, y축 왼쪽 한 칸
  tickZone.push({ l: sx(x0) - 10, r: sx(x1) + 10, t: sy(ax) + 8, b: sy(ax) + 46 });
  tickZone.push({ l: sx(ay) - 64, r: sx(ay) - 4, t: sy(y1) - 10, b: sy(y0) + 10 });

  // 축 이름 놓기: 다른 라벨(점·직선·곡선·눈금)을 모두 배치한 맨 마지막에 놓는다(아래 실행부).
  // free()는 "원래 W×H 안에 들어가야 한다"는 조건이 있어서 못 쓴다 — 축 이름은 길면 일부러 원래
  // W×H 밖으로 나가도록 두고 나중에 viewBox를 늘릴 것이므로, 그 조건만 뺀 별도 판정을 쓴다.
  // tickZone(눈금 숫자 자리)는 일부러 뺐다 — 축 이름은 문장이라 눈금 숫자로 오독될 리 없고, y축 눈금
  // 띠는 세로로 플롯 전체 높이만큼 길어서 가로로 넓은 축 이름은 세로로 어디로 옮겨도 항상 걸리게 된다.
  const freeIgnoringBounds = b => !obstacles.some(s => segHits(b, s))
    && !dots.some(d => b.l - 10 < d.x && b.r + 10 > d.x && b.t - 10 < d.y && b.b + 10 > d.y) && !placed.some(q => boxHits(b, q));
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
  // 라벨: 점 → 보조선 → 직선 → 곡선 → 눈금 순서로 빈자리에 놓는다
  for (const pt of p.points || []) {
    if (!pt.label) continue;
    const [, , cls] = CLS[pt.style || 'accent'];
    const X = sx(pt.x), Y = sy(pt.y);
    const at = { ne: [X + 20, Y - 20, 'start'], nw: [X - 20, Y - 20, 'end'], se: [X + 20, Y + 46, 'start'], sw: [X - 20, Y + 46, 'end'], e: [X + 22, Y + 12, 'start'], w: [X - 22, Y + 12, 'end'] };
    const order = [pt.pos || 'nw', 'nw', 'ne', 'w', 'e', 'se', 'sw'].filter((v, i, a) => a.indexOf(v) === i);
    const k = dots.findIndex(d => d.x === X && d.y === Y), self = dots.splice(k, 1);   // 자기 점은 피하지 않는다
    put(order.map(o => at[o]), pt.label, cls, true);
    dots.push(...self);
  }
  for (const g of p.segments || []) {
    if (!g.label) continue;
    const [, , cls] = CLS[g.style || 'ink'];
    const mx = (sx(g.from[0]) + sx(g.to[0])) / 2, my = (sy(g.from[1]) + sy(g.to[1])) / 2, horiz = g.from[1] === g.to[1];
    put(horiz ? [[mx, my + 42, 'middle'], [mx, my - 16, 'middle']] : [[mx + 18, my + 12, 'start'], [mx - 18, my + 12, 'end'], [mx + 18, my - 20, 'start'], [mx + 18, my + 44, 'start']], g.label, cls, true);
  }
  for (const l of p.lines || []) {
    if (!l.label) continue;
    const [, , cls] = CLS[l.style || 'accent'];
    const domFrom = l.from ?? x0, domTo = l.to ?? x1;   // 라벨은 실선 구간(from~to) 안에 놓는다
    const xs = l.at !== undefined ? [l.at] : Array.from({ length: 24 }, (_, k) => domTo - (domTo - domFrom) * (0.06 + 0.038 * k));
    const cands = xs.filter(x => { const y = l.a * x + l.b; return y > y0 && y < y1; }).flatMap(x => {
      const X = sx(x), Y = sy(l.a * x + l.b);
      return l.a >= 0 ? [[X + 20, Y + 46, 'start'], [X - 20, Y - 20, 'end']] : [[X + 20, Y - 20, 'start'], [X - 20, Y + 46, 'end']];
    });
    put(cands, l.label, cls, true);
  }
  (p.curves || []).forEach((c, ci) => {
    if (!c.label) return;
    const [, , cls] = CLS[c.style || 'accent'], f = curveFns[ci];
    const cands = Array.from({ length: 20 }, (_, k) => x1 - (x1 - x0) * (0.08 + 0.04 * k)).filter(x => f(x) > y0 && f(x) < y1).flatMap(x => [[sx(x) + 20, sy(f(x)) + 46, 'start'], [sx(x) - 20, sy(f(x)) - 20, 'end']]);
    put(cands, c.label, cls, true);
  });
  // 눈금 숫자: 자리가 없으면(선·점·라벨과 겹치면) 그 눈금은 숫자를 생략한다 — 격자로 셀 수 있다
  const every = Math.max(1, Math.ceil((x1 - x0) / step / 10));
  const edge = (v, lo, hi) => Math.abs(v - lo) < 1e-9 || Math.abs(v - hi) < 1e-9;
  // "O"(원점)도 다른 눈금 숫자와 같은 충돌 검사를 받게 한다 — 상자를 살짝 부풀려서(±6) 두어
  // 실제 폰트 렌더링이 상자 추정치보다 조금 더 클 때도 바로 위·아래 눈금과 붙어 보이지 않게 하고,
  // 그래도 너무 가까우면(예: 촘촘한 y축에서 -1과 O) 나중에 놓이는 그 눈금 쪽이 생략되게 한다.
  {
    const oX = sx(ay) - 14, oY = sy(ax) + 38;
    const oBox = boxOf(oX, oY, 'O', FS['v-label-s'], 'end');
    const oBoxPadded = { l: oBox.l - 6, r: oBox.r + 6, t: oBox.t - 6, b: oBox.b + 6 };
    if (free(oBoxPadded, true)) { placed.push(oBoxPadded); labels.push(`<text x='${r2(oX)}' y='${r2(oY)}' class='v-label-s' text-anchor='end' ${HALO}>O</text>`); }
  }
  for (let i = 0, x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step, i++)
    if (Math.abs(x) > 1e-9 && i % every === 0 && !edge(x, x0, x1)) put([[sx(x), sy(ax) + 38, 'middle']], String(r2(x)), 'v-label-s');
  for (let i = 0, y = Math.ceil(y0 / step) * step; y <= y1 + 1e-9; y += step, i++)
    if (Math.abs(y) > 1e-9 && i % every === 0 && !edge(y, y0, y1)) put([[sx(ay) - 14, sy(y) + 10, 'end']], String(r2(y)), 'v-label-s');

  // 축 이름은 맨 마지막에 놓는다 — 점·직선·곡선·눈금 라벨이 먼저 자기 자리를 차지하게 두고,
  // 축 이름은 그 나머지 빈 자리를 찾는다(더 구체적인 정보를 담은 라벨이 우선한다).
  // x축 이름은 sy(ax)(축이 실제로 지나는 자리, y0<0<y1이면 플롯 한가운데일 수 있다)가 아니라
  // sy(y0)(플롯의 맨 아래, y축 눈금 숫자 열의 맨 아래와 같다) 기준으로 놓는다 — 라벨이 길면
  // anchor='end'로 왼쪽까지 넓게 걸치는데, 그 폭 안에 y축 눈금 숫자 열(세로로 플롯 전체 높이)이
  // 들어 있어서 sy(ax) 기준으로는 세로로 아무리 옮겨도 눈금 숫자 어딘가와 계속 부딪힌다.
  placeAxisLabel([0, 1, 2, 3].map(k => [sx(x1) + 30, sy(y0) + 46 + k * 30, 'end']), p.xLabel ?? p.axes?.x ?? 'x');
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
  out.push(`<line x1='${padL}' y1='${r2(y(0))}' x2='${W - padL}' y2='${r2(y(0))}' class='v-ink-s' stroke-width='4'/>`);
  items.forEach((it, i) => {
    const x = padL + i * bw + bw * 0.18, w = bw * 0.64, top = y(Math.max(0, it.value)), bot = y(Math.min(0, it.value));
    out.push(`<rect x='${r2(x)}' y='${r2(top)}' width='${r2(w)}' height='${r2(Math.max(2, bot - top))}' rx='6' class='${it.hot ? 'v-accent' : 'v-mid'}'/>`);
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
