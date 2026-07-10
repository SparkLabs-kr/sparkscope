/**
 * 무인 배치 재분류: 슈퍼베이스 전체 26,049건
 *
 * [전략]
 * - Haiku 1차분류만 (category, tone, isNoise, noiseReason, 정치필터, 부정키워드)
 * - 병렬 요청 처리 (동시에 최대 10개 요청) → 비용 최적화
 * - 드라이런 20건 + 전체 26,049건
 * - 안전한 결과만 자동 적용
 * - 신뢰도 낮은 / 톤 급변 / 새 부정 / 파싱 에러 → 검토 대기
 *
 * [호출] tsx ./scripts/_batch-reclassify.ts [--resume]
 */
import fs from 'fs';
import path from 'path';
import { Anthropic } from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';

// 환경 변수 로드 (tsx는 .env.local 자동 로드 안 함)
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"(.*)"$/, '$1');
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────
const LOGS_DIR = path.join(process.cwd(), 'logs');
const TODAY = new Date().toISOString().slice(0, 10);
const LOG_FILE = path.join(LOGS_DIR, `reclassify-${TODAY}.log`);
const REVIEW_FILE = path.join(LOGS_DIR, `needs-review-${TODAY}.csv`);
const STATE_FILE = path.join(LOGS_DIR, `.reclassify-state-${TODAY}.json`);

const DRY_RUN_COUNT = 20;
const ARTICLES_PER_REQUEST = 500; // 한 번의 API 요청에 포함할 기사 수
const MAX_PARALLEL = 10; // 동시 실행 최대 개수
const RETRY_MAX = 3;
const RETRY_DELAY_MS = 2000;

// 부정·위기 키워드
const CRISIS_KEYWORDS_FLAT = [
  '소송', '고소', '고발', '기소', '압수수색', '구속', '과징금', '제재', '위법', '불법',
  '위반', '수사', '검찰', '공정위', '금감원', '세무조사', '적자', '부도', '파산', '회생',
  '법정관리', '자본잠식', '유동성위기', '구조조정', '정리해고', '임금체불', '폐업',
  '상장폐지', '경영난', '다운라운드', '먹튀', '결함', '하자', '리콜', '오류', '장애',
  '먹통', '서버다운', '해킹', '개인정보유출', '정보유출', '보안사고', '불량', '부작용',
  '서비스종료', '논란', '의혹', '갑질', '횡령', '배임', '비리', '뇌물', '성희롱',
  '성추행', '직장내괴롭힘', '폭언', '오너리스크', '표절', '사기', '허위', '과장광고',
  '뒷광고', '구설', '불매', '보이콧', '항의', '집단소송', '피해', '사과문', '해명',
  '반발', '비판', '뭇매', '부정여론', '별점테러', '파업', '노조갈등', '내홍',
  '경영권분쟁', '내부고발', '폭로', '대표사임', '사고', '화재', '사망', '부상', '산재', '안전문제',
];

const POLITICAL_KEYWORDS = ['조국', '일베', '무섭노', '민주당', '국민의힘', '문재인'];
const CENTER_KEYWORDS = ['센터', '기관', '정부', 'MOU', '협력', '교육', '협의', '공동'];

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function appendReview(data: {
  id: string;
  title: string;
  oldTone: string;
  newTone: string;
  reason: string;
}) {
  const csv = `${data.id},"${data.title.replace(/"/g, '""')}",${data.oldTone},${data.newTone},"${data.reason}"`;
  fs.appendFileSync(REVIEW_FILE, csv + '\n');
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(REVIEW_FILE)) {
    fs.writeFileSync(REVIEW_FILE, 'id,title,oldTone,newTone,reason\n');
  }
}

function saveState(state: any) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState(): any {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Haiku 분류 프롬프트
// ─────────────────────────────────────────────────────────────
function buildHaikuPrompt(articles: Array<{
  id: string;
  title: string;
  source: string;
  matchedKeyword: string;
  category: string;
}>): string {
  return `다음 ${articles.length}개 기사를 분류하세요.

기사 목록:
${articles.map(a => JSON.stringify(a)).join('\n')}

출력 스키마 (JSON 배열):
[{
  "id": "<입력 id>",
  "category": "sparklabs_self" | "portfolio_company" | "competitor" | "industry_trend" | "unrelated",
  "tone": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED",
  "isNoise": true | false,
  "noiseReason": null | "auto_generated" | "homonym" | "ad_content" | "political" | "center_institution" | "irrelevant",
  "confidence": 0.0 to 1.0,
  "riskFlag": null | "crisis" | "controversy" | "litigation"
}]

판단 기준:
- category: 기사 주체(주어)가 해당 회사인 경우만. 단순 언급/부분일치 → unrelated
- tone: 위기·부정 신호(소송·부도·해킹·논란·의혹 등) 포함 + 회사가 주어 → NEGATIVE. 단, 이미 해소·무혐의·승소면 → POSITIVE/NEUTRAL
- isNoise: 자동생성·정치(조국/민주당 등)·센터/기관 협력 뉴스 → true
- confidence: AI 분류 신뢰도(0.0~1.0). 애매하거나 오탐 우려 → 0.5 이하
- riskFlag: NEGATIVE일 때만. crisis(사고·재무), controversy(평판), litigation(소송·수사)

오탐 방지:
1. "임팩터스, 서울대와 AI 교육 협력" → tone=NEUTRAL, isNoise=true(noiseReason="center_institution")
2. "스타트업, 적자극복펀드 1000억 조성" → tone=POSITIVE, 적자 키워드 무시
3. "회사가 시장에 '정조준'" (동사) → unrelated
4. "비트바이트" 매칭 but "바이비트(암호화폐 거래소)" → isNoise=true, noiseReason="homonym"

JSON 배열만 반환:`;
}

const HAIKU_SYSTEM = `당신은 스파크랩 PR 분류 어시스턴트입니다.
배치 재분류로 정확하고 일관성 있는 판정을 하세요.
응답: 반드시 JSON 배열만. 마크다운 코드 블록이나 추가 설명 없음.
예: [{"id":"1","category":"positive",...}]`;

// ─────────────────────────────────────────────────────────────
// 병렬 처리 큐
// ─────────────────────────────────────────────────────────────
async function processInParallel<T>(
  items: T[],
  processor: (item: T, index: number) => Promise<any>,
  maxConcurrency: number = MAX_PARALLEL,
): Promise<any[]> {
  const results: any[] = [];
  const queue = [...items];
  const running = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const promise = (async () => {
      try {
        const result = await processor(item, i);
        results[i] = result;
      } catch (e) {
        results[i] = null;
      }
    })();

    running.add(promise);

    if (running.size >= maxConcurrency) {
      await Promise.race(running);
      running.forEach((p, idx) => {
        if (p.then) running.delete(p);
      });
    }
  }

  await Promise.all(running);
  return results;
}

// ─────────────────────────────────────────────────────────────
// API 호출 (재시도 로직)
// ─────────────────────────────────────────────────────────────
async function classifyArticles(articles: Array<{
  id: string;
  title: string;
  source: string;
  matchedKeyword: string;
  category: string;
}>, retryCount = 0): Promise<any[] | null> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: HAIKU_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildHaikuPrompt(articles),
        },
      ],
    });

    const text = (response.content[0] as any)?.text || '';

    // JSON 추출 — 여러 방식 시도
    let jsonStr = text.trim();

    // 방법 1: markdown 블록
    let match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1].trim();
    } else {
      // 방법 2: [ 또는 { 부터 끝까지
      const startIdx = Math.max(
        jsonStr.indexOf('['),
        jsonStr.indexOf('{')
      );
      if (startIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx);
        // 끝 ] 또는 } 찾기
        let depth = 0;
        for (let i = 0; i < jsonStr.length; i++) {
          const ch = jsonStr[i];
          if (ch === '[' || ch === '{') depth++;
          if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) {
              jsonStr = jsonStr.substring(0, i + 1);
              break;
            }
          }
        }
      }
    }

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }

    return parsed;
  } catch (e) {
    if (retryCount < RETRY_MAX) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return classifyArticles(articles, retryCount + 1);
    }
    log(`  ❌ API 에러 (재시도 초과): ${(e as any).message?.substring(0, 100) || e}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 재분류 실행
// ─────────────────────────────────────────────────────────────
async function reclassify(articles: Array<any>, phase: string, articleMap: Map<string, any>): Promise<{
  autoApplied: number;
  needsReview: number;
  errors: number;
}> {
  log(`\n${phase}`);

  let autoApplied = 0;
  let needsReview = 0;
  let errors = 0;

  // 청크 분할
  const chunks = [];
  for (let i = 0; i < articles.length; i += ARTICLES_PER_REQUEST) {
    chunks.push(articles.slice(i, i + ARTICLES_PER_REQUEST));
  }

  log(`📊 ${chunks.length}개 배치 (각 ${ARTICLES_PER_REQUEST}건) 처리 중...`);

  // 병렬 처리
  const results = await processInParallel(chunks, async (chunk, idx) => {
    if (idx % Math.ceil(chunks.length / 10) === 0) {
      log(`  진행: ${Math.round((idx / chunks.length) * 100)}%`);
    }
    return classifyArticles(chunk);
  }, MAX_PARALLEL);

  // 결과 처리
  for (const resultArray of results) {
    if (!resultArray) {
      errors += ARTICLES_PER_REQUEST;
      continue;
    }

    for (const item of resultArray) {
      const articleId = item.id;
      const article = articleMap.get(articleId);

      if (!article) {
        errors++;
        continue;
      }

      const oldTone = article.tone;
      const newTone = item.tone || 'NEUTRAL';
      const confidence = item.confidence ?? 0.5;
      const isNoise = item.isNoise ?? false;

      // 안전 판정
      const shouldAutoApply =
        confidence >= 0.75 &&
        !(oldTone !== newTone && newTone === 'NEGATIVE') &&
        !((oldTone === 'POSITIVE' && newTone === 'NEGATIVE') ||
          (oldTone === 'NEGATIVE' && newTone === 'POSITIVE'));

      if (shouldAutoApply && !isNoise && item.category !== 'unrelated') {
        // 자동 적용
        await prisma.article.update({
          where: { id: articleId },
          data: {
            category: item.category,
            tone: newTone,
            isNoise: false,
            noiseReason: null,
            riskFlag: item.riskFlag || null,
          },
        });
        autoApplied++;
      } else {
        // 검토 대기
        appendReview({
          id: articleId,
          title: article.title,
          oldTone,
          newTone,
          reason:
            confidence < 0.75 ? `신뢰도 낮음 (${(confidence * 100).toFixed(0)}%)`
            : newTone === 'NEGATIVE' ? '새 부정 판정 (검토 필요)'
            : oldTone !== newTone && (oldTone === 'POSITIVE' || oldTone === 'NEGATIVE') ? '톤 급변'
            : isNoise ? `노이즈: ${item.noiseReason}`
            : '기타',
        });
        needsReview++;
      }
    }
  }

  log(`  ✅ 자동 적용: ${autoApplied}, 검토 대기: ${needsReview}, 에러: ${errors}`);
  return { autoApplied, needsReview, errors };
}

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────
async function main() {
  ensureLogsDir();

  const args = process.argv.slice(2);
  const isResume = args.includes('--resume');

  log(`🚀 배치 재분류 시작 (resume=${isResume})`);

  try {
    // 전체 기사 조회
    const allArticles = await prisma.article.findMany({
      select: {
        id: true,
        title: true,
        source: true,
        matchedKeyword: true,
        category: true,
        tone: true,
      },
    });

    log(`📊 전체 기사: ${allArticles.length}건`);

    const articleMap = new Map(allArticles.map(a => [a.id, a]));

    let state = loadState();

    if (!isResume || !state) {
      state = {
        startTime: new Date().toISOString(),
        totalArticles: allArticles.length,
        dryRunDone: false,
        mainDone: false,
      };
    }

    // [1] 드라이런
    if (!state.dryRunDone) {
      log(`\n[단계 1/2] 드라이런 (20건)`);
      const dryRunArticles = allArticles.slice(0, DRY_RUN_COUNT);
      const dryResult = await reclassify(dryRunArticles, '  분류 중...', articleMap);

      log(`✅ 드라이런 완료: ${dryResult.autoApplied}건 적용`);

      state.dryRunDone = true;
      state.dryRunApplied = dryResult.autoApplied;
      state.dryRunReview = dryResult.needsReview;
      state.dryRunErrors = dryResult.errors;
      saveState(state);
    }

    // [2] 메인: 전체
    if (!state.mainDone) {
      log(`\n[단계 2/2] 메인 배치 (${allArticles.length}건)`);
      const mainResult = await reclassify(allArticles, `  분류 중 (최대 ${MAX_PARALLEL}개 병렬)...`, articleMap);

      state.mainDone = true;
      state.mainApplied = mainResult.autoApplied;
      state.mainReview = mainResult.needsReview;
      state.mainErrors = mainResult.errors;
      state.endTime = new Date().toISOString();
      saveState(state);
    }

    // 최종 요약
    const summary = `
═══════════════════════════════════════════════
✅ 배치 재분류 완료
═══════════════════════════════════════════════
📊 처리 현황:
   드라이런(20건): ${state.dryRunApplied || 0}건 적용
   메인(${state.totalArticles}건): ${state.mainApplied || 0}건 자동 적용, ${state.mainReview || 0}건 검토 대기, ${state.mainErrors || 0}건 에러

⏱️  소요 시간:
   시작: ${state.startTime}
   완료: ${state.endTime}

📋 파일 위치:
   - 전체 로그: ${LOG_FILE}
   - 검토 대기: ${REVIEW_FILE}

═══════════════════════════════════════════════
`;

    log(summary);
    console.log(summary);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    log(`❌ 에러: ${error}`);
    console.error(error);
    process.exit(1);
  }
}

main();
