// 근거 기사를 회사/주제 단위로 묶는 규칙.
//
// 원래 ChatWelcome.tsx 안에만 있었는데, HTML로 저장한 리포트는 이 그룹핑을 못 써서
// 기사가 평평한 한 표로만 나왔다(2026-08-18 피드백 — "html은 깨지고 묶이지도 않는다").
// 화면과 저장 파일이 같은 모양이어야 하니 공용 모듈로 뺐다.
import type { ChatQueryResult } from './chat-types';

export type ArticleGroup = { tag: string; items: ChatQueryResult['articles'] };

/**
 * 근거 기사를 두 갈래로 나눈다.
 * - 주제 태그(topic, 예: 신약발굴·항암): 여러 기사가 같은 값을 공유하는 경우가 많아
 *   그룹으로 묶는 게 유용하다.
 * - 회사 태그(company): 해외 트렌드는 엮인 포폴사 조합을 콤마로 이어붙이는데("스카이랩스,
 *   엘리스헬스케어" vs "스카이랩스, 엘리스헬스케어, 크레파스솔루션"), 조합이 기사마다 거의
 *   다 달라서 조합 전체를 키로 쓰면 1건짜리 그룹이 잔뜩 생겨 오히려 안 읽힌다(2026-08-12
 *   실사용 피드백). 회사 이름 하나하나를 키로 써서 실제 회사 단위로 묶고, 기사가 회사를
 *   여러 개 언급하면 각 회사 그룹에 중복으로 들어간다.
 *
 * 어느 쪽으로도 못 묶인(그 회사·주제 기사가 1건뿐인) 기사는 companyArticles로 내려보내
 * 호출부가 "그 외" 목록으로 평범하게 보여주게 한다.
 */
export function organizeArticles(articles: ChatQueryResult['articles']): {
  topics: ArticleGroup[];
  companies: ArticleGroup[];
  companyArticles: ChatQueryResult['articles'];
} {
  const topicGroups = new Map<string, ChatQueryResult['articles']>();
  const companyGroups = new Map<string, ChatQueryResult['articles']>();
  const companyTagged: ChatQueryResult['articles'] = [];
  for (const a of articles) {
    if (a.tagKind === 'topic') {
      const tag = a.matchedKeyword || '기타';
      if (!topicGroups.has(tag)) topicGroups.set(tag, []);
      topicGroups.get(tag)!.push(a);
    } else {
      companyTagged.push(a);
      const names = (a.matchedKeyword || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        if (!companyGroups.has(name)) companyGroups.set(name, []);
        companyGroups.get(name)!.push(a);
      }
    }
  }
  const topics = [...topicGroups.entries()]
    .map(([tag, items]) => ({ tag, items }))
    .filter((g) => g.items.length > 1) // 1건짜리 그룹은 묶는 의미가 없으니 목록으로 내린다
    .sort((a, b) => b.items.length - a.items.length);
  const companies = [...companyGroups.entries()]
    .map(([tag, items]) => ({ tag, items }))
    .filter((g) => g.items.length > 1)
    .sort((a, b) => b.items.length - a.items.length);

  const groupedTopicIds = new Set(topics.flatMap((g) => g.items.map((a) => a.id)));
  const groupedCompanyIds = new Set(companies.flatMap((g) => g.items.map((a) => a.id)));

  return {
    topics,
    companies,
    companyArticles: [
      ...companyTagged.filter((a) => !groupedCompanyIds.has(a.id)),
      ...articles.filter((a) => a.tagKind === 'topic' && !groupedTopicIds.has(a.id)),
    ],
  };
}
