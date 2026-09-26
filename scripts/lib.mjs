// classforge 공용 모듈 — 레슨 로드, 고정 팔레트, 학교급 규칙, 브라우저 실행
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 고정 팔레트 — 모든 교과가 같은 색을 쓴다(교과별 강조색·meta.accent는 없앴다). references/design.md "팔레트".
// accent(코럴)는 채움·표시 전용이다 — 종이 위 글자색으로 쓰면 대비 2.5:1이라 B3에 걸린다. 코럴 위 글자는 ink.
export const PALETTE = {
  primary: '#3B1E54',    // 제목·핵심 낱말·주요 틀·그래프 축, chapter/exit 어두운 면
  secondary: '#7A5C9E',  // 소제목·아이콘·크롬, 2순위 막대
  accent: '#FF6F61',     // 코럴: 배지·형광펜 밑줄·핵심 점/막대(채움 전용)
  ink: '#191520',        // 본문
  sub: '#211B27',        // 소제목 아래 리드·핵심 설명 문장
  data: '#1C1E24',       // 표·그래프 값 라벨·자료 설명
  paper: '#F8F6FA',      // 슬라이드 종이(인쇄물은 흰 종이 위 연한 판)
};

// 학교급별 한계값 — 게이트와 작성 규칙이 같은 표를 쓴다 (1920×1080 기준 px)
export const LEVELS = {
  elem:   { name: '초등', minBody: 38, minSmall: 28, titleMax: 24, bulletMax: 34, pointsMax: 3, slideChars: 125, wsMinPt: 11 },
  middle: { name: '중등', minBody: 34, minSmall: 26, titleMax: 28, bulletMax: 42, pointsMax: 4, slideChars: 160, wsMinPt: 10.5 },
  high:   { name: '고등', minBody: 32, minSmall: 24, titleMax: 32, bulletMax: 48, pointsMax: 4, slideChars: 180, wsMinPt: 10 },
};

export const SLIDE_TYPES = ['cover', 'goals', 'hook', 'chapter', 'concept', 'compare', 'steps', 'diagram',
  'bignum', 'quiz', 'activity', 'vocab', 'timeline', 'summary', 'exit', 'passage'];
export const ITEM_TYPES = ['concept', 'choice', 'short', 'ox', 'match', 'table', 'draw', 'figure', 'passage'];

export function loadLesson(p) {
  const file = path.resolve(p);
  const lesson = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const out = path.join(dir, 'out');
  const level = lesson.meta?.level in LEVELS ? lesson.meta.level : 'middle';
  return { file, dir, out, lesson, level, rules: LEVELS[level] };
}

export function findChrome() {
  const cands = [process.env.CLASSFORGE_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return cands.find(c => c && fs.existsSync(c));
}

export async function launch() {
  const { chromium } = await import('playwright-core');
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Chrome/Edge를 찾지 못했습니다. CLASSFORGE_CHROME 환경변수로 경로를 지정하세요.');
  return chromium.launch({ executablePath, headless: true });
}

export const fileUrl = p => 'file:///' + path.resolve(p).replace(/\\/g, '/');

// 본문 텍스트(마크업 제외) — 글자 수 예산과 수치 대조에 쓴다
export const plain = s => String(s ?? '').replace(/\*\*|==|\{\{|\}\}/g, '');
