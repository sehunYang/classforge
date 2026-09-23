// classforge images — lesson.json의 {image:{...}} 요청을 컴파일·검증하고 생성한다.
// 사용: node images.mjs <lesson.json> [--compile-only] [--force] [--concurrency N] [--route subscription|api]
//
// 두 경로:
//  - subscription(기본) — Codex CLI 내장 image_generation 도구, 사용자 ChatGPT 구독 쿼터. 모델 선택 불가(서버가 고름).
//  - api — lesson.json의 images.model(또는 CLASSFORGE_IMAGE_MODEL)로 모델을 강제 지정하고 싶을 때만.
//    OPENAI_API_KEY로 사용자의 OpenAI API 과금(구독 쿼터 아님)을 쓰며, OpenAI Images API
//    (POST https://api.openai.com/v1/images/generations)를 Node fetch로 직접 호출한다.
//    모델 문자열은 그대로 전달한다(치환 없음): API가 모델을 거부하면 그 에러 메시지 그대로 실패한다.
//
// 파이프라인:
//  1. lesson.json을 훑어(임의 깊이) 모든 {image:{id,brief,role,ratio,style,prompt?}}를 모은다.
//  2. prompt가 없으면 images/<id>.brief.md를 쓰고 "빠짐" 목록에 넣는다(작성자가 공냥 프롬프트 킷으로 채워야 함).
//  3. prompt가 있으면 교실 안전 문구를 붙이고(이미 있으면 건너뜀) vendor/prompt-kit의 check_prompt.mjs로 검증한다.
//  4. --compile-only면 여기서 끝: 빠짐·검증실패가 있으면 비정상 종료(체크리스트 출력).
//  5. 아니면 경로(subscription/api)를 정하고, 검증 통과한 요청만 생성(동시성 제한, 실패 시 1회 재시도) →
//     PNG 서명·크기·비율 확인 → 웹용 축소본(webp/jpeg, 긴 변 1600) 생성 →
//     images/manifest.json에 기록(프롬프트 해시로 캐시).
//
// 아래 순수 함수들(collect·classroomClause·ensureClassroomClause·runCheckPrompt·sha256)은 파일을 쓰지 않으므로
// gate.mjs의 I1 게이트가 그대로 import해서 "images.mjs가 만들 최종 프롬프트"를 메모리에서만 재현한다
// (게이트는 lesson.json을 절대 고치지 않는다 — CLI 본체는 main()에 있고 이 모듈을 import만 해서는 실행되지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SKILL, loadLesson, launch } from './lib.mjs';

// ── 바뀌지 않는 상수 ────────────────────────────────────────
const RATIOS = ['1:1', '16:9', '4:3', '3:4'];
// subscription(codex 내장 도구)은 16:9 전용 버킷(1792x1024)이 있다. api 경로(gpt-image-2가 아닌
// 임의 모델)는 대부분의 GPT Image 모델이 지원을 보장하는 레거시 사이즈 4종(1024x1024·1536x1024·
// 1024x1536·auto)만 쓴다 — 16:9도 1536x1024(가장 가까운 가로 버킷)로 근사한다.
const RATIO_SIZE_SUBSCRIPTION = { '1:1': '1024x1024', '16:9': '1792x1024', '4:3': '1536x1024', '3:4': '1024x1536' };
const RATIO_SIZE_API = { '1:1': '1024x1024', '16:9': '1536x1024', '4:3': '1536x1024', '3:4': '1024x1536' };
const CHECK_PROMPT = path.join(SKILL, 'vendor', 'prompt-kit', 'skills', 'image-prompt', 'scripts', 'check_prompt.mjs');
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const CLASSROOM_MARK = 'CLASSROOM-SAFE-V1';
const TIMEOUT_MS = 8 * 60 * 1000;

// ── 색 도우미 (교과 강조색에서 보조 팔레트 파생) ───────────
const hexToRgb = h => { const m = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)); };
const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (hex, target, t) => { const a = hexToRgb(hex), b = hexToRgb(target); return rgbToHex(a.map((v, i) => v + (b[i] - v) * t)); };
const accentPalette = hex => [hex.toUpperCase(), mix(hex, '#FFFFFF', 0.35), mix(hex, '#FFFFFF', 0.7), '#FBFAF6'];

// ── lesson.json 전체에서 {image:{...}} 요청을 모은다(임의 깊이) ──
function collect(node, out) {
  if (Array.isArray(node)) { for (const v of node) collect(v, out); return out; }
  if (node && typeof node === 'object') {
    if (node.image && typeof node.image === 'object' && !Array.isArray(node.image)) out.push(node.image);
    for (const k of Object.keys(node)) collect(node[k], out);
  }
  return out;
}

// ── 교실 안전 문구 + 프롬프트 검증 (순수 함수) ──────────────
function classroomClause(req, accent) {
  const pal = accentPalette(accent).join(' ');
  const noun = req.style === 'photo' ? '사진' : req.style === 'diagram-ish' ? '도해' : '삽화';
  return `Classroom constraints (${CLASSROOM_MARK}): 장면 안 모든 표면·간판·사물은 문자·숫자·기호 없이 매끈하게 두어 문자 없는 순수 ${noun} 장면이 되게 한다, clean brand-free copy-free finish; 등장인물은 실재 인물의 초상이 아닌 완전히 가상의 인물이며 저작권이 있는 캐릭터·브랜드와 무관한 독자적 디자인, 전 연령 교실 환경에 적합한 건전하고 단정한 표현. 보조 팔레트 힌트: ${pal}.`;
}
function ensureClassroomClause(text, req, accent) {
  let t = String(text).trim();
  const arMatch = t.match(/AR\s+(\d+\s*:\s*\d+)\s*$/i);
  const arToken = arMatch ? arMatch[1].replace(/\s+/g, '') : req.ratio;
  let body = arMatch ? t.slice(0, arMatch.index).trimEnd() : t;
  if (!body.includes(CLASSROOM_MARK)) body = `${body}\n${classroomClause(req, accent)}`;
  return `${body}\nAR ${arToken}`.trim();
}
function runCheckPrompt(text) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CHECK_PROMPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', () => {
      try { resolve(JSON.parse(out)); }
      catch { resolve({ ok: false, errors: [{ code: 'E-RUNNER', msg: err.trim() || 'check_prompt.mjs 출력을 파싱하지 못함' }], warnings: [] }); }
    });
    child.on('error', e => resolve({ ok: false, errors: [{ code: 'E-RUNNER', msg: e.message }], warnings: [] }));
    child.stdin.write(text);
    child.stdin.end();
  });
}
const sha256 = s => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export { CLASSROOM_MARK, collect, classroomClause, ensureClassroomClause, runCheckPrompt, sha256 };

// ── CLI 본체 (isMain일 때만 실행 — import만으로는 아무 것도 하지 않는다) ──
async function main() {
  const args = process.argv.slice(2);
  const lessonPath = args.find(a => !a.startsWith('--'));
  const flag = name => args.includes(`--${name}`);
  const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  if (!lessonPath) {
    console.error('사용: node images.mjs <lesson.json> [--compile-only] [--force] [--concurrency N] [--route subscription|api]');
    process.exit(2);
  }
  const COMPILE_ONLY = flag('compile-only');
  const FORCE = flag('force');
  const CONCURRENCY = Math.max(1, Number(opt('concurrency', '2')) || 2);
  const ROUTE_FLAG = opt('route', null);

  const ctx = loadLesson(lessonPath);
  const { lesson: L, dir, accent } = ctx;
  const imagesDir = path.join(dir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const manifestPath = path.join(imagesDir, 'manifest.json');

  // ── 1. 요청 수집 + 형식 검증 ─────────────────────────────
  const requests = collect(L, []);
  if (requests.length === 0) { console.log('lesson.json에 이미지 요청({image:{...}})이 없습니다.'); process.exit(0); }

  const seenIds = new Set();
  for (const req of requests) {
    if (!req.id) throw new Error(`이미지 요청에 id가 없습니다: ${JSON.stringify(req)}`);
    if (seenIds.has(req.id)) throw new Error(`이미지 id 중복: ${req.id}`);
    seenIds.add(req.id);
    if (!req.role || !['hook', 'concept', 'cover', 'background'].includes(req.role))
      throw new Error(`이미지 ${req.id}: role은 hook|concept|cover|background 중 하나여야 합니다.`);
    if (!req.ratio || !RATIOS.includes(req.ratio))
      throw new Error(`이미지 ${req.id}: ratio는 ${RATIOS.join('|')} 중 하나여야 합니다.`);
    if (!req.style || !['photo', 'illustration', 'diagram-ish'].includes(req.style))
      throw new Error(`이미지 ${req.id}: style은 photo|illustration|diagram-ish 중 하나여야 합니다.`);
    if (!req.brief || !String(req.brief).trim())
      throw new Error(`이미지 ${req.id}: brief가 필요합니다(무엇을 보여 줄 그림인지 한두 문장).`);
  }

  // ── 2. 브리프 파일 ───────────────────────────────────────
  function writeBrief(req) {
    const size = RATIO_SIZE_SUBSCRIPTION[req.ratio];
    const pal = accentPalette(accent);
    const md = `# 이미지 브리프 — ${req.id}\n\n` +
      `- role: ${req.role}\n- ratio: ${req.ratio} → 기본(subscription) codex size ${size}(모델 강제 지정 시 api 경로는 16:9도 1536x1024로 근사)\n- style: ${req.style}\n- brief: ${req.brief}\n\n` +
      `## 컴파일 방법\n` +
      `1. \`references/images.md\`를 읽는다.\n` +
      `2. \`vendor/prompt-kit/skills/image-prompt/SKILL.md\`의 마스터 템플릿(Format A, 5섹션: Scene·Camera·Lighting·Color grading·Texture/Medium — Text-in-image는 쓰지 않는다. 이 이미지에는 글자를 렌더링하지 않는다)으로 이 브리프를 완성 프롬프트로 컴파일한다.\n` +
      `3. 완성 프롬프트를 lesson.json에서 이 요청의 \`image.prompt\` 필드에 넣거나, 이 폴더에 \`${req.id}.prompt.txt\`로 저장한다(끝은 \`AR ${req.ratio}\`).\n` +
      `4. \`node scripts/images.mjs <lesson.json> --compile-only\`를 다시 실행해 검증을 통과시킨다.\n\n` +
      `## 참고 팔레트 (교과 강조색 ${accent} 기준)\n${pal.join(' ')}\n`;
    fs.writeFileSync(path.join(imagesDir, `${req.id}.brief.md`), md, 'utf8');
  }

  // ── 3. 컴파일·검증 단계 ─────────────────────────────────
  async function compilePhase() {
    const missing = [], invalid = [], ready = [];
    for (const req of requests) {
      const txtFile = path.join(imagesDir, `${req.id}.prompt.txt`);
      let source = null, text = null;
      if (typeof req.prompt === 'string' && req.prompt.trim()) { source = 'lesson'; text = req.prompt; }
      else if (fs.existsSync(txtFile)) { source = 'file'; text = fs.readFileSync(txtFile, 'utf8'); }
      if (!text) { missing.push(req); writeBrief(req); continue; }

      const finalText = ensureClassroomClause(text, req, accent);
      const result = await runCheckPrompt(finalText);
      if (!result.ok) { invalid.push({ req, errors: result.errors, warnings: result.warnings }); continue; }

      if (source === 'lesson') req.prompt = finalText;
      // 소스가 무엇이든 항상 images/<id>.prompt.txt에 최종본을 미러링해 둔다 — 검수할 때 바로 열어 볼 수 있고,
      // gate.mjs의 I1이 lesson.json에 prompt가 없는 경우 이 파일에서 읽어 같은 검증을 재현할 수 있다.
      fs.writeFileSync(txtFile, finalText, 'utf8');
      ready.push({ req, text: finalText, hash: sha256(finalText) });
    }
    return { missing, invalid, ready };
  }

  function printChecklist(missing, invalid, ready) {
    console.log(`이미지 요청 ${requests.length}개 — 준비 ${ready.length} · 프롬프트 없음 ${missing.length} · 검증 실패 ${invalid.length}`);
    for (const req of missing)
      console.log(`  [MISSING] ${req.id} (${req.role}/${req.ratio}/${req.style}) → images/${req.id}.brief.md 작성 — brief: "${req.brief}"`);
    for (const { req, errors } of invalid) {
      console.log(`  [INVALID] ${req.id}:`);
      for (const e of errors) console.log(`      ${e.code}: ${e.msg}${e.hint ? ` → ${e.hint}` : ''}`);
    }
    for (const { req } of ready) console.log(`  [OK] ${req.id}`);
  }

  function saveLesson() { fs.writeFileSync(ctx.file, JSON.stringify(L, null, 2) + '\n', 'utf8'); }

  // ── 4. 생성 단계 (Codex CLI) ────────────────────────────
  function loadManifest() {
    if (fs.existsSync(manifestPath)) { try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* 새로 만듦 */ } }
    return { images: {} };
  }
  function saveManifest(m) { fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf8'); }

  function sniffImage(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    return null;
  }

  // codex exec가 stderr에 찍는 "session id: <uuid>" 줄을 그대로 읽는다 — 동시에 여러 이미지를 생성할 때
  // (기본 동시성 2) ~/.codex/generated_images의 "가장 최근 폴더"로 추측하면 두 프로세스가 거의 같은
  // 시각에 끝나 서로의 폴더를 가로채는 경합이 생긴다. 각 프로세스 자신의 출력에서 직접 읽으면 경합이 없다.
  function parseCodexSessionId(text) {
    const m = String(text || '').match(/session\s*id\s*[:=]\s*([0-9a-f-]{8,})/i);
    return m ? m[1] : null;
  }

  // 프롬프트는 커맨드라인 인자가 아니라 stdin으로 넘긴다("codex exec ... -" → PROMPT를 stdin에서 읽음).
  // 이렇게 하면 프롬프트 안의 특수문자(줄바꿈·괄호·& 등)가 쉘 파싱에 걸릴 위험이 없다.
  function runCodex(prompt, size, ratio, id) {
    const instruction = [
      'Use your built-in image generation tool (not the API/CLI fallback) to generate ONE image.',
      `Save the result into the current directory as exactly "${id}.png", then print its absolute path on the last line.`,
      `Target size ${size} (aspect ratio ${ratio}).`,
      '',
      'PROMPT:',
      prompt,
    ].join('\n');
    return new Promise(resolve => {
      const child = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-'], {
        cwd: imagesDir, shell: true, windowsHide: true,
      });
      let stdout = '', stderr = '', settled = false;
      const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      const timer = setTimeout(() => { try { child.kill(); } catch { /* 이미 종료됨 */ } finish({ stdout, stderr: stderr + '\n[timeout]', error: new Error('timeout') }); }, TIMEOUT_MS);
      child.stdout.on('data', d => (stdout += d));
      child.stderr.on('data', d => (stderr += d));
      child.on('close', code => finish({ stdout, stderr, error: code ? new Error(`exit ${code}`) : null }));
      child.on('error', e => finish({ stdout, stderr, error: e }));
      child.stdin.write(instruction);
      child.stdin.end();
    });
  }

  // api 경로: OPENAI_API_KEY로 과금되는 OpenAI Images API를 Node fetch로 직접 호출한다.
  // 모델 문자열을 그대로 넘긴다 — 킷이 모르는 모델이어도 대체하지 않는다. API가 모델을 거부하면
  // 그 응답 본문의 에러 메시지를 그대로 stderr에 담아 반환한다(대체 모델로 넘어가지 않고 그대로 실패).
  // 반환 형태는 runCodex와 맞춰(stdout/stderr/error) generateOne의 공통 처리 로직을 그대로 쓸 수 있게 한다.
  // 키 값은 Authorization 헤더에만 쓰고 어디에도 기록하지 않는다.
  async function runApiImageGen(prompt, size, quality, model, id) {
    const pngPath = path.join(imagesDir, `${id}.png`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(OPENAI_IMAGES_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
          signal: controller.signal,
        });
      } catch (e) {
        return { stdout: '', stderr: `OpenAI Images API 요청 실패: ${e.name === 'AbortError' ? 'timeout' : e.message}`, error: e };
      }
      const raw = await res.text();
      let json = null;
      try { json = JSON.parse(raw); } catch { /* 비JSON 응답 — 아래서 raw 그대로 노출 */ }
      if (!res.ok) {
        const msg = json?.error?.message || raw || `HTTP ${res.status}`;
        const stderr = `OpenAI Images API 에러 (HTTP ${res.status}, model=${model}): ${msg}`;
        return { stdout: '', stderr, error: new Error(msg) };
      }
      const item = json?.data?.[0];
      if (!item) return { stdout: '', stderr: `응답에 data[]가 없음: ${raw.slice(0, 1000)}`, error: new Error('empty data[]') };

      let buf;
      if (item.b64_json) {
        buf = Buffer.from(item.b64_json, 'base64');
      } else if (item.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) return { stdout: '', stderr: `이미지 URL 다운로드 실패: HTTP ${imgRes.status}`, error: new Error('download failed') };
        buf = Buffer.from(await imgRes.arrayBuffer());
      } else {
        return { stdout: '', stderr: 'data[0]에 b64_json도 url도 없음', error: new Error('no image payload') };
      }
      fs.writeFileSync(pngPath, buf);
      return { stdout: `OpenAI Images API: ${buf.length} bytes 저장됨 → ${pngPath}`, stderr: '', error: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function rasterize(browser, pngPath, id) {
    const b64 = fs.readFileSync(pngPath).toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    const page = await browser.newPage();
    try {
      const result = await page.evaluate(async ({ dataUrl, maxLong, quality }) => {
        const img = new Image();
        const loaded = new Promise((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('decode-failed')); });
        img.src = dataUrl;
        await loaded;
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error('zero-size');
        const scale = Math.min(1, maxLong / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        let url = canvas.toDataURL('image/webp', quality), ext = 'webp';
        if (!url.startsWith('data:image/webp')) { url = canvas.toDataURL('image/jpeg', quality); ext = 'jpg'; }
        return { w, h, url, ext };
      }, { dataUrl, maxLong: 1600, quality: 0.85 });
      const webPath = path.join(imagesDir, `${id}.web.${result.ext}`);
      fs.writeFileSync(webPath, Buffer.from(result.url.split(',')[1], 'base64'));
      return { w: result.w, h: result.h, webExt: result.ext };
    } finally { await page.close(); }
  }

  async function generateOne(req, text, hash, manifest, browser, routeCtx) {
    const { ROUTE, forcedModel, quality } = routeCtx;
    const size = (ROUTE === 'api' ? RATIO_SIZE_API : RATIO_SIZE_SUBSCRIPTION)[req.ratio];
    const pngPath = path.join(imagesDir, `${req.id}.png`);
    const logPath = path.join(imagesDir, `${req.id}.codex.log`);
    const log = s => fs.appendFileSync(logPath, s.endsWith('\n') ? s : s + '\n', 'utf8');
    const modelLabel = ROUTE === 'api' ? forcedModel : 'server-selected(subscription)';
    log(`\n==== ${new Date().toISOString()} classforge images.mjs — ${req.id} (route=${ROUTE}, model=${modelLabel}, ${size}, ${req.ratio}) ====`);

    for (let attempt = 1; attempt <= 2; attempt++) {
      log(`-- attempt ${attempt}/2 --`);
      if (fs.existsSync(pngPath)) fs.rmSync(pngPath);
      const { stdout, stderr, error } = ROUTE === 'api'
        ? await runApiImageGen(text, size, quality, forcedModel, req.id)
        : await runCodex(text, size, req.ratio, req.id);
      if (stdout) log(`stdout:\n${stdout}`);
      if (stderr) log(`stderr:\n${stderr}`);
      if (error) log(`error: ${error.message || error}`);

      if (!fs.existsSync(pngPath)) {
        const m = (stdout || '').match(/[A-Za-z]:[\\/][^\r\n"]+?\.png|\/[^\r\n"]+?\.png/g) || [];
        const candidate = m.map(s => s.trim()).find(p => fs.existsSync(p));
        if (candidate) { fs.copyFileSync(candidate, pngPath); log(`stdout에서 경로 찾아 복사함: ${candidate}`); }
      }
      if (!fs.existsSync(pngPath)) { log('실패: png 파일을 찾지 못함'); continue; }

      const buf = fs.readFileSync(pngPath);
      if (!sniffImage(buf)) { log('실패: PNG/JPEG 시그니처가 아님'); continue; }

      let dims;
      try { dims = await rasterize(browser, pngPath, req.id); }
      catch (e) { log(`실패: 이미지 디코드 실패 — ${e.message}`); continue; }

      // 목표 비율은 codex에 실제로 요청한 size(6종 사이즈락)의 비율로 잰다 — "4:3"·"3:4"는
      // 그 자체가 이미 codex가 낼 수 있는 가장 가까운 3:2/2:3 버킷의 근사 표기이기 때문이다
      // (vendor/prompt-kit의 AR_SIZE_MAP과 동일한 근사). 레이블 분수(4/3)와 비교하면 항상 ~12% 어긋나 오탐한다.
      const [tw, th] = size.split('x').map(Number);
      const targetRatio = tw / th, actualRatio = dims.w / dims.h;
      const longSide = Math.max(dims.w, dims.h);
      if (longSide < 1024) { log(`실패: 긴 변 ${longSide}px < 1024`); continue; }
      if (Math.abs(actualRatio / targetRatio - 1) > 0.10) {
        log(`실패: 비율 불일치 (요청 size ${size}, 실제 ${dims.w}x${dims.h})`); continue;
      }

      manifest.images[req.id] = {
        id: req.id, promptHash: hash, file: `images/${req.id}.png`, web: `images/${req.id}.web.${dims.webExt}`,
        width: dims.w, height: dims.h, bytes: buf.length, ratio: req.ratio, role: req.role, style: req.style,
        route: ROUTE, model: ROUTE === 'api' ? forcedModel : 'server-selected',
        quality: ROUTE === 'api' ? quality : null,
        codexSessionId: ROUTE === 'subscription' ? parseCodexSessionId(`${stdout}\n${stderr}`) : null,
        createdAt: new Date().toISOString(),
      };
      log(`성공: ${dims.w}x${dims.h}, ${buf.length} bytes, web=.${dims.webExt}`);
      return true;
    }
    return false;
  }

  async function pool(items, limit, worker) {
    let i = 0;
    const results = new Array(items.length);
    async function runner() { while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); } }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return results;
  }

  // ── 실행 ─────────────────────────────────────────────────
  const { missing, invalid, ready } = await compilePhase();
  printChecklist(missing, invalid, ready);
  saveLesson();

  if (missing.length || invalid.length) {
    console.error(`\n${missing.length + invalid.length}개 이미지가 준비되지 않았습니다. 위 안내(브리프·오류)를 따라 lesson.json 또는 images/<id>.prompt.txt를 고친 뒤 다시 실행하세요.`);
    process.exit(COMPILE_ONLY ? 2 : 1);
  }
  if (COMPILE_ONLY) { console.log('\n모든 이미지 프롬프트가 컴파일·검증되었습니다.'); process.exit(0); }

  // ── 경로 선택: subscription(기본, Codex 내장 도구, 모델 선택 불가) vs api(모델 강제, OPENAI_API_KEY 과금) ──
  const forcedModel = (L.images && L.images.model) || process.env.CLASSFORGE_IMAGE_MODEL || null;
  const apiQuality = (L.images && L.images.quality) || 'high';
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  let ROUTE;
  if (ROUTE_FLAG === 'subscription' || ROUTE_FLAG === 'api') {
    ROUTE = ROUTE_FLAG;
    if (ROUTE === 'api' && !hasApiKey) {
      console.error('--route api 이지만 OPENAI_API_KEY가 설정되어 있지 않습니다. 환경변수를 설정하거나 --route subscription을 쓰세요.');
      process.exit(2);
    }
  } else if (forcedModel) {
    if (!hasApiKey) {
      console.error(
        `lesson.json의 images.model(또는 CLASSFORGE_IMAGE_MODEL) = "${forcedModel}" 이 설정되어 있지만 OPENAI_API_KEY가 없습니다.\n` +
        `이 모델은 api 경로(사용자의 OpenAI API 과금)에서만 강제할 수 있습니다 — Codex 내장 image_generation 도구(구독 쿼터)는 모델을 선택할 수 없습니다.\n` +
        `OPENAI_API_KEY를 설정해 강제 지정하거나, --route subscription으로 서버가 고른 모델(구독 쿼터)을 쓰세요.`
      );
      process.exit(2);
    }
    ROUTE = 'api';
  } else {
    ROUTE = 'subscription';
  }
  const routeCtx = { ROUTE, forcedModel, quality: apiQuality };

  const manifest = loadManifest();
  // 캐시 키는 사실상 (promptHash, route, model[, quality]) 튜플이다 — 프롬프트가 그대로여도
  // 경로·강제 모델·품질이 바뀌면 다른 이미지가 나올 수 있으므로 캐시를 무효화하고 다시 생성한다.
  const toGenerate = ready.filter(({ req, hash }) => {
    if (FORCE) return true;
    const cached = manifest.images[req.id];
    if (!cached || cached.promptHash !== hash || !fs.existsSync(path.join(imagesDir, `${req.id}.png`))) return true;
    // route가 없는 옛 manifest 항목은 이 기능 이전의 유일한 경로였던 subscription으로 간주한다
    // (그렇지 않으면 route 필드를 추가하는 것만으로 기존 캐시가 전부 무효화되어 조용히 재생성·재과금된다).
    const cachedRoute = cached.route || 'subscription';
    if (cachedRoute !== ROUTE) return true; // 경로가 바뀌면(subscription↔api) 같은 프롬프트여도 다시 생성
    if (ROUTE === 'api' && (cached.model !== forcedModel || cached.quality !== apiQuality)) return true; // 강제 모델·품질이 바뀌어도 다시 생성
    return false;
  });
  if (toGenerate.length === 0) { console.log('\n생성할 이미지 없음 — 캐시가 모두 최신 상태입니다.'); process.exit(0); }

  console.log(`\n${toGenerate.length}개 이미지를 생성합니다(경로 ${ROUTE}${ROUTE === 'api' ? `, 모델 ${forcedModel}, 품질 ${apiQuality}` : ''}, 동시성 ${CONCURRENCY})...`);
  const browser = await launch();
  const failures = [];
  try {
    await pool(toGenerate, CONCURRENCY, async ({ req, text, hash }) => {
      const ok = await generateOne(req, text, hash, manifest, browser, routeCtx);
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${req.id}`);
      if (!ok) failures.push(req.id);
    });
  } finally {
    await browser.close();
    saveManifest(manifest);
  }

  if (failures.length) {
    console.error(`\n실패한 이미지: ${failures.join(', ')} — images/<id>.codex.log를 확인하세요.`);
    process.exit(1);
  }
  console.log('\n모든 이미지 생성·검증 완료. images/manifest.json 참고.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
