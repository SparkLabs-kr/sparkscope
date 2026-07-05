// 밤사이 자율 진행 결과 + "판단 필요" 메모 (개발 모드에서만 표시).
// 아침에 사용자가 확인하고 결정할 항목들. 커밋/푸시는 하지 않음.

const DONE: { n: string; t: string }[] = [
  { n: '위기감지', t: '실시간 위기 감지 카드 부활 — 최근 3일 부정 급증 감지 + AI 원인요약(로컬은 fallback) + 대표기사 1건 + 실제 회사명. 위기 없을 땐 "정상" 상태 표시.' },
  { n: '[1] 필터', t: '무관 회사 기사 제외 — 짧은 회사명 부분일치("노리"→"노리지만", "리코"→"인실리코")를 토큰 경계 매칭으로 차단. 수집 필터 + 표시 가드 + AI 분류 프롬프트 강화.' },
  { n: '[2] 스크랩', t: '동작 로직 화면에 명시(TOP3=스크랩 우선→점수순). /scrap 접속 가능(리다이렉트). 스크랩함에 검수 콘솔 링크 추가.' },
  { n: '[3] 검색창', t: '최근 수집 기사 실시간 검색(제목·매체·회사·분류) + 지우기.' },
  { n: '[4] 비교카드', t: '"포트폴리오 VS 타 하우스 AC·VC" 실데이터화 — 스파크랩 포트폴리오 + 실제 타 하우스 상위 3곳. 목업 가짜 A/B/C 제거.' },
  { n: '[5] 데이터소스', t: '페이스북·X·해외 테크 제거, 구글·네이버·링크드인·인스타그램만 유지.' },
  { n: '[6] 검수콘솔', t: '/digest/review 신규 — TOP3 순서/포함, 카테고리 요약, 편집자 한 줄 편집 + 실제 발송 미리보기 + 발송(권한자·확인 팝업).' },
];

const NOTES: { tag: string; body: string }[] = [
  { tag: 'AI 요약(로컬)', body: '로컬 .env.local에 ANTHROPIC_API_KEY가 없어, 위기 원인요약·기사 분석이 로컬 미리보기에선 규칙 기반 fallback으로 나옵니다. 프로덕션(Vercel)엔 키가 있어 실제 AI가 작동합니다. 로컬에서도 진짜 AI를 보려면 .env.local에 키를 넣어야 합니다(저는 .env를 수정하지 않았습니다).' },
  { tag: '위기 "정상" 표시', body: '지금은 최근 3일 부정 급증이 없어 초록색 "감지된 위기 없음"이 표시됩니다. 기능이 살아있음을 보여주려고 넣은 상태 표시입니다. 원치 않으시면 빼겠습니다.' },
  { tag: '검색창 위치', body: '지시는 "달력 위/아래"였지만, 필터 대상인 "최근 수집 기사" 목록 바로 위에 두었습니다(입력하면 바로 아래 목록이 걸러져 자연스러움). 달력 밑으로 옮기길 원하시면 이동하겠습니다.' },
  { tag: '기존 DB 노이즈', body: '"노리지만/인실리코" 같은 기존 오통과 기사는 화면에선 가려지지만 DB엔 남아 있어 상단 KPI 숫자엔 아직 포함됩니다. scripts/cleanup-irrelevant.ts로 영구 정리할 수 있으나, 공유 DB 쓰기라 실행하지 않았습니다(승인 후 --apply).' },
  { tag: '비교카드 의미', body: '"타 하우스 노출"은 현재 데이터상 타 AC·VC 하우스 "자체" 노출 건수 비교입니다. 진짜 "타 하우스의 포트폴리오사" 추적은 감시대상 데이터 확장이 필요합니다.' },
  { tag: '발송 테스트 안 함', body: '/digest/review의 "발송하기"는 실제 메일을 DIGEST_TEST_RECIPIENT로 보냅니다. 밤사이엔 실제 발송을 하지 않았습니다. 아침에 직접 눌러 확인해 주세요.' },
  { tag: '임시 스크립트', body: 'scripts/_diag-*.ts 3개는 밤사이 진단용 임시 파일입니다. 삭제해도 무방하나 "파일 삭제 금지" 지시라 남겨두었습니다.' },
  { tag: '커밋/푸시', body: '지시대로 커밋·푸시하지 않았습니다. 확인 후 결정해 주세요.' },
];

export function NightReviewNotes() {
  return (
    <div className="mt-10">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-xl font-bold text-amber-700">🌙 밤사이 자율 진행 결과 · 판단 필요</h2>
        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold tracking-wider whitespace-nowrap">아침 확인용 · 개발모드에서만 표시</span>
      </div>
      <p className="text-sm text-gray-500 mb-5">2026-07-05 밤 진행. 커밋·푸시·파괴적 작업은 하지 않았습니다.</p>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl border border-green-200">
          <div className="font-bold text-green-700 mb-3">✅ 완료 항목</div>
          <ul className="space-y-2.5">
            {DONE.map(d => (
              <li key={d.n} className="text-sm text-gray-700 leading-relaxed">
                <span className="inline-block px-1.5 py-0.5 mr-1.5 bg-green-100 text-green-800 rounded text-[11px] font-bold align-middle">{d.n}</span>
                {d.t}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white p-5 rounded-xl border border-amber-200">
          <div className="font-bold text-amber-700 mb-3">🟡 판단 필요 / 참고</div>
          <ul className="space-y-2.5">
            {NOTES.map(nt => (
              <li key={nt.tag} className="text-sm text-gray-700 leading-relaxed">
                <span className="inline-block px-1.5 py-0.5 mr-1.5 bg-amber-100 text-amber-800 rounded text-[11px] font-bold align-middle">{nt.tag}</span>
                {nt.body}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
