// classforge deck runtime — 키보드 넘김, 단계 공개, 활동 타이머, 발표자 노트
(function () {
  const stage = document.getElementById('stage');
  const slides = [...document.querySelectorAll('.slide')];
  const notes = document.getElementById('notes');
  const params = new URLSearchParams(location.search);
  const shot = params.has('shot');
  if (shot) document.body.classList.add('shot');

  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  let cur = 0;
  const steps = s => [...s.querySelectorAll('[data-step]')];
  const pending = s => steps(s).filter(e => e.classList.contains('hide'));

  function show(i, fromBack) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => s.classList.toggle('on', k === cur));
    const s = slides[cur];
    // 뒤로 왔을 때는 모두 공개, 앞으로 왔을 때는 단계 숨김
    steps(s).forEach(e => e.classList.toggle('hide', !(fromBack || shot)));
    s.classList.toggle('revealed', !!(fromBack || shot) && s.classList.contains('s-quiz'));
    notes.textContent = `[${cur + 1}/${slides.length}] ` + (s.dataset.notes || '(노트 없음)');
    if (!shot) history.replaceState(null, '', '#' + (cur + 1));
  }
  function next() {
    const s = slides[cur], p = pending(s);
    if (p.length) { p[0].classList.remove('hide'); if (p[0].classList.contains('ans')) s.classList.add('revealed'); return; }
    if (cur < slides.length - 1) show(cur + 1);
  }
  function prev() { if (cur > 0) show(cur - 1, true); }

  addEventListener('keydown', e => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1, true);
    else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
    else if (e.key === 'n' || e.key === 'N') notes.classList.toggle('on');
    else if (e.key === 't' || e.key === 'T') { const t = slides[cur].querySelector('.timer'); if (t) toggleTimer(t); }
  });
  stage.addEventListener('click', e => {
    if (e.target.closest('.timer')) return;
    (e.clientX > innerWidth / 3 ? next : prev)();
  });

  // 활동 타이머: 클릭 또는 T로 시작/일시정지
  function toggleTimer(t) {
    if (t._iv) { clearInterval(t._iv); t._iv = null; return; }
    let left = t._left ?? Number(t.dataset.sec);
    t._iv = setInterval(() => {
      left = Math.max(0, left - 1); t._left = left;
      t.querySelector('.tv').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      if (left === 0) { clearInterval(t._iv); t._iv = null; t.classList.add('done'); }
    }, 1000);
  }
  document.querySelectorAll('.timer').forEach(t => t.addEventListener('click', () => toggleTimer(t)));

  const start = Number(params.get('s') || location.hash.slice(1) || 1) - 1;
  show(isNaN(start) ? 0 : start, shot);
  window.__deck = { show: i => show(i, true), count: slides.length };
})();
