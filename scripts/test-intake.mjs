// 수업 설계서 입력 경로 회귀 테스트 — node scripts/test-intake.mjs
// 1) 옛 양식(<!-- key: --> 주석)이 그대로 읽히는지, 2) 2판 양식("라벨: 값")이 같은 값을 내는지,
// 3) intake.json(브라우저 양식·대화)이 같은 객체가 되는지, 4) 브라우저 양식이 모든 필드를 다루고
// 실제로 저장한 intake.json이 읽히는지(Chrome이 있을 때만) 확인한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FIELDS, parseIntake, intakeFromJson, loadIntake, isLegacyForm } from './intake.mjs';
import { SKILL, launch, fileUrl } from './lib.mjs';

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(` PASS  ${name}`); }
  catch (e) { failed++; console.log(` FAIL  ${name}\n        ${String(e.message).split('\n').join('\n        ')}`); }
}
const rel = p => path.join(SKILL, p);
const md = s => s.replace(/^\n/, '');

await test('옛 양식(1판) 예시가 그대로 읽힌다', () => {
  const pe = loadIntake(rel('examples/photoelectric/수업설계서.md'));
  assert.equal(pe.source, 'md-v1');
  assert.equal(pe.filled.schoolLevel, 'high');
  assert.equal(pe.filled.lesson, '7 / 12');
  assert.equal(pe.filled.profile, 'evidence');
  assert.equal(pe.misconceptions.length, 2);
  assert.ok(isLegacyForm(fs.readFileSync(rel('examples/intake/설계서-예시-전체.md'), 'utf8')));
});

await test('빈 메모장 양식(2판)은 채운 칸 0개, 경고 0건', () => {
  const t = loadIntake(rel('templates/수업설계서.txt'));
  assert.equal(t.source, 'md');
  assert.deepEqual(t.fields, {});
  assert.deepEqual(t.warnings, []);
  assert.equal(t.empty.length, FIELDS.length);
});

await test('2판 예시가 같은 내용의 1판 예시와 같은 값을 낸다(학년·반만 나눠 읽음)', () => {
  const v1 = loadIntake(rel('examples/intake/설계서-예시-전체.md')).filled;
  const v2 = loadIntake(rel('examples/intake/설계서-2판-예시-전체.txt')).filled;
  const diff = [...new Set([...Object.keys(v1), ...Object.keys(v2)])].filter(k => JSON.stringify(v1[k]) !== JSON.stringify(v2[k]));
  assert.deepEqual(diff.sort(), ['classSize', 'grade']);
  assert.equal(v2.grade, '6학년');          // "초6" → 학년만(학교급은 schoolLevel로)
  assert.equal(v2.classSize, '3반 24명');
});

await test('메모장 양식에는 개발 문법·용어가 없다', () => {
  const t = fs.readFileSync(rel('templates/수업설계서.txt'), 'utf8');
  const DEV = /[#`|<>{}]|\*\*|\bhtml\b|\bmd\b|json|intake|마크다운|key\b|field/i;
  const bad = t.split('\n').filter(l => DEV.test(l));
  assert.deepEqual(bad, []);
});

await test('메모장 표시(■ 제목, ※·예) 설명, ━ 구분선, ○·• 글머리)를 알아본다', () => {
  const r = parseIntake(md(`
※ 설명 줄: 대상: 이건 값이 아님
대상: 중3
예) 고1
■ ★ 학습 목표
예) 이런 목표
○ 첫째를 말할 수 있다.
• 둘째를 설명할 수 있다.
-
━━━━ 여기부터는 선택 ━━━━
─── 수업 흐름 ───
활동: 짝
■ 메모
- 1. 시간이 빠듯합니다.
◆ 수치·사실과 출처
- 물은 100 °C에서 끓는다 (출처: 교과서)
`));
  assert.deepEqual(r.fields, {
    schoolLevel: 'middle', grade: '3학년', objectives: ['첫째를 말할 수 있다.', '둘째를 설명할 수 있다.'], activityMode: 'pair',
    etcRequest: '1. 시간이 빠듯합니다.', facts: [{ text: '물은 100 °C에서 끓는다', source: '교과서' }],
  });
  assert.deepEqual(r.warnings, []);
});

await test('메모장에서 ANSI(CP949)로 저장한 파일도 읽는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classforge-cp949-'));
  const f = path.join(dir, '수업설계서.txt');
  // "대상: 중2 3반\n교과·단원: 과학 · 광합성\n"을 CP949로 인코딩한 바이트
  fs.writeFileSync(f, Buffer.from('b4ebbbf33a20c1df322033b9dd0ab1b3b0faa1a4b4dcbff83a20b0fac7d020a1a420b1a4c7d5bcba0a', 'hex'));
  assert.deepEqual(loadIntake(f).fields, { schoolLevel: 'middle', grade: '2학년', classSize: '3반', subject: '과학', unit: '광합성' });
  fs.writeFileSync(f, '\uFEFF대상: 고2\r\n');                       // UTF-8 BOM + 윈도우 줄바꿈
  assert.deepEqual(loadIntake(f).fields, { schoolLevel: 'high', grade: '2학년' });
});

await test('복합 칸(대상·교과·단원·차시·시간)을 나눠 읽는다', () => {
  const r = parseIntake(md(`
대상: 중학교 2학년 5반 28명
교과·단원: 수학 / 일차함수의 그래프
차시·시간: 3/10차시, 45분 (5·35·5)
`));
  assert.deepEqual(r.fields, { schoolLevel: 'middle', grade: '2학년', classSize: '5반 28명', subject: '수학', unit: '일차함수의 그래프', lesson: '3 / 10', minutes: 45, timeAllocation: { intro: 5, develop: 35, wrap: 5 } });
  const r2 = parseIntake('대상: 고1\n차시·시간: 2차시 (도입 10 전개 30 정리 10)\n');
  assert.deepEqual(r2.fields, { schoolLevel: 'high', grade: '1학년', lesson: '2', timeAllocation: { intro: 10, develop: 30, wrap: 10 } });
  assert.equal(parseIntake('수업 시간: 50\n').fields.minutes, 50);
  assert.equal(parseIntake('차시: 4\n').fields.lesson, '4');
});

await test('마크다운으로 쓴 2판(#, >)도 읽고, 값은 예시 아래 줄에 써도 된다', () => {
  const r = parseIntake(md(`
대상:
> 예: 중2 3반 24명
초5

## ★ 학습 목표
> 예: 이런 목표
- 첫째 목표를 말할 수 있다.
-
둘째 목표를 설명할 수 있다.

## 메모
> 무엇이든
활동: 이 줄은 메모가 아니라 활동 칸 — 모둠
`));
  assert.equal(r.fields.schoolLevel, 'elem');
  assert.equal(r.fields.grade, '5학년');
  assert.deepEqual(r.fields.objectives, ['첫째 목표를 말할 수 있다.', '둘째 목표를 설명할 수 있다.']);
  assert.equal(r.fields.activityMode, 'group');
  assert.equal(r.fields.etcRequest, undefined);
});

await test('고르는 칸은 보기 낱말로, 여러 개 고르면 경고', () => {
  const r = parseIntake(md(`
활동: 짝 활동
문항 유형: 객관식, OX, 그림
서술형: 빼기
스타일: 증거 중심
제목 문체: 명사형
만들 것: 슬라이드랑 학습지만
난이도: 쉬움 아니면 보통
말투: 반말
`));
  assert.equal(r.fields.activityMode, 'pair');
  assert.deepEqual(r.fields.worksheetTypes, ['choice', 'ox', 'draw']);
  assert.equal(r.fields.hasEssay, 'no');
  assert.equal(r.fields.profile, 'evidence');
  assert.equal(r.fields.titleStyle, 'noun');
  assert.deepEqual(r.fields.deliverables, ['slides', 'worksheet']);
  assert.equal(r.fields.difficulty, 'easy');
  assert.equal(r.fields.tone, undefined);
  const codes = r.warnings.map(w => w.code);
  assert.ok(codes.includes('W-MULTI'), '난이도 두 개 → W-MULTI');
  assert.ok(codes.includes('W-OPTION'), '말투 "반말" → W-OPTION');
});

await test('수치·사실은 "내용 | 출처", "(출처: …)" 모두 받고, 출처가 없으면 경고', () => {
  const r = parseIntake(md(`
## 수치·사실과 출처
- 물의 끓는점은 1기압에서 100 °C이다 | 중1 과학 교과서
- 빛의 속력은 약 30만 km/s이다 (출처: 고1 물리 교과서)
- 출처 없는 수치 42
`));
  assert.deepEqual(r.fields.facts, [
    { text: '물의 끓는점은 1기압에서 100 °C이다', source: '중1 과학 교과서' },
    { text: '빛의 속력은 약 30만 km/s이다', source: '고1 물리 교과서' },
    { text: '출처 없는 수치 42', source: '' },
  ]);
  assert.ok(r.warnings.some(w => w.code === 'W-FACT-SOURCE'));
});

await test('intake.json: 코드·보기 낱말·문자열 모두 받고 모르는 칸은 경고', () => {
  const r = intakeFromJson({ classforge: 'intake', version: 2, source: 'chat', fields: {
    schoolLevel: '중학교', grade: '2학년', minutes: '45', activityMode: 'group', worksheetTypes: ['선택형', 'ox'],
    objectives: '첫째를 할 수 있다.\n둘째를 할 수 있다.', keyTerms: '광합성, 엽록체', worksheetQCount: '8~10', slidesCount: [12, 16],
    timeAllocation: { intro: 5, develop: 35, wrap: 5 }, facts: ['잎 1 cm²에 기공 수만 개 | 교과서', { text: '산소 발생', source: '실험' }],
    hasEssay: '', mustInclude: [], typo: 1,
  } });
  assert.equal(r.source, 'chat');
  assert.deepEqual(r.fields, {
    schoolLevel: 'middle', grade: '2학년', minutes: 45, activityMode: 'group', worksheetTypes: ['choice', 'ox'],
    objectives: ['첫째를 할 수 있다.', '둘째를 할 수 있다.'], keyTerms: ['광합성', '엽록체'], worksheetQCount: [8, 10], slidesCount: [12, 16],
    timeAllocation: { intro: 5, develop: 35, wrap: 5 }, facts: [{ text: '잎 1 cm²에 기공 수만 개', source: '교과서' }, { text: '산소 발생', source: '실험' }],
  });
  assert.ok(r.warnings.some(w => w.code === 'W-UNKNOWN-KEY'));
  assert.ok(!r.warnings.some(w => w.code === 'W-TIME'), '5+35+5=45분 → 시간 경고 없음');
});

await test('intake.json 시간 합 경고는 md와 같은 기준', () => {
  const ok = intakeFromJson({ fields: { minutes: 45, timeAllocation: { intro: 5, develop: 35, wrap: 5 } } });
  assert.ok(!ok.warnings.some(w => w.code === 'W-TIME'));
  const bad = intakeFromJson({ fields: { minutes: 40, timeAllocation: { intro: 5, develop: 35, wrap: 5 } } });
  assert.ok(bad.warnings.some(w => w.code === 'W-TIME'));
});

await test('파싱 결과(--json)를 다시 넣어도 같은 값', () => {
  const a = loadIntake(rel('examples/intake/설계서-2판-예시-전체.txt'));
  const b = intakeFromJson(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(b.fields, a.fields);
});

const HTML = rel('templates/수업설계서.html');
// 양식에서 key 대신 별도 입력칸으로 다루는 필드(묶어서 저장)
const COMPOSED = { lesson: 'lessonN', timeAllocation: 'tIntro', worksheetQCount: 'wqLo', slidesCount: 'slLo' };
await test('브라우저 양식이 모든 필드를 다룬다(강조색 제외)', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const missing = FIELDS.map(f => f.key).filter(k => k !== 'accentColor')
    .filter(k => !html.includes(`data-key="${k}"`) && !(COMPOSED[k] && html.includes(`id="${COMPOSED[k]}"`)));
  assert.deepEqual(missing, []);
  for (const f of FIELDS.filter(f => f.options && f.key !== 'accentColor')) {
    for (const code of Object.values(f.options)) assert.ok(html.includes(`data-v="${code}"`), `${f.key}의 보기 ${code}가 양식에 없음`);
  }
});

await test('브라우저 양식으로 채워 저장한 파일이 그대로 읽힌다(화면에 개발 용어 없음)', async () => {
  // 로캘이 비어 있는 리눅스 컨테이너의 Chromium은 한글 파일 이름을 "download"로 바꾼다(교사 PC에서는 그대로).
  // 그래도 intake.mjs는 내용으로 알아보지만, 파일 이름 검사를 위해 UTF-8 로캘로 띄운다.
  if (!process.env.LC_ALL && !/utf-?8/i.test(process.env.LANG || '')) process.env.LC_ALL = 'C.UTF-8';
  let browser;
  try { browser = await launch(); } catch (e) { console.log(`        (건너뜀: ${e.message})`); return; }
  try {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(fileUrl(HTML));
    await page.click('[data-key="schoolLevel"] [data-v="middle"]');
    await page.selectOption('#grade', '2학년');
    await page.fill('#subject', '과학');
    await page.fill('#unit', '광합성');
    await page.fill('#lessonN', '4'); await page.fill('#lessonT', '9');
    await page.fill('#minutes', '45');
    await page.fill('#tIntro', '5'); await page.fill('#tDev', '30'); await page.fill('#tWrap', '5');
    await page.fill('#objectives', '- 광합성에 필요한 물질을 실험으로 확인할 수 있다.\n\n광합성 산물을 말할 수 있다.');
    await page.fill('#misconceptions', '식물은 흙을 먹고 자란다고 생각한다.');
    await page.click('#more summary');
    await page.fill('#keyTerms', '광합성, 엽록체, 녹말');
    await page.click('[data-key="worksheetTypes"] [data-v="choice"]');
    await page.click('[data-key="worksheetTypes"] [data-v="short"]');
    await page.click('[data-key="hasEssay"] [data-v="yes"]');
    await page.click('[data-key="hasEssay"] [data-v="no"]');           // 하나만 — 마지막 선택만 남는다
    await page.click('[data-key="tone"] [data-v="해요체"]');
    await page.click('[data-key="tone"] [data-v="해요체"]');           // 다시 누르면 해제
    await page.fill('#wqLo', '8'); await page.fill('#wqHi', '10');
    await page.fill('#facts', '아이오딘 반응은 녹말에서 청람색 | 중2 과학 교과서\n출처 없는 값 3');
    const warns = await page.$$eval('#warnings li', ls => ls.map(l => l.textContent));
    assert.ok(warns.some(w => w.includes('시간 배분 합 40분')), `시간 합 경고가 떠야 함: ${warns.join(' / ')}`);
    assert.ok(warns.some(w => w.includes('서술형을 빼 달라고')), '서술형 모순 경고가 떠야 함');
    assert.ok(warns.some(w => w.includes('출처가 없는')), '출처 경고가 떠야 함');
    // 교사가 보는 화면(안내·단추·경고·입력칸 예시)에는 개발 용어가 없어야 한다
    const screen = await page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[placeholder]')].map(e => e.placeholder), document.title].join('\n'));
    const DEV = /json|intake|key|field|null|undefined|true|false|\.md\b|mjs|lesson|meta|schema|파싱|스키마/i;
    assert.ok(!DEV.test(screen), `화면에 개발 용어: ${screen.match(DEV)?.[0]}`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
    assert.equal(dl.suggestedFilename(), '수업설계서-과학-광합성.json');
    assert.ok(await page.isVisible('#savedMsg'), '저장 안내가 보여야 함');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'classforge-intake-')), dl.suggestedFilename());
    await dl.saveAs(out);
    const r = loadIntake(out);
    assert.equal(r.source, 'form');
    assert.deepEqual(r.fields, {
      schoolLevel: 'middle', grade: '2학년', subject: '과학', unit: '광합성', lesson: '4 / 9', minutes: 45,
      objectives: ['광합성에 필요한 물질을 실험으로 확인할 수 있다.', '광합성 산물을 말할 수 있다.'],
      keyTerms: ['광합성', '엽록체', '녹말'], misconceptions: ['식물은 흙을 먹고 자란다고 생각한다.'],
      timeAllocation: { intro: 5, develop: 30, wrap: 5 }, worksheetQCount: [8, 10], worksheetTypes: ['choice', 'short'], hasEssay: 'no',
      facts: [{ text: '아이오딘 반응은 녹말에서 청람색', source: '중2 과학 교과서' }, { text: '출처 없는 값 3', source: '' }],
    });
    assert.ok(r.warnings.some(w => w.code === 'W-TIME') && r.warnings.some(w => w.code === 'W-ESSAY'), 'intake.mjs도 같은 경고');
    // 불러오기: 저장한 파일을 새 페이지에 다시 채우면 같은 값이 나와야 한다
    const page2 = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page2.goto(fileUrl(HTML));
    await page2.setInputFiles('#fileIn', out);
    const [dl2] = await Promise.all([page2.waitForEvent('download'), page2.click('#saveBtn')]);
    const out2 = path.join(path.dirname(out), '다시 저장.txt');   // 확장자가 바뀌어도 내용으로 알아본다
    await dl2.saveAs(out2);
    assert.deepEqual(loadIntake(out2).fields, r.fields);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

console.log(failed ? `\n ${failed}개 실패` : '\n ALL PASS');
process.exit(failed ? 1 : 0);
