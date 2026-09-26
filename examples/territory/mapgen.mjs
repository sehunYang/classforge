// 이 수업의 지도·단면 삽화({tikz} 도해)를 만드는 생성기. 손으로 TikZ 좌표를 적지 않고,
// 아래 경위도 표(간이 해안선)에서 좌표를 계산해 lesson.json의 visual에 써 넣는다.
//   node mapgen.mjs            → lesson.json을 제자리에서 갱신
// 투영: 단순 정거원통(등장방형) + 기준 위도 38°의 cos 보정 — x = (경도-128)·cos38°, y = 위도-38 (1단위 = 위도 1°).
// 한반도의 가로세로 비율이 실제와 같게 보인다(예전 손그림은 가로로 약 1.8배 늘어나 있었다).
import fs from 'node:fs';

const LESSON = new URL('./lesson.json', import.meta.url);
const K = Math.cos(38 * Math.PI / 180);
const r3 = n => Math.round(n * 1000) / 1000;
const P = ([lon, lat]) => [r3((lon - 128) * K), r3(lat - 38)];

// 간이 해안선(경도, 위도) — 압록강 하구에서 시작해 서해안 → 남해안 → 동해안 → 두만강 하구까지.
const COAST = [
  [124.35, 39.95], // 압록강 하구
  [124.18, 39.82], // 마안도(서쪽 끝, 동경 124°11')
  [124.65, 39.62], [125.15, 39.58], [125.45, 39.45], [125.25, 39.05],
  [125.15, 38.75], // 대동강 하구
  [124.95, 38.5], [124.73, 38.13], // 장산곶
  [125.35, 37.85], [125.95, 37.9], [126.45, 37.75], // 옹진 · 해주만 · 강화
  [126.6, 37.45], // 인천
  [126.8, 37.05], [126.35, 36.95], [126.12, 36.75], // 아산만 · 태안
  [126.45, 36.35], [126.7, 36.0], [126.45, 35.62], [126.35, 35.2], [126.35, 34.8], // 보령 · 군산 · 변산 · 영광 · 목포
  [126.52, 34.3], // 땅끝(해남)
  [126.95, 34.45], [127.3, 34.47], [127.75, 34.72], [128.1, 34.85], [128.6, 34.75], [128.75, 35.05], // 남해안
  [129.05, 35.1], // 부산
  [129.35, 35.47], [129.57, 36.05], [129.4, 36.5], [129.45, 37.05], [129.15, 37.45], // 울산 · 호미곶 · 영덕 · 울진 · 삼척
  [128.9, 37.8], [128.55, 38.3], [128.2, 38.75], [127.45, 39.15], // 강릉 · 속초 · 통천 · 원산
  [127.6, 39.8], [128.2, 40.05], [128.65, 40.3], [129.2, 40.7], [129.7, 40.9], // 함흥 · 신포 · 김책 · 무수단
  [129.75, 41.8], [130.3, 42.2], // 청진 · 나선
  [130.7, 42.3], // 두만강 하구
];
// 북쪽 국경(두만강 → 백두산 → 압록강), 동쪽에서 서쪽으로. 바다가 아니므로 영해를 두르지 않는다.
const BORDER = [
  [130.35, 42.65], [129.97, 43.0], // 유원진(북쪽 끝, 북위 43°)
  [129.75, 42.45], [129.2, 42.25], [128.6, 42.0], [128.08, 42.0], // 회령 · 무산 · 백두산
  [128.2, 41.45], [127.6, 41.45], [126.95, 41.8], [126.35, 41.2], [125.6, 40.75], [124.9, 40.45], [124.4, 40.1],
];
// 섬: 제주도(타원), 마라도(남쪽 끝, 북위 33°06'), 울릉도, 독도(동쪽 끝, 동경 131°52').
// 울릉도·독도·마라도는 실제보다 크게 그린다(design.md: 작은 섬은 보이게).
const JEJU = { c: [126.55, 33.38], rx: 0.4 * K, ry: 0.18 };
const MARADO = { c: [126.27, 33.12], r: 0.06 };
const ULLEUNG = { c: [130.87, 37.5], r: 0.13 };
const DOKDO = { c: [131.87, 37.24], r: 0.09 };

const pts = arr => arr.map(P);
const path = arr => arr.map(([x, y]) => `(${x},${y})`).join(' -- ');
const OUTLINE = [...pts(COAST), ...pts(BORDER)];

// 해안 쪽 꼭짓점만 d만큼 바깥으로 민 다각형(국경 꼭짓점은 0) — 영해 띠의 바깥 경계.
function offsetOutline(d) {
  const pl = OUTLINE, n = pl.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = pl[i], [x2, y2] = pl[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const sgn = area > 0 ? 1 : -1;   // 반시계(+)면 바깥 법선은 오른쪽
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return [sgn * dy / L, -sgn * dx / L]; };
  const raw = pl.map((p, i) => {
    // 강 하구(해안의 양 끝 = 압록강·두만강 하구)는 0으로 두어 띠가 국경 너머 이웃 나라 쪽으로 삐져나가지 않게 한다.
    const dd = i > 0 && i < COAST.length - 1 ? d : 0;
    if (!dd) return p;
    const a = pl[(i - 1 + n) % n], b = pl[(i + 1) % n];
    const n1 = nrm(a, p), n2 = nrm(p, b);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const cos = mx * n1[0] + my * n1[1];
    const len = Math.min(dd / Math.max(cos, 0.35), dd * 1.3);   // 뾰족한 곶(마안도 등)에서 띠가 가시처럼 튀지 않게 미터 길이를 줄인다
    return [r3(p[0] + mx * len), r3(p[1] + my * len)];
  });
  return untangle(raw);
}
// 오목한 만(아산만·원산만 등)에서 밀어낸 변끼리 엇갈려 생기는 작은 고리(swallowtail)를 잘라낸다:
// 가까운(10개 이내) 두 변이 교차하면 그 사이 꼭짓점을 교점 하나로 바꾼다. 해안 쪽 앞부분만 손본다.
function untangle(pl) {
  const hit = (p1, p2, p3, p4) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-12) return null;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? [r3(p1[0] + t * (p2[0] - p1[0])), r3(p1[1] + t * (p2[1] - p1[1]))] : null;
  };
  const out = pl.slice();
  let limit = COAST.length;
  for (let i = 0; i < limit - 1; i++) {
    for (let j = Math.min(i + 10, limit - 1); j >= i + 2; j--) {
      const x = hit(out[i], out[i + 1], out[j], out[j + 1]);
      if (x) { out.splice(i + 1, j - i, x); limit -= j - i - 1; break; }
    }
  }
  out.coastLen = limit;   // 해안 쪽(띠를 두른) 꼭짓점 수 — 점선 해안 경계만 그릴 때 쓴다
  return out;
}

const J = P(JEJU.c), M = P(MARADO.c), U = P(ULLEUNG.c), D = P(DOKDO.c);
// 땅(영토)은 cfland → v-land(땅 초록, 진한 초록 해안선은 CSS가 그린다) — landShapes() 참고.
// 영해 띠는 바깥 경계(offsetOutline + zoneShapes)를 바다색으로 먼저 칠하고 그 위에 땅을 칠한다.
const SEA = 'cfsea';   // v-sea(바다 파랑)

// ── 6번 diagram: 우리나라의 경위도 범위 ───────────────────────────────
function rangeMap() {
  const [xw] = P([124, 38]), [xe] = P([132, 38]);
  const yn = 43 - 38, ys = 33 - 38;
  const L = -13.5, R = 13.5;   // 위선은 칸(가로로 긴 diagram) 폭을 채우도록 길게
  const src = [
    `\\draw[cfmuted, dashed] (${L},${yn}) -- (${R},${yn});`,
    `\\draw[cfmuted, dashed] (${L},${ys}) -- (${R},${ys});`,
    `\\draw[cfmuted, dashed] (${xw},${yn + 1.1}) -- (${xw},${ys - 0.9});`,
    `\\draw[cfmuted, dashed] (${xe},${yn + 1.1}) -- (${xe},${ys - 0.9});`,
    ...landShapes(),
  ];
  const labels = [
    { x: L, y: yn + 0.5, text: '북위 43°', cls: 'v-label-s', anchor: 'start' },
    { x: L, y: ys - 0.95, text: '북위 33°', cls: 'v-label-s', anchor: 'start' },
    { x: xw, y: yn + 1.45, text: '동경 124°', cls: 'v-label-s', anchor: 'middle' },
    { x: xe, y: yn + 1.45, text: '동경 132°', cls: 'v-label-s', anchor: 'middle' },
    { x: 7.2, y: 0.55, text: '북위 33°~43°', cls: 'v-label-a', anchor: 'start' },
    { x: 7.2, y: -1.15, text: '동경 124°~132°', cls: 'v-label', anchor: 'start' },
  ];
  return { tikz: { src: src.join('\n'), labels } };
}

// ── 1번 cover: 지구본(정사영) — 경선·위선, 우리나라 위치(북위 37.5°, 동경 127°) ──
function globe() {
  const R = 3, lon0 = 95;   // 적도 위 가운데 경도 95°E에서 본 지구
  const rad = d => d * Math.PI / 180;
  const src = [`\\fill[cfsea] (0,0) circle (${R});`];
  for (const lat of [-60, -30, 30, 60]) {
    const y = R * Math.sin(rad(lat)), hw = R * Math.cos(rad(lat));
    src.push(`\\draw[cfmuted, dashed] (${r3(-hw)},${r3(y)}) -- (${r3(hw)},${r3(y)});`);
  }
  src.push(`\\draw[cfmuted] (${-R},0) -- (${R},0);`);   // 적도
  for (const dl of [-60, -30, 0, 30, 60]) {
    const rx = r3(Math.abs(R * Math.sin(rad(dl))));
    // 경선: 가운데는 직선, 나머지는 반타원(오른쪽 반은 -90→90, 왼쪽 반은 270→90)
    src.push(dl === 0 ? `\\draw[cfmuted, dashed] (0,${-R}) -- (0,${R});` : `\\draw[cfmuted, dashed] (0,${-R}) arc (${dl < 0 ? 270 : -90}:90:${rx} and ${R});`);
  }
  src.push(`\\draw[cfink] (0,0) circle (${R});`);
  const lat = 37.5, lon = 127;
  const kx = r3(R * Math.cos(rad(lat)) * Math.sin(rad(lon - lon0))), ky = r3(R * Math.sin(rad(lat)));
  src.push(`\\fill[cfaccent] (${kx},${ky}) circle (0.2);`);
  // 라벨은 경선·위선과 겹치지 않게 지구본 바깥 위에 두고 짧은 지시선으로 잇는다.
  src.push(`\\draw[cfink] (${kx},${r3(ky + 0.2)}) -- (${kx},${R + 0.3});`);
  return { tikz: { src: src.join('\n'), labels: [{ x: kx, y: R + 0.5, text: '우리나라', cls: 'v-label-a', anchor: 'middle' }] } };
}

// ── 3번 hook: 말로만(어디쯤?) vs 위선·경선 격자(여기!) ─────────────────
function hook() {
  const src = [
    `\\fill[cfsoft, rounded corners=12pt] (0,0) rectangle (6,8.4);`,
    `\\draw[cfink, rounded corners=12pt] (6.8,0) rectangle (12.8,8.4);`,
    `\\fill[cfmuted, fill opacity=0.45] (3,4.6) circle (1.1);`,
  ];
  for (const y of [2.6, 4.6, 6.6]) src.push(`\\draw[cfmuted, dashed] (7.2,${y}) -- (12.4,${y});`);
  for (const x of [8.2, 9.8, 11.4]) src.push(`\\draw[cfmuted, dashed] (${x},2.0) -- (${x},7.8);`);
  src.push(`\\fill[cfaccent] (9.8,4.6) circle (0.32);`);
  return { tikz: { src: src.join('\n'), labels: [
    { x: 3, y: 0.8, text: '어디쯤일까?', cls: 'v-label', anchor: 'middle' },
    { x: 9.8, y: 0.8, text: '여기예요!', cls: 'v-label-a', anchor: 'middle' },
  ] } };
}

// ── 5번 concept: 위선과 경선이 만나는 곳 ───────────────────────────────
function grid() {
  // 가운데 위선(가로)·경선(세로)은 진한 실선, 나머지는 점선. 가로선은 세로선보다 길게 뻗어
  // 오른쪽 끝에 "위선", 세로선은 위로 더 뻗어 그 옆에 "경선" 라벨을 선과 떨어뜨려 둔다.
  const src = [];
  for (const y of [0.8, 5.6]) src.push(`\\draw[cfmuted, dashed] (-2.6,${y}) -- (11,${y});`);
  for (const x of [0.2, 8.2]) src.push(`\\draw[cfmuted, dashed] (${x},-0.8) -- (${x},7.2);`);
  src.push(`\\draw[cfink] (-2.6,3.2) -- (11,3.2);`, `\\draw[cfink] (4.2,-0.8) -- (4.2,7.2);`);
  src.push(`\\fill[cfaccent] (4.2,3.2) circle (0.3);`);
  return { tikz: { src: src.join('\n'), labels: [
    { x: 11, y: 3.65, text: '위선', cls: 'v-label', anchor: 'end' },
    { x: 4.65, y: 6.5, text: '경선', cls: 'v-label', anchor: 'start' },
    { x: 4.6, y: 2.2, text: '우리나라', cls: 'v-label-a', anchor: 'start' },
  ] } };
}

// ── 10번 concept: 영토·영해·영공 단면 ─────────────────────────────────
function section() {
  const src = [
    `\\fill[${SKY}] (0,0) arc (180:0:7) -- cycle;`,
    `\\draw[cfmuted, dashed] (0,0) arc (180:0:7);`,
    `\\fill[${SEA}] (0,-2.4) rectangle (3,0);`,
    `\\fill[${SEA}] (11,-2.4) rectangle (14,0);`,
    `\\fill[cfland, line join=round] (3,-2.4) -- (3,0) -- (4.3,2.4) -- (9.7,2.4) -- (11,0) -- (11,-2.4) -- cycle;`,
  ];
  return { tikz: { src: src.join('\n'), labels: [
    { x: 7, y: 4.4, text: '영공', cls: 'v-label', anchor: 'middle' },
    { x: 1.5, y: -1.55, text: '영해', cls: 'v-label', anchor: 'middle' },
    { x: 7, y: 0.4, text: '영토', cls: 'v-label-a', anchor: 'middle' },
  ] } };
}

// ── 영해 띠 폭 ────────────────────────────────────────────────────────
// 실제 12해리 ≈ 위도 0.2°. 화면·활동지에서 보이도록 0.3°(1.5배)로 조금만 과장한다 — 이 정도면
// 울릉도·독도의 영해가 실제처럼 서로 떨어져 보인다(0.7°처럼 크게 과장하면 두 섬 영해가 한 덩어리로 붙는다).
const SEA_D = 0.3;
// 섬 영해 구역: 영해 폭은 섬의 실제 크기에서 재야 하므로 그림용으로 키운 반지름(ULLEUNG.r 등)이 아니라
// 실제에 가까운 반지름을 쓴다. 제주도+마라도는 둘을 함께 감싸는 타원 하나(실제로도 이어져 있다).
const TRUE_R = { marado: 0.02, ulleung: 0.06, dokdo: 0.02 };
function zoneShapes(d) {
  const jc = [r3((J[0] + M[0]) / 2), r3((J[1] + M[1]) / 2)];
  const a = r3(Math.max(JEJU.rx + d + Math.abs(jc[0] - J[0]), TRUE_R.marado + d + Math.abs(jc[0] - M[0])));
  const b = r3(Math.max(JEJU.ry + d + Math.abs(jc[1] - J[1]), TRUE_R.marado + d + Math.abs(jc[1] - M[1])));
  const ru = r3(TRUE_R.ulleung + d), rd = r3(TRUE_R.dokdo + d);
  if (Math.hypot(D[0] - U[0], D[1] - U[1]) <= ru + rd) throw new Error('울릉도·독도 영해 구역이 겹침 — d를 줄이세요');
  return [{ c: jc, a, b }, { c: U, a: ru, b: ru }, { c: D, a: rd, b: rd }];
}
// tilt: 비스듬히 본 지도(세로를 tilt배로 눌러 그림) — 12번 단계 아이콘에서 영공(위쪽 하늘)을 기둥으로 보이려고 쓴다.
const tp = (p, tilt) => [r3(p[0]), r3(p[1] * tilt)];
const zonePath = (d, tilt = 1) => zoneShapes(d).map(z => `(${tp(z.c, tilt).join(',')}) ellipse (${z.a} and ${r3(z.b * tilt)})`).join(' ');
function landShapes(tilt = 1) {
  return [
    `\\fill[cfland, line join=round] ${path(OUTLINE.map(p => tp(p, tilt)))} -- cycle;`,
    `\\fill[cfland] (${tp(J, tilt).join(',')}) ellipse (${r3(JEJU.rx)} and ${r3(JEJU.ry * tilt)});`,
    ...[[M, MARADO.r], [U, ULLEUNG.r], [D, DOKDO.r]].map(([c, r]) => `\\fill[cfland] (${tp(c, tilt).join(',')}) ellipse (${r} and ${r3(r * tilt)});`),
  ];
}
// 영해 채움(바다 파랑) / 영해 바깥 경계 점선
function seaFill(d, tilt = 1) {
  const off = offsetOutline(d).map(p => tp(p, tilt));
  return `\\fill[${SEA}, line join=round] ${path(off)} -- cycle ${zonePath(d, tilt)};`;
}
function seaLine(d, tilt = 1) {
  const off = offsetOutline(d);
  return [`\\draw[cfmuted, dashed] ${path(off.slice(0, off.coastLen).map(p => tp(p, tilt)))};`, `\\draw[cfmuted, dashed] ${zonePath(d, tilt)};`];
}

// ── 11번 compare: 영토만 vs 영토·영해·영공 ────────────────────────────
// 좌우 칸이 가로로 긴 700×220이라 한반도(섬 포함)를 작게(scope scale) 그리고, 비행기의 길(화살표)을 옆에 둔다.
// 배는 영해를 해 없이 지나가는 것(무해 통항)이 허용되지만 비행기는 영공을 허락 없이 못 지나가므로 비행기로 그린다.
// 왼쪽: 한반도 위를 그대로 가로질러 지나간다. 오른쪽: 부산 앞 영해·영공 경계(점선)에서 막힌다(강조색 X).
// 비행기 길은 울릉도·독도 영해를 비켜 남동쪽에서 온다.
function compareSide(right) {
  const src = [`\\begin{scope}[scale=0.42]`];
  if (right) src.push(seaFill(SEA_D), ...seaLine(SEA_D));
  src.push(...landShapes());
  if (!right) src.push(`\\draw[cfink, thick, -{Stealth[scale=1.6]}] (13,-4.5) -- (-4.2,0.9);`);
  else src.push(`\\draw[cfink, thick] (13,-4.5) -- (1.95,-3.23);`,
    `\\draw[cfaccent, thick] (1.25,-3.53) -- (1.85,-2.93);`, `\\draw[cfaccent, thick] (1.25,-2.93) -- (1.85,-3.53);`);
  src.push(`\\end{scope}`);
  return { tikz: { src: src.join('\n'), labels: [{ x: 5.9, y: -2.05, text: '비행기', cls: 'v-label-s', anchor: 'start' }] } };
}

// ── 12번 steps: 영토 → 영해 → 영공 → 영역 ────────────────────────────
// 네 아이콘 모두 같은 비스듬한 지도(세로 0.45배)에 한 겹씩 더한다. 영공은 영토+영해의 바로 위로 솟은
// 하늘 기둥(바닥 모양을 위로 쓸어 올린 것)으로 그린다 — 영해 밖 바다나 국경 너머 땅 위는 덮지 않는다.
const SKY = 'cfsky';   // v-sky(하늘)
const TILT = 0.45, SKY_H = 5.4;   // 기둥 높이를 눌린 지도 깊이보다 크게 해 윗면이 지도와 겹치지 않게 한다
function skyColumn() {
  const off = offsetOutline(SEA_D).map(p => tp(p, TILT));
  const up = p => [p[0], r3(p[1] + SKY_H)];
  const src = [];
  // 옆면: 바닥 윤곽의 변마다 위로 쓸어 올린 사각형(같은 색 불투명 채움이라 겹쳐도 그대로 합쳐 보인다)
  off.forEach((p, i) => { const q = off[(i + 1) % off.length]; src.push(`\\fill[${SKY}] ${path([p, q, up(q), up(p)])} -- cycle;`); });
  src.push(`\\fill[${SKY}] ${path(off.map(up))} -- cycle;`);
  for (const z of zoneShapes(SEA_D)) {
    const c = tp(z.c, TILT), bb = r3(z.b * TILT);
    src.push(`\\fill[${SKY}] (${r3(c[0] - z.a)},${c[1]}) rectangle (${r3(c[0] + z.a)},${r3(c[1] + SKY_H)});`,
      `\\fill[${SKY}] (${c[0]},${r3(c[1] + SKY_H)}) ellipse (${z.a} and ${bb});`);
  }
  // 기둥 윗면 윤곽(점선)과 양 끝 세로선
  const xs = off.map(p => p[0]), iL = xs.indexOf(Math.min(...xs)), iR = xs.indexOf(Math.max(...xs));
  const top = [`\\draw[cfmuted, dashed] ${path(off.map(up))} -- cycle;`];
  for (const i of [iL, iR]) top.push(`\\draw[cfmuted, dashed] (${off[i].join(',')}) -- (${up(off[i]).join(',')});`);
  return { fill: src, top };
}
function stepIcon(k) {
  const src = [];
  const sky = k >= 3 ? skyColumn() : null;
  if (sky) src.push(...sky.fill);
  if (k === 4) src.push(seaFill(SEA_D, TILT));
  if (k === 2 || k === 3) src.push(...seaLine(SEA_D, TILT));
  src.push(...landShapes(TILT));
  if (sky) src.push(...sky.top);
  if (k === 1) src.push(`\\draw[cfink, thick] (3.4,-2.1) circle (1.1);`, `\\draw[cfink, thick] (4.18,-2.88) -- (5.3,-4.0);`);
  return { tikz: { src: src.join('\n'), labels: [] } };
}

// ── 활동지 문항 3: 백지도(바탕, 영해 안내 점선 포함) / 영토·영해 정답 ────────
function blankMap() {
  const src = [
    ...seaLine(SEA_D),
    `\\draw[cfink, line join=round] ${path(OUTLINE)} -- cycle;`,
    `\\draw[cfink] (${J[0]},${J[1]}) ellipse (${r3(JEJU.rx)} and ${JEJU.ry});`,
    ...[[M, MARADO.r], [U, ULLEUNG.r], [D, DOKDO.r]].map(([c, r]) => `\\draw[cfink] (${c[0]},${c[1]}) circle (${r});`),
  ];
  return { tikz: { src: src.join('\n'), labels: [] } };
}
function answerMap() {
  // "영해" 라벨은 띠가 좁아 동해 쪽 바깥에 두고 짧은 지시선으로 띠를 가리킨다.
  const src = [seaFill(SEA_D), ...seaLine(SEA_D), ...landShapes(), `\\draw[cfink] (1.55,0.75) -- (0.66,0.42);`];
  return { tikz: { src: src.join('\n'), labels: [
    { x: 0.05, y: -2.2, text: '영토', cls: 'v-label-a', anchor: 'middle' },
    { x: 1.7, y: 0.55, text: '영해', cls: 'v-label', anchor: 'start' },
  ] } };
}

// lesson.json의 서식을 그대로 두려고, 옛 손그림 <svg> 문자열(또는 이전 실행의 {tikz}) 리터럴만
// 새 {tikz} 객체(한 줄 JSON)로 맞바꾼다. 여러 번 다시 실행해도 된다.
let raw = fs.readFileSync(LESSON, 'utf8');
const L = JSON.parse(raw);
const S = L.slides, draw = L.worksheet.sections[1].items[1];
const jobs = [
  [S[0], 'visual', globe()], [S[2], 'visual', hook()], [S[4], 'visual', grid()], [S[5], 'visual', rangeMap()],
  [S[9], 'visual', section()], [S[10].left, 'visual', compareSide(false)], [S[10].right, 'visual', compareSide(true)],
  ...S[11].steps.map((st, i) => [st, 'visual', stepIcon(i + 1)]),
  [draw, 'base', blankMap()], [draw, 'answer', answerMap()],
];
let n = 0;
for (const [obj, key, v] of jobs) {
  const old = JSON.stringify(obj[key]), neu = JSON.stringify(v);
  if (old === neu) continue;
  const at = raw.indexOf(old);
  if (at < 0 || raw.indexOf(old, at + 1) >= 0) throw new Error(`원문에서 ${key} 값을 하나로 특정하지 못함`);
  raw = raw.slice(0, at) + neu + raw.slice(at + old.length); n++;
}
JSON.parse(raw);
fs.writeFileSync(LESSON, raw, 'utf8');
console.log(`visual ${n}개 갱신`);
