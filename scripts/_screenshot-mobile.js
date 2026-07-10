const http = require('http');
const fs = require('fs');

// 대시보드 HTML 가져오기
const req = http.get('http://localhost:3000/dashboard', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // 모바일 viewport 크기로 렌더링 가능한지 확인
    const hasMobileStyles = data.includes('responsive') || data.includes('md:') || data.includes('mobile');
    const hasViewportMeta = data.includes('viewport');

    console.log('=== 모바일 대응 확인 ===\n');
    console.log(`✓ Viewport meta: ${hasViewportMeta ? '있음' : '없음'}`);
    console.log(`✓ Tailwind 반응형 클래스: ${data.includes('md:') ? '있음' : '없음'}`);
    console.log(`✓ "responsive" 검색: ${hasMobileStyles ? '있음' : '없음'}\n`);

    // 구조 확인
    const mainRegex = /<main[^>]*>/;
    const mainMatch = data.match(mainRegex);
    console.log('Main 요소:', mainMatch ? mainMatch[0] : '찾을 수 없음');

    // grid/flex 클래스 찾기
    const gridMatches = data.match(/class="[^"]*grid[^"]*"/g) || [];
    const flexMatches = data.match(/class="[^"]*flex[^"]*"/g) || [];
    console.log(`\nGrid 클래스 사용: ${gridMatches.length}개`);
    console.log(`Flex 클래스 사용: ${flexMatches.length}개`);

    // 반응형 문제 가능성 체크
    const fixedWidths = data.match(/w-\d+|width:\s*\d+px/g) || [];
    console.log(`\n⚠️ 고정 너비 설정: ${fixedWidths.length}개`);

    if (fixedWidths.length > 5) {
      console.log('   → 모바일에서 가로 스크롤이 발생할 가능성 높음');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ 서버 연결 실패:', e.message);
  process.exit(1);
});
