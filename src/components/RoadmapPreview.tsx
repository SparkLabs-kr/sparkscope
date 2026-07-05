// 발표용 고도화 미리보기 (목업) — 실제 데이터 아님.
// page.tsx 에서 DEV_AUTH_BYPASS=true (로컬 데모)일 때만 렌더됩니다.
// 실제 배포본에는 나타나지 않습니다.

function PreviewTag() {
  return (
    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-bold tracking-wider whitespace-nowrap">
      🔧 진행 중
    </span>
  );
}

export function RoadmapPreview() {
  return (
    <div className="mt-10">
      {/* 구분 헤더 */}
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-xl font-bold text-spark-purple">🚀 고도화 미리보기</h2>
        <PreviewTag />
      </div>
      <p className="text-sm text-gray-500 mb-5">
        아래는 다음 단계에서 추가될 기능의 <b>예시 화면</b>입니다. 빠른 시일 내 개발하겠습니다.
      </p>

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        {/* 데이터 소스 커버리지 (비교 카드는 대시보드에 실데이터로 이동됨) */}
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold">🌐 데이터 소스 커버리지</div>
            <PreviewTag />
          </div>
          <div className="space-y-2.5">
            <SourceRow name="구글 뉴스" status="연동 완료" done />
            <SourceRow name="네이버 뉴스" status="연동 완료" done />
            <SourceRow name="링크드인" status="연동 예정" />
            <SourceRow name="인스타그램" status="연동 예정" />
          </div>
          <p className="text-xs text-gray-400 mt-4">출처를 넓혀 기사 누락을 최소화합니다</p>
        </div>
      </div>

    </div>
  );
}

function SourceRow({ name, status, done }: { name: string; status: string; done?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-700">{name}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
        {done ? '✓ ' : '🔜 '}{status}
      </span>
    </div>
  );
}
