// 톤 분류 휴리스틱 수정 검증용 스크립트 (DB 접근 없음, 순수 로직 테스트)
// 실행: npx tsx scripts/test-tone-heuristic.mts
import { hasNegativeKeyword, hasCrisisKeyword, countNegativeSignals } from '../src/lib/sparkscope/keywords-data';

type Case = {
  label: string;
  title: string;
  body?: string;
  expectNegative: boolean;
};

const cases: Case[] = [
  // 기존에 놓치던 부정 표현 (리스트 확충으로 잡혀야 함)
  { label: '실적부진', title: '○○테크, 3분기 실적부진에 매출감소 이어져', expectNegative: true },
  { label: '구조조정', title: '△△컴퍼니, 대규모 구조조정 단행', expectNegative: true },
  { label: '매각/철수', title: '□□스타트업, 국내 사업 철수 후 매각 검토', expectNegative: true },
  { label: '리콜', title: '◇◇, 배터리 결함으로 제품 리콜', expectNegative: true },
  { label: '횡령/배임', title: '전 대표, 회삿돈 횡령·배임 혐의로 기소', expectNegative: true },
  { label: '갑질/불매', title: '☆☆기업, 갑질 논란에 불매운동 확산', expectNegative: true },
  // crisis 키워드로만 잡히는 경우 (negative 리스트엔 없던 것)
  { label: 'crisis: 경쟁심화', title: '업계 경쟁심화로 스타트업 줄도산 우려', expectNegative: true },
  { label: 'crisis: 유동성부족', title: '△△社, 유동성부족으로 자금난 가중', expectNegative: true },
  // 오탐 수정 확인: "뜻밖의"는 더 이상 부정 키워드가 아니어야 함
  { label: '오탐 제거: 뜻밖의', title: '△△社, 뜻밖의 호재로 주가 반등', expectNegative: false },
  // 본문 홀리스틱 override: 제목은 중립인데 본문에 부정 신호 몰림
  {
    label: '본문 override',
    title: '○○社 하반기 사업 계획 발표',
    body: '○○社는 올해 소송과 규제 조사를 동시에 받고 있으며, 매출감소와 구조조정, 부채 증가까지 겹치며 유동성위기설이 나온다.',
    expectNegative: true,
  },
  // 긍정 케이스가 여전히 잘 잡히는지 회귀 확인
  { label: '긍정 유지', title: '○○社, 시리즈B 투자 유치 성공', expectNegative: false },
];

let pass = 0;
console.log('=== 톤 휴리스틱 검증 ===\n');
for (const c of cases) {
  const isNeg = hasNegativeKeyword(c.title) || hasCrisisKeyword(c.title) !== null
    || (!!c.body && countNegativeSignals(c.body) >= 3);
  const ok = isNeg === c.expectNegative;
  pass += ok ? 1 : 0;
  console.log(`${ok ? '✅' : '❌'} [${c.label}] expected=${c.expectNegative} actual=${isNeg} — "${c.title}"`);
}
console.log(`\n${pass}/${cases.length} 통과`);
if (pass !== cases.length) process.exitCode = 1;
