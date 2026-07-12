/**
 * insights.ts에서 실제 로드된 NEGATIVE_KEYWORDS 개수 확인
 */
import { NEGATIVE_KEYWORDS, CRISIS_KEYWORDS } from '../src/lib/sparkscope/insights';

console.log('\n📊 로드된 키워드 확인\n');

console.log(`NEGATIVE_KEYWORDS (${NEGATIVE_KEYWORDS.length}개):`);
NEGATIVE_KEYWORDS.forEach((k, i) => {
  console.log(`  ${i + 1}. ${k}`);
});

console.log(`\nCRISIS_KEYWORDS (${CRISIS_KEYWORDS.length}개):`);
CRISIS_KEYWORDS.forEach((k, i) => {
  console.log(`  ${i + 1}. ${k}`);
});

console.log('\n✅ 규칙이 정상 로드됨\n');
