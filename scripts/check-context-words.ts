/**
 * data/master-keywords.json 점검: primaryKeyword가 짧거나(2자 이하) 흔한 단어인데
 * contextWords가 비어있는 대상을 찾아낸다.
 * 짧은/흔한 keyword는 "노리"→"노리뜰점"처럼 부분 문자열·동명이인 오탐을 일으키기 쉬움.
 * 새 대상을 CSV/JSON에 추가할 때 체크리스트 대신 돌리는 용도. (npm run keywords:check)
 */
import targets from '../data/master-keywords.json';

const SHORT_LEN = 2; // 이 길이 이하면 위험군

// 흔해서 다른 단어 안에 잘 섞여드는 성씨·일반명사류 (필요시 추가)
const COMMON_WORDS = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '노리', '코드', '스퀘어', '드림', '플레이', '스토리', '메이커',
];

function isRisky(primaryKeyword: string): boolean {
  const k = primaryKeyword.trim();
  if (k.length <= SHORT_LEN) return true;
  if (COMMON_WORDS.includes(k)) return true;
  return false;
}

let flagged = 0;

for (const t of targets as any[]) {
  if (t.status !== 'ACTIVE') continue;
  const pk = (t.primaryKeyword ?? '').trim();
  const ctx = (t.contextWords ?? '').trim();
  if (isRisky(pk) && !ctx) {
    flagged++;
    console.log(`⚠️  [${t.category}] ${t.name} — primaryKeyword="${pk}" 인데 contextWords 없음`);
  }
}

if (flagged === 0) {
  console.log('✓ 짧거나 흔한 primaryKeyword 중 contextWords 누락 없음');
  process.exit(0);
} else {
  console.log(`\n총 ${flagged}건 — 위 대상에 contextWords(문맥어)를 채워주세요.`);
  process.exit(1);
}
