/**
 * 포트폴리오사 계정이 볼 수 있는 범위 — 한 곳에서만 정한다.
 *
 * 기사와 회사를 잇는 것은 Article.matchedKeyword 다(수집 때 어떤 키워드로
 * 걸렸는지). 회사 쪽 키워드는 MonitoringTarget.primaryKeyword 이고,
 * helperKeywords 는 동음이의어 대응용 보조 키워드다.
 *
 * 사내 대시보드(1,571줄 · prisma 호출 40군데)에 회사별 필터를 끼워 넣는 대신
 * 포트폴리오사에게는 전용 화면을 준다. 40군데 중 한 곳만 놓쳐도 남의 회사
 * 기사가 새기 때문이다. 이 파일이 "자기 회사"의 정의를 독점한다.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * helperKeywords 는 스키마 주석상 쉼표 구분이지만 실제 데이터는
 * "이병환 웨어러블"(공백)과 "김용재, 수학교육"(쉼표)이 섞여 있다.
 * 둘 다로 쪼갠다 — 잘못 쪼개도 매칭이 없을 뿐 남의 기사가 들어오지는 않는다.
 */
function splitKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

export type CompanyScope = {
  companyId: string;
  companyName: string;
  keywords: string[];
  /** Article 조회에 그대로 넣는 where 조각 */
  where: Prisma.ArticleWhereInput;
};

/**
 * 회사 하나의 조회 범위를 만든다. 회사가 없거나 비활성이면 null.
 */
export async function getCompanyScope(companyId: string): Promise<CompanyScope | null> {
  const target = await prisma.monitoringTarget.findFirst({
    where: { id: companyId, category: { startsWith: 'portfolio_company' } },
    select: { id: true, name: true, primaryKeyword: true, helperKeywords: true },
  });
  if (!target) return null;

  const keywords = Array.from(
    new Set([target.primaryKeyword, ...splitKeywords(target.helperKeywords)].filter(Boolean)),
  );
  // 키워드가 하나도 없으면 빈 배열로 두지 않는다 — Prisma 의 `in: []` 는
  // 아무것도 반환하지 않지만, 실수로 where 를 빼먹었을 때와 구분되게
  // 매칭 불가능한 값을 넣어 "닫힌" 상태를 명시한다.
  const list = keywords.length > 0 ? keywords : ['__no_keyword__'];

  return {
    companyId: target.id,
    companyName: target.name,
    keywords: list,
    where: {
      matchedKeyword: { in: list },
      // 카테고리까지 못 박는다. helperKeywords 에는 '웨어러블'처럼 일반적인 말이
      // 섞여 있어서(스카이랩스), 키워드만으로 거르면 나중에 산업 동향 기사가
      // 자기 회사 보도로 딸려 들어올 수 있다. 회사 보도는 수집 단계에서
      // portfolio_company(+_tw)로 분류되므로 여기서 한 번 더 좁힌다.
      category: { startsWith: 'portfolio_company' },
      isNoise: false,
    },
  };
}
