// classforge paginate — #flow 안의 블록(.blk)을 실제로 재어 가며 A4 쪽(.page)에 차례로 담는다.
// 일반 블록은 쪼개지 않는다. data-split="rows" 블록(표)은 행 단위로 다음 쪽에 이어 붙이고 머리행을 반복한다.
// 한 쪽보다 큰 쪼갤 수 없는 블록은 data-overflow로 표시해 게이트가 잡게 한다.
(async function () {
  await document.fonts.ready;
  const flow = document.getElementById('flow');
  const blocks = [...flow.children];
  const footL = document.body.dataset.foot || '';
  const pages = [];
  let inner;
  function newPage() {
    const p = document.createElement('section');
    p.className = 'page';
    p.innerHTML = '<div class="pg-band"></div><div class="pg-inner"></div><div class="pg-foot"><span></span><span class="pn"></span></div>';
    p.querySelector('.pg-foot span').textContent = footL;
    document.body.appendChild(p);
    pages.push(p);
    inner = p.querySelector('.pg-inner');
  }
  // 들어가는지: 넘침이 없고, 마지막 블록 아래 끝이 칸 바닥에서 3px 이상 떨어져 있어야 한다(표 아래 테두리가 잘리지 않게)
  const fits = () => {
    if (inner.scrollHeight > inner.clientHeight + 1) return false;
    const last = inner.lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= inner.getBoundingClientRect().bottom - 3;
  };

  // 표 블록을 현재 쪽에 들어가는 만큼만 남기고, 나머지 행으로 새 블록을 만들어 돌려준다
  function splitRows(b, alone) {
    const tbl = b.querySelector('table');
    const body = tbl.tBodies[0];
    const rows = [...tbl.rows].slice(1);
    rows.forEach(r => r.remove());
    let i = 0;
    for (; i < rows.length; i++) {
      body.appendChild(rows[i]);
      if (!fits()) { rows[i].remove(); break; }
    }
    if (i === rows.length) return null;
    if (i === 0 && alone) { rows.forEach(r => body.appendChild(r)); b.dataset.overflow = '1'; return null; }
    const rest = b.cloneNode(true);
    const rt = rest.querySelector('table');
    [...rt.rows].slice(1).forEach(r => r.remove());
    rows.slice(i).forEach(r => rt.tBodies[0].appendChild(r));
    // 이어지는 쪽 첫 행의 단계 칸에 단계 이름을 다시 적는다
    const st = rt.rows[1]?.querySelector('td.stage');
    if (st && !st.textContent.trim()) { st.textContent = st.dataset.stage + ' (계속)'; st.classList.add('first'); }
    if (i === 0) b.remove();
    else { const last = body.rows[body.rows.length - 1]?.querySelector('td.stage'); if (last) last.classList.add('cut'); }
    return rest;
  }

  newPage();
  const queue = [...blocks];
  while (queue.length) {
    const b = queue.shift();
    inner.appendChild(b);
    if (fits()) continue;
    if (b.dataset.split === 'rows') {
      const rest = splitRows(b, inner.children.length === 1);
      if (rest) { newPage(); queue.unshift(rest); }
      continue;
    }
    if (inner.children.length === 1) { b.dataset.overflow = '1'; continue; }
    newPage();
    inner.appendChild(b);
    if (!fits()) b.dataset.overflow = '1';
  }
  // 빈 쪽 제거
  pages.filter(p => !p.querySelector('.pg-inner').children.length).forEach(p => { p.remove(); pages.splice(pages.indexOf(p), 1); });
  pages.forEach((p, i) => { p.querySelector('.pn').textContent = `${i + 1} / ${pages.length}`; });
  flow.remove();
  // 매칭 문항(.match)의 정답 선: 빌드 시점 좌표(x1=0%/x2=100%, 칸 경계)는 실제 점(.dot)이
  // 테두리·안쪽 여백만큼 칸 안쪽에 있는 걸 반영 못해 선이 점 앞에서(칸 가장자리에서) 끝나
  // 보이는 사고가 있었다. 레이아웃이 끝난 지금(폰트·페이지 배치 확정 후) 점의 실제 화면
  // 좌표를 재서 선을 다시 긋는다 — mm값을 다시 계산하는 것보다 훨씬 안전하다.
  document.querySelectorAll('.match').forEach(m => {
    const svg = m.querySelector('svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;
    svg.setAttribute('viewBox', `0 0 ${svgRect.width} ${svgRect.height}`);
    svg.querySelectorAll('line[data-a]').forEach(line => {
      const dotA = m.querySelector(`.it.l[data-row="${line.dataset.a}"] .dot`);
      const dotB = m.querySelector(`.it.r[data-row="${line.dataset.b}"] .dot`);
      if (!dotA || !dotB) return;
      const ra = dotA.getBoundingClientRect(), rb = dotB.getBoundingClientRect();
      line.setAttribute('x1', ra.left + ra.width / 2 - svgRect.left);
      line.setAttribute('y1', ra.top + ra.height / 2 - svgRect.top);
      line.setAttribute('x2', rb.left + rb.width / 2 - svgRect.left);
      line.setAttribute('y2', rb.top + rb.height / 2 - svgRect.top);
    });
  });
  window.__paged = true;
})();
