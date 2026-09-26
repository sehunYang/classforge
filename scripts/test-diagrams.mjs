// classforge diagrams 자체 검증 — 굴절 방향(스넬 법칙)이 사분면까지 맞는지, circuit의 극성·배선 연결·
// 계기 표기가 맞는지 확인한다. LaTeX 컴파일 없이 toTikzSpec()이 만드는 TikZ 소스 좌표만 순수 계산으로
// 검사한다(빠르다, CI에도 쓸 수 있다).
// 사용: node scripts/test-diagrams.mjs
import { toTikzSpec, checkCircuitConnectivity, SENTINEL, CLASS_FOR, resetFillOpacityLeaks } from './diagrams.mjs';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) pass++; else { fail++; console.error(`  FAIL: ${msg}`); } }

// TikZ 소스에서 화살표 있는 \draw[cf..., -{Stealth[scale=1.6]}] (x1,y1) -- (x2,y2); 광선만 뽑는다(호·마커 제외).
// -Stealth](구식)와 -{Stealth[scale=..]}](신식, 화살표 크기 지정) 양쪽 다 인식한다.
function rays(src) {
  const out = [];
  const re = /\\draw\[(cf\w+)[^\]]*?-\{?Stealth(?:\[[^\]]*\])?\}?\]\s*\(([-\d.]+),([-\d.]+)\)\s*--\s*\(([-\d.]+),([-\d.]+)\);/g;
  let m;
  while ((m = re.exec(src))) out.push({ cls: m[1], from: [Number(m[2]), Number(m[3])], to: [Number(m[4]), Number(m[5])] });
  return out;
}

function check(name, params, expect = {}) {
  console.log(`- ${name}`);
  const spec = toTikzSpec({ refraction: params });
  const rs = rays(spec.src);
  const incident = rs.find(r => r.to[0] === 0 && r.to[1] === 0);
  // 굴절광은 원점에서 "아래로"(to[1]<0) 나간다 — 전반사일 때 반사광도 cfaccent에 from=(0,0)이지만
  // 그건 "위로"(to[1]>0) 나가므로 이 조건으로 구별된다.
  const refracted = rs.find(r => r.cls === 'cfaccent' && r.from[0] === 0 && r.from[1] === 0 && r.to[1] < 0);

  if (expect.tir) {
    assert(spec.computed.tir === true, `${name}: 전반사로 계산돼야 함`);
    assert(!refracted, `${name}: 전반사인데 cfaccent 굴절광이 그려짐`);
    const reflected = rs.find(r => r.from[0] === 0 && r.from[1] === 0);
    assert(!!reflected, `${name}: 전반사인데 반사광이 없음`);
  } else {
    assert(spec.computed.tir === false, `${name}: 전반사가 아니어야 함`);
    assert(!!incident, `${name}: 입사광이 없음`);
    assert(!!refracted, `${name}: 굴절광이 없음`);
    if (incident && refracted) {
      const n1 = params.n1 ?? 1, n2 = params.n2;
      const thetaR = spec.computed.refractedDeg;
      const lhs = n1 * Math.sin(params.incidentDeg * Math.PI / 180);
      const rhs = n2 * Math.sin(thetaR * Math.PI / 180);
      assert(Math.abs(lhs - rhs) < 0.002, `${name}: 스넬 법칙 어긋남 (n1 sinθi=${lhs.toFixed(4)}, n2 sinθr=${rhs.toFixed(4)})`);
      // 수평 진행 방향의 부호: 입사광 진행 방향(원점-source) x부호 == 굴절광 진행 방향(끝점-원점) x부호.
      const inTravelX = Math.sign(0 - incident.from[0]);
      const outTravelX = Math.sign(refracted.to[0] - 0);
      assert(inTravelX !== 0 && inTravelX === outTravelX,
        `${name}: 굴절광이 입사광 반대쪽(사분면)으로 꺾임 — 입사 진행부호=${inTravelX}, 굴절 진행부호=${outTravelX}`);
      if (n2 > n1) assert(thetaR < params.incidentDeg, `${name}: n2>n1인데 굴절각(${thetaR}) < 입사각(${params.incidentDeg}) 아님`);
      if (n2 < n1) assert(thetaR > params.incidentDeg, `${name}: n2<n1인데 굴절각(${thetaR}) > 입사각(${params.incidentDeg}) 아님`);
    }
  }
  assert(spec.labels.some(l => l.tex === '\\theta_i'), `${name}: θᵢ 라벨(tex 모드)이 없음`);
}

check('공기(1)→물(1.33) 45°', { n2: 1.33, incidentDeg: 45 });
check('물(1.33)→공기(1) 30°(임계각 미만)', { n1: 1.33, n2: 1, incidentDeg: 30 });
check('공기→물 45°, from:right', { n2: 1.33, incidentDeg: 45, from: 'right' });
check('물(1.33)→공기(1) 60°(전반사, 임계각≈48.8°)', { n1: 1.33, n2: 1, incidentDeg: 60, showReflected: true }, { tir: true });

// ── circuit: 연결(끊긴 도선 없음)·계기 문자·photocell 극성 검증(round 7 G1, blind3-pe 사고 재발 방지) ──
// toTikzSpec({circuit:...})가 예외 없이 끝나면 그 안에서 checkCircuitConnectivity가 이미 통과한
// 것이다(끊기면 toTikzSpec 자체가 throw한다) — 그래서 "연결됐는가"는 그냥 안 던지는지로 확인한다.
function checkCircuitBuilds(name, circuit) {
  console.log(`- ${name}`);
  try {
    const spec = toTikzSpec({ circuit });
    assert(true, '');   // 여기 도달하면 배선 연결 자가진단을 통과한 것
    return spec;
  } catch (e) {
    fail++; console.error(`  FAIL: ${name}: circuit이 예외를 던짐(배선이 끊어졌거나 다른 오류) — ${e.message}`);
    return null;
  }
}
// 계기(전류계·전압계·검류계)는 항상 "문자 있는 동그라미"(rmeter, t=A/V/G — 화살표 없는 원)여야 한다.
function assertMeterHasLetter(spec, name) {
  assert(/rmeter,\s*t=A/.test(spec.src), `${name}: 전류계에 문자(A)가 없음(rmeter, t=A 아님)`);
  assert(/rmeter,\s*t=V/.test(spec.src), `${name}: 전압계에 문자(V)가 없음(rmeter, t=V 아님)`);
  assert(/rmeter,\s*t=G/.test(spec.src), `${name}: 검류계에 문자(G)가 없음(rmeter, t=G 아님)`);
}

let spec = checkCircuitBuilds('직렬(전지·전구·전류계·전압계·검류계) — 연결·계기 문자', {
  elements: [{ type: 'cell' }, { type: 'lamp' }, { type: 'ammeter' }, { type: 'voltmeter' }, { type: 'galvanometer' }],
});
if (spec) assertMeterHasLetter(spec, '직렬');
// label을 안 주면 종류에서 자동으로 채워진다(팀 요청: "ammeter→전류계, voltmeter→전압계, galvanometer→검류계").
if (spec) {
  assert(spec.labels.some(l => l.text === '전류계'), '직렬: ammeter 기본 라벨이 "전류계"가 아님');
  assert(spec.labels.some(l => l.text === '전압계'), '직렬: voltmeter 기본 라벨이 "전압계"가 아님');
  assert(spec.labels.some(l => l.text === '검류계'), '직렬: galvanometer 기본 라벨이 "검류계"가 아님');
}
// 라벨이 자기 종류와 모순되면(예: ammeter인데 label:"검류계" — blind3-pe 테스트 슬라이드에서 실제로
// 있었던 실수: A로 그려 놓고 "검류계"라고 적음) 빌드 시점에 예외가 나야 한다.
console.log('- 계기 라벨-종류 모순: ammeter에 label:"검류계"를 주면 예외');
try {
  toTikzSpec({ circuit: { elements: [{ type: 'cell' }, { type: 'ammeter', label: '검류계' }] } });
  fail++; console.error('  FAIL: 모순된 라벨인데 예외가 안 남');
} catch (e) { assert(true, ''); }
console.log('- 계기 라벨-종류 정상: ammeter에 label:"전류계 1"(번호만 붙임)은 통과');
try {
  toTikzSpec({ circuit: { elements: [{ type: 'cell' }, { type: 'ammeter', label: '전류계 1' }] } });
  assert(true, '');
} catch (e) { fail++; console.error(`  FAIL: 정상 라벨인데 예외가 남 — ${e.message}`); }

spec = checkCircuitBuilds('병렬(전지·전류계 + 전구/전압계/검류계 가지) — 연결·계기 문자', {
  layout: 'parallel',
  elements: [{ type: 'cell' }, { type: 'ammeter' }],
  branches: [[{ type: 'lamp' }, { type: 'galvanometer' }], [{ type: 'voltmeter' }, { type: 'rheostat' }]],
});
if (spec) assertMeterHasLetter(spec, '병렬');

// photocell 극성: cathode 기본값("-")이면 음극이 -극(오른쪽/x1 쪽 — battery1은 시작점(x0)이 +, 끝점(x1)이
// -다, design.md·circuit 헬퍼 주석 참고) 근처에, reverse:true면 반대(왼쪽/x0 쪽, +극)에 있어야 한다.
// 또한 라벨은 항상 "음극"·"양극" 정확히 하나씩만 나와야(서로 모순되는 라벨을 사용자가 못 주므로) 한다.
function checkPhotocellPolarity(name, photocellOpts, expectCathodeRight) {
  const spec = checkCircuitBuilds(name, { elements: [{ type: 'cell' }, { type: 'photocell', ...photocellOpts }, { type: 'ammeter' }] });
  if (!spec) return;
  const cathode = spec.labels.find(l => l.text === '음극');
  const anode = spec.labels.find(l => l.text === '양극');
  assert(!!cathode && !!anode, `${name}: 음극·양극 라벨이 정확히 하나씩 없음`);
  if (cathode && anode) {
    const cathodeRight = cathode.x > anode.x;
    assert(cathodeRight === expectCathodeRight, `${name}: 음극이 ${expectCathodeRight ? '오른쪽(-극)' : '왼쪽(+극)'}에 있어야 하는데 반대임(음극 x=${cathode.x}, 양극 x=${anode.x})`);
  }
}
checkPhotocellPolarity('photocell 기본(cathode 생략 -> "-")', {}, true);
checkPhotocellPolarity('photocell cathode:"-"(명시)', { cathode: '-' }, true);
checkPhotocellPolarity('photocell cathode:"+"', { cathode: '+' }, false);
checkPhotocellPolarity('photocell reverse:true(기본 "-"를 뒤집음 -> "+")', { reverse: true }, false);
checkPhotocellPolarity('photocell cathode:"+" + reverse:true(뒤집혀 "-")', { cathode: '+', reverse: true }, true);

checkCircuitBuilds('photocell을 병렬 가지 안에 — 연결 확인', {
  layout: 'parallel',
  elements: [{ type: 'cell' }],
  branches: [[{ type: 'photocell' }], [{ type: 'ammeter' }]],
});

// photocell의 라벨 4개(음극·양극·빛·광전관)가 (1) 진공관 원 테두리, (2) 관 중심을 지나는 배선(가로선),
// (3) 서로 — 이 세 가지와 실제로 충분히 떨어져 있는지 기하로 확인한다. src에서 진공관
// \draw[cfink] (cx,cy) circle (r); 명령을 그대로 파싱해 원 중심·반지름을 얻으므로(배선은 원과 같은
// y라 cy가 곧 배선 높이다) 내부 상수를 다시 베끼지 않고 "정말 충분히 떨어졌는가"만 잰다.
// release/photoelectric 11번(병렬 가지, B2-CROSS: 음극/양극이 관 테두리와 겹침 → 수정 → 라벨끼리
// 붙음 → 수정 → "광전관"이 화살표를 관통 → 이번에 처음부터 다시 설계)과 blind5(직렬)에서 실측 확인.
// 주의: 이 검사는 라벨을 "앵커점 하나"로만 본다 — 실제로는 글자 상자(어센트·글자 폭)가 앵커점보다
// 넓게 퍼진다. v10(관 중심에서 가로로 밀기)은 이 앵커점 기준 여유(0.25)를 통과했지만, 실측
// (Playwright getBoundingClientRect, gate.mjs와 같은 방식)으로는 글자 상자가 관 테두리·전극판
// 곡선에 그대로 걸렸다(release/photoelectric 11번 실사고) — 점 기준 검사와 실제 렌더 사이에
// 이런 간극이 있다는 뜻이므로, 문턱값을 실측으로 확인된 v11 여유만큼 넉넉히 올려 최소한의
// 회귀 방지선으로 삼는다. 그래도 이 검사를 통과했다고 실제로 안전하다고 믿지 말 것 — 최종 확인은
// 반드시 gate.mjs(B2-CROSS·B2-TEXTOVERLAP, 실제 렌더의 getBoundingClientRect 기반)로 한다.
function checkPhotocellLabelGeometry(name, circuitOpts) {
  const spec = checkCircuitBuilds(name, circuitOpts);
  if (!spec) return;
  const m = spec.src.match(/\\draw\[cfink\] \(([-\d.]+),([-\d.]+)\) circle \(([\d.]+)\);/);
  assert(!!m, `${name}: 진공관 원(circle) 명령을 못 찾음`);
  if (!m) return;
  const [, cxStr, cyStr, rStr] = m;
  const ccx = Number(cxStr), ccy = Number(cyStr), r = Number(rStr);
  // v13에서 r+0.3(점 기준 여유 0.40)까지 좁혀 봤지만 실측(gate.mjs)에서 B2-CROSS가 재발했다 —
  // "관 밑" 배치는 어센트가 원 쪽으로 다시 뻗어 올라가는 방향이라 여유가 더 필요하다(r+0.5, 점
  // 기준 여유 0.45 필요). 그래서 r+0.5로 되돌렸다 — 문턱값도 원래 값으로.
  const MIN_TUBE_CLEARANCE = 0.45;   // 원 테두리에서 라벨 앵커점까지
  const MIN_WIRE_CLEARANCE = 0.3;    // 관 중심을 지나는 배선(가로선, y=ccy)에서 라벨까지 세로 거리
  const MIN_LABEL_GAP = 0.7;         // 라벨끼리 앵커점 사이 최소 거리(겹쳐 보이지 않을 정도)
  const wanted = ['음극', '양극', '빛', '광전관'];   // 이 세 테스트 모두 photocell에 label을 안 줘서 이름표는 기본값("광전관")이다
  const found = wanted.map(text => spec.labels.find(l => l.text === text)).filter(Boolean);
  assert(found.length === wanted.length, `${name}: 라벨 4개(${wanted.join(',')}) 중 일부가 없음(찾음: ${found.map(l => l.text).join(',')})`);
  for (const label of found) {
    const tubeDist = Math.hypot(label.x - ccx, label.y - ccy) - r;
    assert(tubeDist >= MIN_TUBE_CLEARANCE, `${name}: "${label.text}" 라벨이 진공관 테두리에서 ${tubeDist.toFixed(2)}만큼만 떨어짐(최소 ${MIN_TUBE_CLEARANCE}) — B2-CROSS 위험`);
    const wireDist = Math.abs(label.y - ccy);
    assert(wireDist >= MIN_WIRE_CLEARANCE, `${name}: "${label.text}" 라벨이 관 중심 배선(가로선)에서 세로로 ${wireDist.toFixed(2)}만큼만 떨어짐(최소 ${MIN_WIRE_CLEARANCE}) — B2-CROSS 위험`);
  }
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const d = Math.hypot(found[i].x - found[j].x, found[i].y - found[j].y);
      assert(d >= MIN_LABEL_GAP, `${name}: "${found[i].text}"·"${found[j].text}" 라벨끼리 ${d.toFixed(2)}만큼만 떨어짐(최소 ${MIN_LABEL_GAP}) — B2-TEXTOVERLAP 위험`);
    }
  }
  // "빛" 라벨이 화살표(= cx, 관 중심에서 ±0.5)에서 너무 멀리 밀려나면(예전 0.6) 이 소자 칸의
  // 바깥쪽 진입선(가지 갈림점 쪽 리드선)까지 넘어간 적이 있다(release/photoelectric 11번 실사고,
  // 실측 여유 ~0.86단위에 글자 폭까지 더하면 0.6은 넘어섰다) — 회귀 방지로 0.4단위 이내로 묶는다.
  const light = spec.labels.find(l => l.text === '빛');
  if (light) {
    const lightDx = Math.min(Math.abs(light.x - (ccx - 0.5)), Math.abs(light.x - (ccx + 0.5)));
    assert(lightDx <= 0.4, `${name}: "빛" 라벨이 전극(화살표) x에서 ${lightDx.toFixed(2)}단위나 떨어짐(0.4 이내여야 진입선 밖으로 안 넘어감) — B2-CROSS 위험`);
  }
  // 전극 라벨(음극·양극)이 전지 라벨 근처에 있으면 안 된다 — series 레이아웃에서 실제로 있었던
  // 사고: bottomGap을 그냥 키우기만 한 버전이 음극을 전지의 (+)판 옆까지 내려 "전지가 거꾸로
  // 그려졌다"로 오독됐다(fresh reviewer 지적, 틀림 판정). '전지'는 diagrams.mjs의
  // DEFAULT_LABEL.cell과 같아야 한다(여기선 export 안 된 내부 상수라 문자열을 그대로 맞춘다).
  const cellEl = (circuitOpts.elements || []).find(e => e.type === 'cell');
  if (cellEl) {
    const cellText = cellEl.label || '전지';
    const cellLabel = spec.labels.find(l => l.text === cellText);
    assert(!!cellLabel, `${name}: 전지 라벨("${cellText}")을 못 찾음`);
    if (cellLabel) {
      const MIN_CELL_CLEARANCE = 1.0;
      for (const label of found) {
        if (label.text !== '음극' && label.text !== '양극') continue;
        const d = Math.hypot(label.x - cellLabel.x, label.y - cellLabel.y);
        assert(d >= MIN_CELL_CLEARANCE, `${name}: "${label.text}" 라벨이 전지 라벨과 ${d.toFixed(2)}만큼만 떨어짐(최소 ${MIN_CELL_CLEARANCE}) — 전지 극성으로 오독될 위험`);
      }
    }
  }
}
// release/photoelectric 11번을 그대로 재현(정지 전압 측정 장치): 가변 전원 + 가지[광전관(reverse)+검류계] + 가지[전압계]
checkPhotocellLabelGeometry('photocell 병렬 가지(정지 전압 장치 재현, release/photoelectric 11번) — 라벨 4개 배치', {
  layout: 'parallel',
  elements: [{ type: 'cell', label: '가변 전원' }],
  branches: [[{ type: 'photocell', reverse: true }, { type: 'galvanometer' }], [{ type: 'voltmeter' }]],
});
checkPhotocellLabelGeometry('photocell 병렬 가지(기본 극성, 가지 하나) — 라벨 4개 배치', {
  layout: 'parallel',
  elements: [{ type: 'cell' }],
  branches: [[{ type: 'photocell' }, { type: 'ammeter' }]],
});
// blind5(직렬): 전지 + 광전관(기본 극성) + 검류계
checkPhotocellLabelGeometry('photocell 직렬(blind5 재현) — 라벨 4개 배치', {
  elements: [{ type: 'cell' }, { type: 'photocell' }, { type: 'galvanometer', label: '검류계' }],
});
// cell.variable:true → 전지 기호 위에 대각선 화살표(가변 전원 표시)가 실제로 그려지는지(series·parallel 둘 다).
// drawCellSymbol의 화살표는 -{Stealth[scale=1.1]}로 고정돼 있다 — photocell의 입사광 화살표(scale=1.4)와
// 헷갈리지 않게 스케일 값으로 구분한다.
const VARIABLE_ARROW_RE = /\\draw\[cfaccent, thick, -\{Stealth\[scale=1\.1\]\}\]/;
function checkVariableCell(name, circuitOpts, expectArrow) {
  const spec = checkCircuitBuilds(name, circuitOpts);
  if (!spec) return;
  const hasArrow = VARIABLE_ARROW_RE.test(spec.src);
  assert(hasArrow === expectArrow, expectArrow
    ? `${name}: cell.variable:true인데 가변 전원 대각선 화살표가 안 그려짐`
    : `${name}: cell.variable이 없는데 가변 전원 화살표가 그려짐(오검출)`);
}
checkVariableCell('가변 전원(series) — 대각선 화살표 있음', { elements: [{ type: 'cell', variable: true, label: '가변 전원' }, { type: 'lamp' }] }, true);
checkVariableCell('가변 전원(parallel) — 대각선 화살표 있음', { layout: 'parallel', elements: [{ type: 'cell', variable: true, label: '가변 전원' }], branches: [[{ type: 'lamp' }]] }, true);
checkVariableCell('일반 전지(series) — 화살표 없음', { elements: [{ type: 'cell' }, { type: 'lamp' }] }, false);
checkVariableCell('일반 전지(parallel) — 화살표 없음', { layout: 'parallel', elements: [{ type: 'cell' }], branches: [[{ type: 'lamp' }]] }, false);
// photocell + 가변 전원을 같이 쓸 때도(release/photoelectric 실제 용례) 음극·양극이 전지 라벨과
// 안 겹치는지 — checkPhotocellLabelGeometry의 전지-근접 검사를 variable:true 경로로도 한 번 더 태운다.
checkPhotocellLabelGeometry('photocell + 가변 전원(병렬) — 라벨 4개 배치·전지 근접 검사', {
  layout: 'parallel',
  elements: [{ type: 'cell', variable: true, label: '가변 전원' }],
  branches: [[{ type: 'photocell', reverse: true }, { type: 'galvanometer' }], [{ type: 'voltmeter' }]],
});

// checkCircuitConnectivity 자체가 "항상 통과"가 아니라 실제로 끊긴 배선을 잡아내는지 직접 확인한다
// (blind3-pe 사고 재현: 도선 끝 2.6인데 소자 판은 2.8) — 닫힌 삼각형 고리(정상)와 대조한다.
console.log('- checkCircuitConnectivity: 정상 고리는 통과, 끊긴 고리는 예외');
try {
  checkCircuitConnectivity([[[0, 0], [4, 0]], [[4, 0], [4, 3]], [[4, 3], [0, 0]]], 'test-closed');
  assert(true, '');
} catch (e) { fail++; console.error(`  FAIL: 닫힌 고리인데 예외 발생 — ${e.message}`); }
try {
  checkCircuitConnectivity([[[0, 0], [2.6, 0]], [[2.8, 0], [4, 0]], [[4, 0], [0, 0]]], 'test-broken');
  fail++; console.error('  FAIL: blind3-pe식 끊어진 배선(2.6 vs 2.8)인데 예외가 안 남');
} catch (e) { assert(true, ''); }

// ── 지도 산티넬(cfland·cfsea·cfsky) — round 9, territory 마이그레이션에서 발견 ──────────────
// deck.css/print.css엔 v-land/v-sea/v-sky(와 -s 선 짝)가 이미 있었는데 SENTINEL/CLASS_FOR 연결이
// 빠져 있어서(diagrams.mjs가 컴파일할 땐 그 색 이름이 그냥 무시됐다) TikZ에서 cfland 등을 써도
// 테마 클래스로 안 바뀌는 사고가 있었다 — SENTINEL에 있는데 CLASS_FOR 짝이 없는 것도 같은 부류의
// 사고이므로 모든 SENTINEL 이름이 CLASS_FOR에도 있는지 다 함께 확인한다.
console.log('- 지도 산티넬(cfland·cfsea·cfsky)이 SENTINEL·CLASS_FOR에 연결돼 있는지');
for (const name of ['cfland', 'cfsea', 'cfsky']) {
  assert(!!SENTINEL[name], `SENTINEL에 ${name}이 없음`);
}
for (const [name, hex] of Object.entries(SENTINEL)) {
  const cls = CLASS_FOR[hex];
  assert(!!cls && !!cls.fill, `${name}(${hex})이 SENTINEL엔 있는데 CLASS_FOR엔 채움 클래스가 없음`);
}
assert(CLASS_FOR[SENTINEL.cfland]?.fill === 'v-land', 'cfland의 채움 클래스가 v-land가 아님');
assert(CLASS_FOR[SENTINEL.cfland]?.stroke === 'v-land-s', 'cfland의 선 클래스가 v-land-s가 아님');
assert(CLASS_FOR[SENTINEL.cfsea]?.fill === 'v-sea', 'cfsea의 채움 클래스가 v-sea가 아님');
assert(CLASS_FOR[SENTINEL.cfsea]?.stroke === 'v-sea-s', 'cfsea의 선 클래스가 v-sea-s가 아님');
assert(CLASS_FOR[SENTINEL.cfsky]?.fill === 'v-sky', 'cfsky의 채움 클래스가 v-sky가 아님');

// ── fill-opacity 누수 자동 복구 — round 9, 반투명 \fill 뒤 opacity가 새는 dvisvgm 문제 ──────────
// 실제 SVG 출력으로 재현·수정을 이미 확인했다(scratch 컴파일: cfsea에 fill opacity=0.3을 준 뒤
// cfland를 그렸더니 cfland까지 fill-opacity=".3"이 새어 나왔고, 명령 뒤에 \pgfsetfillopacity{1}을
// 넣으니 사라졌다) — 여기서는 그 문자열 변환(resetFillOpacityLeaks)만 빠르게 단위 테스트한다.
console.log('- fill-opacity 누수 자동 복구: opacity= 명령 뒤에 \\pgfsetfillopacity{1}이 끼워지는지');
{
  const src = '\\fill[cfsea, fill opacity=0.3] (0,0) rectangle (4,3);\n\\fill[cfland] (1,1) rectangle (2,2);';
  const fixed = resetFillOpacityLeaks(src);
  const opacityCmdEnd = fixed.indexOf(';') + 1;
  assert(fixed.slice(opacityCmdEnd, opacityCmdEnd + 30).includes('\\pgfsetfillopacity{1}'),
    'opacity= 명령 바로 뒤에 \\pgfsetfillopacity{1}이 안 끼워짐');
  assert(fixed.includes('\\fill[cfland] (1,1) rectangle (2,2);'), '원래 뒤 명령이 그대로 안 남아 있음(리셋 삽입이 내용을 건드림)');
  const plain = '\\fill[cfland] (1,1) rectangle (2,2);';
  assert(resetFillOpacityLeaks(plain) === plain, 'opacity=가 없는 명령인데도 리셋이 끼어듦(불필요한 변경)');
}

console.log(`\n${pass}개 통과, ${fail}개 실패`);
process.exit(fail ? 1 : 0);
