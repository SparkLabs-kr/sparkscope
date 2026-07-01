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

      {/* 1. 실시간 위기 알림 배너 */}
      <div className="mb-5 rounded-xl border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-white p-4 flex items-start gap-3">
        <div className="text-2xl">🚨</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-red-700">실시간 위기 감지</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded font-bold">URGENT</span>
          </div>
          <p className="text-sm text-red-900 mt-1">
            포트폴리오사 <b>A사</b> 관련 부정 논조 기사가 1시간 내 <b>3건</b> 급증했습니다. 담당자에게 슬랙·메일 알림이 자동 발송되었습니다.
          </p>
          <p className="text-xs text-gray-500 mt-1">방금 전 · #pr-alert 채널 발송 완료</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        {/* 2. 포트폴리오 vs 경쟁사 노출 비교 */}
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold">⚔️ 포트폴리오 vs 경쟁사 노출 비교</div>
            <PreviewTag />
          </div>
          <div className="space-y-3">
            <CompareRow label="우리 포트폴리오" count={142} total={142} color="bg-spark-purple" />
            <CompareRow label="경쟁사 A" count={98} total={142} color="bg-slate-400" />
            <CompareRow label="경쟁사 B" count={71} total={142} color="bg-slate-400" />
            <CompareRow label="경쟁사 C" count={54} total={142} color="bg-slate-300" />
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
            <SourceRow name="네이버 뉴스" status="연동 예정" />
            <SourceRow name="X (트위터)" status="연동 예정" />
            <SourceRow name="링크드인" status="연동 예정" />
            <SourceRow name="해외 테크 매체" status="연동 예정" />
          </div>
          <p className="text-xs text-gray-400 mt-4">출처를 넓혀 기사 누락을 최소화합니다</p>
        </div>
      </div>

      {/* 4. 피칭 기회 워크플로우 */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 mb-5">
        <div className="flex justify-between items-center mb-4">
          <div className="font-bold">🎯 기획기사 피칭 워크플로우</div>
          <PreviewTag />
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <KanbanCol title="제안 대상" tone="amber" items={[
            { topic: 'AI 스타트업 투자 트렌드', score: 88, who: '미정' },
            { topic: '여성 창업가 성장 스토리', score: 79, who: '미정' },
          ]} />
          <KanbanCol title="진행 중" tone="blue" items={[
            { topic: '핀테크 규제 변화 해설', score: 82, who: '은빛' },
          ]} />
          <KanbanCol title="완료 · 보도" tone="green" items={[
            { topic: '포트폴리오사 시리즈B 단독', score: 91, who: '은빛' },
          ]} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 5. 주간 리포트 자동 생성 */}
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold">📑 주간 리포트 자동 생성</div>
            <PreviewTag />
          </div>
          <div className="rounded-lg border border-gray-200 bg-spark-cream p-4">
            <div className="text-sm font-bold text-gray-800">2026년 6월 4주차 본부 인사이트 리포트</div>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 list-disc list-inside">
              <li>총 노출 412건 (전주 대비 +18%)</li>
              <li>긍정 논조 비중 64% → 71% 개선</li>
              <li>피칭 성사 2건, 위기 대응 1건</li>
            </ul>
            <div className="flex gap-2 mt-3">
              <span className="text-xs px-3 py-1.5 bg-spark-purple text-white rounded-lg font-semibold">PDF 다운로드</span>
              <span className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg font-semibold">이메일 발송</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">매주 월요일 자동 생성 (예시)</p>
        </div>

        {/* 6. 키워드 셀프 관리 */}
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold">⚙️ 키워드 셀프 관리</div>
            <PreviewTag />
          </div>
          <div className="space-y-2">
            <KeywordRow name="포트폴리오사 (185)" />
            <KeywordRow name="스파크랩 엔티티 (9)" />
            <KeywordRow name="임원진 (3)" />
            <KeywordRow name="경쟁사 (16)" />
          </div>
          <div className="mt-3 text-xs px-3 py-1.5 bg-spark-light-purple text-spark-purple rounded-lg font-semibold inline-block">
            + 키워드 추가
          </div>
          <p className="text-xs text-gray-400 mt-3">파일 수정 없이 화면에서 직접 관리 (예시)</p>
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

function KanbanCol({ title, tone, items }: { title: string; tone: 'amber' | 'blue' | 'green'; items: { topic: string; score: number; who: string }[] }) {
  const head = {
    amber: 'bg-amber-50 text-amber-800',
    blue: 'bg-blue-50 text-blue-800',
    green: 'bg-green-50 text-green-800',
  }[tone];
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className={`text-xs font-bold px-2 py-1 rounded mb-2 inline-block ${head}`}>{title}</div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-2.5">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-gray-800 truncate">{it.topic}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-spark-light-purple text-spark-purple rounded-full font-bold ml-1">{it.score}</span>
            </div>
            <div className="text-[11px] text-gray-400">담당: {it.who}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeywordRow({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between text-sm px-3 py-2 bg-gray-50 rounded-lg">
      <span className="text-gray-700">{name}</span>
      <span className="text-xs text-gray-400">편집 ›</span>
    </div>
  );
}
