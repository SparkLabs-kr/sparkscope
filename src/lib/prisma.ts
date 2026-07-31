// Prisma 싱글톤 (Next.js dev 핫리로드 시 connection leak 방지)
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

// pgbouncer(트랜잭션 모드)를 거치므로 Prisma 클라이언트 쪽 connection_limit을 넉넉히 잡아도
// 실제 Postgres 커넥션 수는 pgbouncer가 알아서 멀티플렉싱한다. 기본값(CPU 코어 기반 추정치)이
// 서버리스 환경에서 너무 작게 잡혀 대시보드 페이지의 Promise.all 쿼리 20여 개가 몇 개씩만
// 동시 실행되고 나머지는 대기하는 문제가 있었다 (대시보드 초기 쿼리 묶음이 ~5초 소요됨을 확인).
function withConnectionLimit(url: string | undefined, limit: number): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limit}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: { url: withConnectionLimit(process.env.POSTGRES_PRISMA_URL, 15) },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
