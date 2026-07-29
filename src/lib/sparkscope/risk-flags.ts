// 부정 기사 세부 유형 뱃지 — analyzeDeep이 저장하는 riskFlag를 사람이 읽을 라벨/색상으로 변환.
// ToneBreakdown.tsx, dashboard/page.tsx(PortfolioNegatives) 양쪽에서 같은 뱃지를 쓰기 위해 공용으로 뺌.
export const RISK_FLAGS: Record<string, { label: string; cls: string }> = {
  litigation: { label: '⚖️ 소송·수사', cls: 'bg-red-100 text-red-700' },
  crisis: { label: '🚨 사고·재무', cls: 'bg-orange-100 text-orange-700' },
  controversy: { label: '💬 논란', cls: 'bg-amber-100 text-amber-700' },
};
