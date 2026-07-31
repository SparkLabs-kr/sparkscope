import { GoogleGenAI } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { BIO_TREND_SECTORS, AI_TREND_SECTORS } from './inter-taxonomy';

const BIO_SECTOR_KEYS = BIO_TREND_SECTORS.map(s => s.key).join(', ');
const AI_SECTOR_KEYS = AI_TREND_SECTORS.map(s => s.key).join(', ');

const SYSTEM = `당신은 스파크랩 인터(해외 트렌드) 탭의 AI/바이오 도메인 뉴스 분류기입니다.
수집된 해외 기사 제목이 "글로벌 AI 업계 트렌드" 또는 "글로벌 바이오 업계 트렌드"와 실제로 관련 있는지 판단하고,
관련 있다면 도메인(ai/bio)과 세부 섹터를 분류하고, 제목을 한국어로 번역합니다.

바이오 세부 섹터: ${BIO_SECTOR_KEYS}
AI 세부 섹터: ${AI_SECTOR_KEYS}

쿠폰·할인코드, 무관한 소송·노동 분쟁, AI/바이오와 무관한 일반 소비자 리뷰, 지정학/일반 정치 뉴스는 관련 없음(noise)입니다.
기사가 두 도메인 모두에 걸치면 더 핵심적인 쪽 하나만 고릅니다.
응답은 반드시 valid JSON 배열만.`;

function buildUserPrompt(batch: Array<{ id: string; source: string; title: string }>): string {
  return `다음 ${batch.length}개 기사 제목을 판단하세요.

${batch.map((a, i) => `${i + 1}. [${a.source}] ${a.title}`).join('\n')}

출력 스키마: [{
  "index": 0-based,
  "relevant": true|false,
  "reason": "<한 줄 이유>",
  "domain": "ai"|"bio"|null,   // relevant=false면 null
  "sector": "<위 세부 섹터 목록 중 하나>"|null,   // relevant=false면 null
  "titleKo": "<제목 한국어 번역>"|null   // relevant=false면 null
}]
JSON 배열만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

type FilterVerdict = {
  index: number;
  relevant: boolean;
  reason: string;
  domain?: 'ai' | 'bio' | null;
  sector?: string | null;
  titleKo?: string | null;
};

async function classifyBatch(
  ai: GoogleGenAI,
  batch: Array<{ id: string; source: string; title: string }>
): Promise<FilterVerdict[]> {
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: buildUserPrompt(batch),
      config: { systemInstruction: SYSTEM },
    });

    const text = result.text ?? '';
    const parsed = JSON.parse(extractJson(text)) as FilterVerdict[];
    return parsed;
  } catch (e: any) {
    console.error(`[Inter] Gemini 필터링 실패: ${e.message}`);
    // 실패 시 모두 noise로 표시 (안전한 기본값)
    return batch.map((_, i) => ({ index: i, relevant: false, reason: '필터링 오류' }));
  }
}

export async function filterInterNewsWithGemini(newsIds: string[]): Promise<{ filtered: number; relevant: number; failed: string[] }> {
  if (newsIds.length === 0) {
    return { filtered: 0, relevant: 0, failed: [] };
  }

  console.log(`[Inter] Gemini 필터링 시작: ${newsIds.length}건`);

  // Vertex AI 클라이언트 초기화
  const vertexAI = new GoogleGenAI({ vertexai: true, project: 'communication-504101', location: 'global' });

  // 기사 조회
  const articles = await prisma.interNews.findMany({
    where: { id: { in: newsIds } },
  });

  const failed: string[] = [];
  let relevant = 0;

  // 배치 처리 (10개씩)
  const BATCH_SIZE = 10;
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE).map(a => ({
      id: a.id,
      source: a.source,
      title: a.title,
    }));

    const verdicts = await classifyBatch(vertexAI, batch);

    // 판정 결과를 DB에 저장
    for (const verdict of verdicts) {
      const article = batch[verdict.index];
      if (!article) continue;

      try {
        await prisma.interNewsVerdict.create({
          data: {
            newsId: article.id,
            relevant: verdict.relevant,
            reason: verdict.reason,
            domain: verdict.relevant ? (verdict.domain ?? null) : null,
            sector: verdict.relevant ? (verdict.sector ?? null) : null,
            titleKo: verdict.relevant ? (verdict.titleKo ?? null) : null,
            model: 'gemini-3.1-flash-lite',
            filteredAt: new Date(),
          },
        });

        if (verdict.relevant) relevant++;
      } catch (e: any) {
        console.error(`[Inter] 판정 저장 실패 (${article.source}): ${e.message}`);
        failed.push(article.source);
      }
    }

    // 배치 사이에 작은 딜레이 (API 레이트 리미트 방지)
    if (i + BATCH_SIZE < articles.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`[Inter] 필터링 완료: ${articles.length}건 처리, ${relevant}건 관련, ${failed.length}개 오류`);
  return { filtered: articles.length, relevant, failed };
}
