const http = require('http');

// 간단히 HTML을 받아서 모바일 viewport 대응 여부 판단
http.get('http://localhost:3000/dashboard', (res) => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    console.log('=== 📱 모바일 반응형 분석 ===\n');

    // 1. Viewport Meta 체크
    const hasViewport = html.includes('viewport');
    console.log(`✓ Viewport meta: ${hasViewport ? '있음 ✅' : '없음 ❌'}`);

    // 2. 반응형 클래스 검사
    const responsiveClasses = {
      'sm:': (html.match(/sm:/g) || []).length,
      'md:': (html.match(/md:/g) || []).length,
      'lg:': (html.match(/lg:/g) || []).length,
      'xl:': (html.match(/xl:/g) || []).length,
    };

    console.log('\n반응형 Tailwind 클래스:');
    Object.entries(responsiveClasses).forEach(([cls, count]) => {
      if (count > 0) console.log(`  ${cls} ${count}개`);
    });

    // 3. 고정 너비/높이 문제 체크
    const fixedSizes = {
      'w-[숫자]': (html.match(/w-\[\d+/g) || []).length,
      'max-w-fixed': (html.match(/max-w-\d+/g) || []).length,
      'px-8': (html.match(/px-8/g) || []).length,
      'px-6': (html.match(/px-6/g) || []).length,
    };

    console.log('\n⚠️ 잠재적 모바일 문제:');
    let issues = 0;
    Object.entries(fixedSizes).forEach(([name, count]) => {
      if (count > 0) {
        console.log(`  ${name}: ${count}개`);
        issues++;
      }
    });

    // 4. 그리드/플렉스 구조
    const gridCount = (html.match(/grid/g) || []).length;
    const flexCount = (html.match(/flex/g) || []).length;
    console.log(`\n레이아웃 구조:`);
    console.log(`  grid: ${gridCount}개`);
    console.log(`  flex: ${flexCount}개`);

    // 5. 모바일-only 숨김
    const hiddenCount = (html.match(/hidden/g) || []).length;
    console.log(`  hidden: ${hiddenCount}개 (반응형 숨김)`);

    // 6. 가로 스크롤 가능성
    const minWidths = (html.match(/min-w-\w+/g) || []).length;
    const maxWidthFull = (html.includes('max-w-full') ? 1 : 0);
    console.log(`\n✓ 가로 스크롤 방지:`);
    console.log(`  max-w-full: ${maxWidthFull}`);
    console.log(`  min-w 제약: ${minWidths}개`);

    console.log('\n=== 결론 ===');
    const totalIssues = issues;
    if (totalIssues === 0) {
      console.log('✅ 기본적인 반응형 구조는 적절해 보입니다.');
      console.log('⚠️ 하지만 실제 레이아웃은 브라우저 렌더링으로만 확인 가능합니다.');
      console.log('   가로 스크롤 등의 문제는 시각적 검사가 필요합니다.\n');
      console.log('🔍 확인 방법:');
      console.log('   1. localhost:3000/dashboard 열기');
      console.log('   2. Chrome DevTools (F12) 열기');
      console.log('   3. "Toggle device toolbar" (Ctrl+Shift+M) 로 모바일 뷰 활성화');
      console.log('   4. iPhone 12 프리셋 선택하고 가로/세로 확인');
    } else {
      console.log(`❌ ${totalIssues}개 항목에서 잠재적 모바일 문제 발견 가능`);
    }
  });
}).on('error', e => console.error('연결 실패:', e.message));
