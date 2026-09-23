// classforge 공용 모듈 — 레슨 로드, 교과 강조색, 학교급 규칙, 브라우저 실행
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 교과별 강조색 — 종이색(#FBFAF6) 위 본문 대비 4.5:1 이상으로 고른 값
export const ACCENTS = {
  국어: '#B42318', 수학: '#2952CC', 사회: '#B4480E', 역사: '#8A4B16', 도덕: '#7A3E9D',
  과학: '#0B7A6A', 영어: '#6D28D9', 음악: '#BE185D', 미술: '#C2410C', 체육: '#15803D',
  실과: '#4D7C0F', 기술가정: '#4D7C0F', 정보: '#1D4ED8', 창체: '#0E7490', default: '#2952CC',
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
  const accent = lesson.meta?.accent || ACCENTS[lesson.meta?.subject] || ACCENTS.default;
  return { file, dir, out, lesson, level, rules: LEVELS[level], accent };
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
