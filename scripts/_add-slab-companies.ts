import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

interface SlabCompany {
  company_name: string;
  company_name_clean: string;
  company_name_eng: string;
  sector: string;
  original_status: string;
  category: string;
}

const prisma = new PrismaClient();

async function parseCsv(): Promise<SlabCompany[]> {
  const csvPath = path.join(process.cwd(), 'data', 'slab-208-final.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  // 헤더 스킵
  const header = lines[0].split(',').map(h => h.trim());
  const companyNameIdx = header.indexOf('company_name');
  const companyNameCleanIdx = header.indexOf('company_name_clean');
  const companyNameEngIdx = header.indexOf('company_name_eng');
  const sectorIdx = header.indexOf('sector');
  const originalStatusIdx = header.indexOf('original_status');
  const categoryIdx = header.indexOf('category');

  const companies: SlabCompany[] = [];
  let i = 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // 간단한 파싱: 쉼표로 구분 (따옴표 처리 없음 - 이미 정규화됨)
    const parts = line.split(',').map(p => p.trim());

    // 유효한 회사 행 판정: company_name_clean이 있어야 함
    if (parts[companyNameCleanIdx] && parts[companyNameCleanIdx].length > 0) {
      companies.push({
        company_name: parts[companyNameIdx] || parts[companyNameCleanIdx],
        company_name_clean: parts[companyNameCleanIdx],
        company_name_eng: parts[companyNameEngIdx] || '',
        sector: parts[sectorIdx] || '',
        original_status: parts[originalStatusIdx] || '',
        category: parts[categoryIdx] || 'Live',
      });
    }

    i++;
  }

  return companies;
}

async function addCompaniesToDatabase(companies: SlabCompany[]) {
  console.log(`\n🚀 ${companies.length}개 회사 추가 시작...\n`);

  let added = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const company of companies) {
    try {
      // 한글 이름 또는 영문 이름으로 시도
      const displayName = company.company_name_clean || company.company_name;

      const result = await prisma.monitoringTarget.upsert({
        where: { name: displayName },
        update: {
          englishName: company.company_name_eng || undefined,
          updatedAt: new Date(),
        },
        create: {
          name: displayName,
          englishName: company.company_name_eng || undefined,
          category: 'portfolio_company', // SLAB는 포트폴리오 관련 회사로 분류
          status: 'ACTIVE',
          primaryKeyword: company.company_name_clean,
          helperKeywords: company.company_name_eng ? company.company_name_eng : undefined,
          notes: `[SLAB] 부문: ${company.sector || '미분류'} | 상태: ${company.original_status || '미지정'}`,
        },
      });

      if (result.createdAt === result.updatedAt) {
        added++;
      } else {
        skipped++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${company.company_name_clean}: ${msg}`);
    }
  }

  console.log(`✅ 추가 완료:`);
  console.log(`   • 신규 추가: ${added}개`);
  console.log(`   • 기존 회사(스킵): ${skipped}개`);

  if (errors.length > 0) {
    console.log(`\n⚠️ 오류 (${errors.length}개):`);
    errors.slice(0, 10).forEach(e => console.log(`   • ${e}`));
    if (errors.length > 10) {
      console.log(`   ... 외 ${errors.length - 10}개`);
    }
  }

  console.log(`\n총 ${added + skipped}개 처리 완료 ✨\n`);
}

async function main() {
  try {
    console.log('📋 SLAB 208개 신규 회사 추가\n');
    const companies = await parseCsv();
    console.log(`✓ CSV 파싱 완료: ${companies.length}개 회사\n`);

    // 샘플 출력
    console.log('📄 샘플 데이터 (처음 3개):');
    companies.slice(0, 3).forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.company_name_clean} (${c.company_name_eng || '영문명 없음'})`);
    });
    console.log();

    await addCompaniesToDatabase(companies);
  } catch (error) {
    console.error('❌ 오류:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
