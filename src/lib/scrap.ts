// 스크랩(기사 큐레이션) 권한 — .env.local의 SCRAP_ALLOWED_EMAILS로 관리.
// 커뮤니케이션 본부 지정 계정만 스크랩(별표) 가능. (개발 OPEN_ACCESS 모드에선 테스트 위해 허용)
import { OPEN_ACCESS } from '@/lib/flags';

export function scrapAllowedEmails(): string[] {
  return (process.env.SCRAP_ALLOWED_EMAILS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function canScrap(email: string | null | undefined): boolean {
  if (OPEN_ACCESS) return true;
  return !!email && scrapAllowedEmails().includes(email);
}
