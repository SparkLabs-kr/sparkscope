// 발표용 고도화 미리보기 (목업) — 실제 데이터 아님.
// page.tsx 에서 DEV_AUTH_BYPASS=true (로컬 데모)일 때만 렌더됩니다.
// 실제 배포본에는 나타나지 않습니다.

function PreviewTag() {
  return (
    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-bold tracking-wider whitespace-nowrap">
      🔮 개발 예정 · 미리보기
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
        아래는 다음 단계에서 추가될 기능의 <b>예시 화면(목업)</b>입니다. 실제 데이터가 아닌 발표용 참고 이미지입니다.
      </p>

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        {/* 2. 포트폴리오 vs AC·VC 업계 동향 노출 비교 */}
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold">⚔️ 포트폴리오 vs AC·VC 업계 동향 노출 비교</div>
            <PreviewTag />
          </div>
          <div className="space-y-3">
            <CompareRow label="우리 포트폴리오" count={142} total={142} color="bg-spark-purple" />
            <CompareRow label="AC·VC A" count={98} total={142} color="bg-slate-400" />
            <CompareRow label="AC·VC B" count={71} total={142} color="bg-slate-400" />
            <CompareRow label="AC·VC C" count={54} total={142} color="bg-slate-300" />
          </div>
          <p className="text-xs text-gray-400 mt-4">최근 7일 언론 노출 건수 비교 (예시)</p>
        </div>

        {/* 3. 데이터 소스 커버리지 */}
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold">🌐 데이터 소스 커버리지</div>
            <PreviewTag />
          </div>
          <div className="space-y-2.5">
            <SourceRow name="구글 뉴스" status="연동 완료" done />
            <SourceRow name="네이버 뉴스" status="연동 완료" done />
            <SourceRow name="링크드인" status="연동 예정" />
            <SourceRow name="페이스북" status="연동 예정" />
            <SourceRow name="인스타그램" status="연동 예정" />
            <SourceRow name="X (트위터)" status="연동 예정" />
            <SourceRow name="해외 테크 매체" status="연동 예정" />
          </div>
          <p className="text-xs text-gray-400 mt-4">출처를 넓혀 기사 누락을 최소화합니다</p>
        </div>
      </div>

    </div>
  );
}

function CompareRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = (count / total) * 100;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-28 text-gray-600 truncate">{label}</div>
      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 text-right font-semibold">{count}</div>
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
