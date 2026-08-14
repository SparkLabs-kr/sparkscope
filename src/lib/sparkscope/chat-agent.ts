// 챗봇의 두뇌 — 도구를 쥐어주고 스스로 여러 번 조회하게 한다.
//
// 예전 구조는 한 방향 파이프라인이었다:
//   질문 → 의도분석 1회 → SQL 1회 → 요약 1회 → 끝
// 0건이 나와도 재시도가 없고, 검색어가 빗나가도 스스로 못 고쳤다. 그래서 조금만
// 비틀어 물어도 빈손으로 답했다.
//
// 지금은 LLM에 조회 도구를 주고 원하는 만큼 부르게 한다. "0건이네 → 검색어 바꿔서 다시 →
// 이번엔 잡혔다 → 답변" 같은 동작이 나온다. 이전 대화도 함께 넘겨 후속 질문을 이해한다.
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { runChatQuery, getCoverageSummary } from './chat-query';
import { runSemanticQuery } from './chat-semantic';
import { runInterQuery, compactInter } from './chat-inter';
import { runPitchQuery, pitchDetailsForModel, runCoverageGap, runDigestArchive } from './chat-ops';
import { proposeKeywordFix, listPendingSuggestions } from './chat-actions';
import { runLiveSearch } from './chat-live';
import { getCompetitorFundSummaries } from './fund-db';
import { PERIOD_LABEL, SCOPE_LABEL, categoryLabel } from './chat-types';
import type { ChatPeriod, ChatScope, ChatQueryResult, ResultKind } from './chat-types';

const MODEL = 'gpt-5.4-mini';
/** 도구 호출 왕복 상한. 넘으면 그때까지 모은 데이터로 답하게 한다. */
const MAX_STEPS = 6;
/** 도구 결과에 실어 보낼 기사 수 — 토큰을 아끼려고 화면에 뿌리는 수보다 적게 준다. */
const ARTICLES_PER_TOOL_RESULT = 18;

export type AgentTurn = { role: 'user' | 'assistant'; text: string };

const PERIODS: ChatPeriod[] = ['today', 'week', 'month', 'quarter', 'all'];
const SCOPES: ChatScope[] = ['portfolio', 'competitor', 'sparklabs', 'industry', 'inter'];

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_articles',
      description:
        '수집된 기사를 검색한다. 건수·분류·매체·회사 집계와 기사 목록을 돌려준다. ' +
        '결과가 0건이거나 너무 적으면 검색어를 바꿔서 다시 부르는 게 정상이다.',
      parameters: {
        type: 'object',
        properties: {
          terms: {
            type: 'array',
            items: { type: 'string' },
            description:
              '제목·요약·회사명에서 찾을 핵심어(최대 8개). 사용자가 쓴 일상어를 그대로 넣지 말고 ' +
              '"기사에 실제로 어떻게 쓰였을까"로 바꿔서, 같은 뜻의 표현을 여러 개 넣어라. ' +
              '예) "투자 받은 데" → ["투자유치","시리즈A","프리A","시드 투자","라운드"]. ' +
              '띄어쓰기 변형(투자 유치)은 시스템이 자동 처리하니 넣지 마라. ' +
              '주제를 안 가리는 질문이면 빈 배열로 두고 기간·범위로만 조회해라. ' +
              '★ 사용자가 한 단어만 콕 집어 물으면("OO 관련 기사 찾아줘", "OO 어때") 그 단어가 ' +
              '흔한 일상어(온도·리코·타코·액스처럼)처럼 보여도 십중팔구 회사/감시대상 이름이다 — ' +
              '뜻으로 풀어서 다른 동의어(예: "온도"→"기온","폭염")로 넓히지 말고 그 단어 자체만 넣어라. ' +
              '날씨·감정 같은 일반적인 뜻으로 확장하면 전혀 무관한 기사가 섞인다.',
          },
          period: { type: 'string', enum: PERIODS, description: '조회 기간' },
          scopes: {
            type: 'array',
            items: { type: 'string', enum: SCOPES },
            description: '검색 범위. 비우면 전체에서 찾는다.',
          },
          only_negative: {
            type: 'boolean',
            description:
              '위기·리스크 질문일 때 true — 부정 톤이거나 위험 플래그가 달린 기사만 본다. ' +
              '이때는 terms를 비워라. 톤 자체가 이미 필터라서 "논란","소송" 같은 단어를 얹으면 ' +
              'AND로 걸려 대부분 0건이 된다(제목에 그 단어가 그대로 있는 기사만 남는다). ' +
              '먼저 terms 없이 부르고, 결과가 너무 많을 때만 좁혀라.',
          },
        },
        required: ['terms', 'period', 'scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description:
        '뜻으로 기사를 찾는다(임베딩 유사도). 키워드가 제목에 없어도 내용이 비슷하면 잡힌다. ' +
        '이럴 때 써라: (1) 주제를 상황·개념으로 물어서 딱 떨어지는 검색어가 없을 때 ' +
        '("해외로 나가는 회사", "새로 뭐 시작한 데"), ' +
        '(2) search_articles를 검색어까지 바꿔가며 시도했는데도 결과가 신통찮을 때. ' +
        '회사 이름처럼 정확한 단어로 찾아야 하는 건 search_articles가 낫다. ' +
        '★ 중요: 임베딩은 "무슨 이야기인지"만 알지 "좋은 소식인지 나쁜 소식인지"는 구분하지 못한다. ' +
        '"투자유치"와 "투자주의종목 지정"이 비슷하다고 나올 정도다. ' +
        '그러니 좋다/나쁘다를 meaning에 쓰지 마라 — 톤은 only_negative로만 거른다.',
      parameters: {
        type: 'object',
        properties: {
          meaning: {
            type: 'string',
            description:
              '찾고 싶은 내용을 기사 문장처럼 한국어로 서술해라. 키워드 나열이 아니다. ' +
              '예) "스타트업이 투자를 유치하거나 매출이 늘어 사업이 잘 풀리고 있다는 소식"',
          },
          period: { type: 'string', enum: PERIODS },
          scopes: { type: 'array', items: { type: 'string', enum: SCOPES } },
          only_negative: { type: 'boolean', description: '부정 톤·위험 기사만 볼 때 true' },
        },
        required: ['meaning', 'period', 'scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'monthly_trend',
      description:
        '최근 6개월 월별 건수를 센다. 추이·증감 질문에 쓴다. ' +
        '검색 결과(건수·기사 목록)도 함께 돌려주므로 같은 조건이면 search_articles를 따로 부를 필요 없다.',
      parameters: {
        type: 'object',
        properties: {
          terms: { type: 'array', items: { type: 'string' } },
          period: { type: 'string', enum: PERIODS, description: '기사 목록·건수를 뽑을 기간' },
          scopes: { type: 'array', items: { type: 'string', enum: SCOPES } },
        },
        required: ['terms', 'period', 'scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inter_trends',
      description:
        '해외 트렌드 기사를 조회한다(TechCrunch·Wired·MIT Tech Review 등 해외 매체를 수집해 ' +
        'AI가 관련성을 판정하고 한국어 제목·주제·국가를 붙여둔 별도 데이터). ' +
        '"해외", "글로벌 트렌드", "외국에서 뭐가 뜨나" 같은 질문은 반드시 이걸 써라. ' +
        'search_articles로는 국내 기사만 나온다. ' +
        '포트폴리오사와 엮인 해외 기사도 표시된다(어떤 회사가 어떤 해외 흐름과 연결되는지).',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: PERIODS },
          domain: { type: 'string', enum: ['bio', 'ai'], description: '바이오 또는 AI. 안 주면 둘 다' },
          country: {
            type: 'string',
            enum: ['us', 'cn', 'jp', 'sa', 'in', 'other'],
            description: '기사가 다루는 트렌드의 주요 국가',
          },
          event_type: {
            type: 'string',
            enum: ['투자·딜', '규제·승인', '연구성과', '제품·상용화', '시장·인물'],
            description: '무슨 일이 일어났는지',
          },
          topic_sector: {
            type: 'string',
            description:
              '주제 섹터. 바이오: 신약발굴, 항암, 약물전달, 의료기기·진단, 디지털헬스 등. ' +
              'AI: 생성형AI·콘텐츠, AI인프라·데이터, 에이전틱AI, AI버티컬 등',
          },
          portfolio_only: { type: 'boolean', description: '포트폴리오사와 엮인 기사만 볼 때 true' },
          company: { type: 'string', description: '특정 포트폴리오사와 엮인 해외 기사만' },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pitch_opportunities',
      description:
        '기획기사 피칭 소재를 찾는다. 수집할 때 기사마다 매겨둔 피칭 가능성 점수(0~100)와 ' +
        '피칭 주제, 본부 관점 코멘트를 함께 돌려준다. ' +
        '"피칭할 거리", "기획기사 소재", "기자한테 뭘 제안하지", "밀어볼 만한 아이템" 같은 질문에 써라.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: PERIODS },
          scopes: { type: 'array', items: { type: 'string', enum: SCOPES } },
          min_score: { type: 'number', description: '점수 하한(기본 70). 결과가 없으면 낮춰서 다시 불러라' },
        },
        required: ['period', 'scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'coverage_gap',
      description:
        '감시 대상 중 해당 기간에 기사가 하나도 안 난 곳을 찾는다(운영 중인 포트폴리오사 218곳 기준). ' +
        'PAUSED·EXIT 상태인 곳은 애초에 수집 대상이 아니라 제외된다. ' +
        '"기사 안 난 데", "조용한 포폴사", "노출 없는 회사", "어디를 챙겨야 하나" 같은 질문에 써라. ' +
        '기사 검색으로는 못 구한다 — 없는 것을 찾으려면 명단과 대조해야 하기 때문이다.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: PERIODS },
          scopes: { type: 'array', items: { type: 'string', enum: SCOPES }, description: '기본은 포트폴리오사' },
          tier: { type: 'string', enum: ['A', 'B', 'C'], description: '포트폴리오 티어로 좁힐 때' },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'digest_archive',
      description:
        '실제로 발송된 다이제스트 메일 기록(날짜·제목·수신자 수). ' +
        '"지난주 메일에 뭐 나갔지", "다이제스트 언제 나갔어" 같은 질문에 써라.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '가져올 개수(기본 10)' },
          on: { type: 'string', description: '특정 날짜만 볼 때 YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'noise_report',
      description:
        '오탐(노이즈)으로 걸러진 기사가 많은 수집 키워드를 돌려준다. ' +
        '키워드 설정·오탐 정리 질문에 쓴다. ' +
        '각 키워드에 수집 상태(status)가 함께 온다 — ACTIVE만 설정을 고쳐서 효과를 볼 수 있다. ' +
        'PAUSED는 이미 수집이 멈춰 있어 오탐 건수가 커 보여도 손댈 게 없으니, ' +
        '고칠 대상을 고를 땐 ACTIVE 중에서 골라라.',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: PERIODS } },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_keyword_fix',
      description:
        '감시 키워드 설정 보완을 "제안"한다. 실제로 반영되지는 않는다 — 승인 대기 목록에 쌓이고 ' +
        '관리자가 대시보드(설정 > 노이즈 제안)에서 승인해야 적용된다. ' +
        '오탐이 많은 키워드를 발견했고 사용자가 고쳐달라고 하면 이걸 써라. ' +
        '★ 반드시 noise_report로 실제 오탐 건수를 확인한 뒤에 제안해라. 추측으로 제안하지 마라.\n' +
        '★★ 두 필드는 방향이 정반대다. 헷갈리면 설정을 망가뜨린다:\n' +
        '  · excludeWords = 제목에 이 단어가 있으면 무조건 버린다. 추가하면 더 엄격해진다 → 오탐이 준다.\n' +
        '  · contextWords = 제목에 이 중 하나라도 있어야 통과한다(OR). 추가하면 더 느슨해진다 → 오탐이 는다.\n' +
        '  따라서 "오탐을 줄이고 싶다"면 답은 거의 항상 excludeWords다. ' +
        '오탐을 일으키는 무관한 주제어(예: 노리가 놀이·게임 기사에 걸리면 "게임, 놀이, 완구")를 excludeWords에 넣어라. ' +
        '그 단어들을 contextWords에 넣으면 정반대로 그 오탐 기사들을 통과시키게 된다.\n' +
        '  contextWords는 그 대상이 문맥어를 아예 안 갖고 있어서 아무 기사나 걸릴 때만 새로 채운다. ' +
        '이미 문맥어가 있는 대상에 단어를 더 보태는 건 필터를 푸는 일이니 하지 마라.',
      parameters: {
        type: 'object',
        properties: {
          target_name: { type: 'string', description: '감시대상 이름 또는 수집 키워드 (예: 노리, 캐스팅)' },
          field: {
            type: 'string',
            enum: ['contextWords', 'excludeWords'],
            description:
              'contextWords=이 단어 중 하나가 제목에 있어야 통과(동명이인·흔한 이름에 씀). ' +
              'excludeWords=이 단어가 있으면 무조건 제외(무관한 주제 차단).',
          },
          addition: { type: 'string', description: '추가할 단어들. 쉼표 구분, 짧게. 예: "에듀테크, 수학, 학습"' },
          reason: { type: 'string', description: '왜 이 제안이 필요한지 한 줄. 오탐 건수 근거를 포함해라.' },
        },
        required: ['target_name', 'field', 'addition', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pending_suggestions',
      description: '승인 대기 중인 키워드 설정 제안 목록을 본다(읽기 전용).',
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'data_coverage',
      description:
        '어느 분류의 기사가 언제부터 수집됐는지, 연도별로 몇 건인지 알려준다. ' +
        '숫자가 이상해 보이거나 기간 비교가 미심쩍을 때, 데이터 현황을 묻는 질문일 때 확인해라.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'live_search',
      description:
        'search_articles/semantic_search를 검색어까지 바꿔가며 시도했는데도 0건이거나 거의 없을 때만 쓰는 ' +
        '실시간 뉴스 검색(구글뉴스·네이버뉴스를 그 자리에서 직접 검색). 우리 DB에 아직 수집되지 않은 회사·주제를 ' +
        '보완하는 용도다. 반드시 DB 도구를 먼저 시도한 다음에만 써라. 결과는 노이즈 필터를 거치지 않은 원본이니 ' +
        '답변에서 "우리 DB엔 없어서 실시간 검색 결과"라고 출처를 밝혀라.',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '실시간으로 검색할 회사명 또는 키워드' } },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'competitor_funds',
      description:
        '경쟁사(VC)가 운용하는 펀드 자체의 정보를 조회한다. 펀드 개수, 총 운용자산(AUM), 주요 투자 섹터, 펀드 목록(이름·조성연도·만기)을 돌려준다. ' +
        '"카카오벤처스 펀드 규모가 얼마야?", "OO벤처스는 펀드를 몇 개 운용해?" 같은 질문에 써라. ' +
        '★ 이 데이터에는 각 펀드가 실제로 투자한 개별 회사(포트폴리오사) 명단이 없다 — 펀드 그릇의 크기·개수·섹터까지만 안다. ' +
        '"OO벤처스가 어디에 투자했어?"처럼 투자사 이름 자체를 물으면 이 도구로는 답할 수 없다는 걸 요약에 분명히 밝혀라 ' +
        '("다시 물어보면 확인해드릴게요"처럼 있는 것처럼 말하지 마라).',
      parameters: {
        type: 'object',
        properties: {
          competitors: {
            type: 'array',
            items: { type: 'string' },
            description: '조회할 경쟁사(VC) 이름 배열. 예: ["카카오벤처스", "미래에셋벤처투자"]. 감시 대상에 등록된 경쟁사명으로.',
          },
        },
        required: ['competitors'],
      },
    },
  },
];

function systemPrompt(uiPeriod: ChatPeriod, uiScopes: ChatScope[], deep: boolean, asTable: boolean) {
  return `너는 스파크랩(초기투자 VC) 커뮤니케이션 본부의 뉴스 분석 담당이다.
수집된 국내 뉴스 기사 DB를 도구로 조회해서 질문에 답한다.

[데이터]
1) 국내 기사 — 분류 넷: 스파크랩(자사), 포트폴리오사(투자한 회사), 경쟁사(VC), 업계동향.
   기사마다 제목·매체·발행일·톤(긍정/중립/부정)·위험 플래그·AI 한 줄 요약·피칭 점수가 있다.
   2026.05부터 매일 정기 수집 중이고, 그 이전은 나중에 소급 수집한 백필 구간이라
   스파크랩·포트폴리오사만 있고 훨씬 성기다. 기간 비교가 이상하면 data_coverage로 확인해라.
2) 해외 기사 — 완전히 별개 데이터다(inter_trends). 해외 매체를 수집해 한국어 제목·주제·국가를
   붙여뒀고, 어떤 포트폴리오사와 연결되는지도 매겨져 있다.
   ★ "업계동향"은 국내 업계 기사지 해외가 아니다. 해외를 물으면 반드시 inter_trends를 써라.
3) 감시 대상 명단(운영 중: 포트폴리오사 218, 경쟁사 114, 업계 57, 스파크랩 17)
   — coverage_gap으로 "기사가 안 난 곳"을 찾는다. 기사 검색으로는 못 구하는 값이다.
4) 발송된 다이제스트 기록 — digest_archive.
5) 경쟁사(VC) 펀드 정보 — 각 경쟁사가 운용하는 펀드 개수·운용자산(AUM)·투자 섹터·펀드 목록(이름·연도·만기).
   "카카오벤처스 펀드 규모가 얼마야?" 같은 질문에 competitor_funds를 써라.
   ★ 이 데이터엔 각 펀드가 실제로 투자한 개별 회사(포트폴리오사) 명단이 없다. "OO벤처스가 어디에
   투자했어?"처럼 투자사 목록을 물으면 competitor_funds로도 답이 안 나온다는 걸 그대로 알려라 —
   "개별 투자사가 필요하면 다시 물어보세요"처럼 있는 것처럼 안내하지 마라.

[화면에서 고른 값]
기간 ${PERIOD_LABEL[uiPeriod]} / 범위 ${uiScopes.length ? uiScopes.map((s) => SCOPE_LABEL[s]).join(', ') : '전체'}
이 값을 함부로 바꾸지 마라. 사용자가 직접 고른 것이다.
질문에 "지난주", "어제", "올해", "이번 달"처럼 기간이 명시됐을 때만 바꿔라.
"요즘", "최근", "요새"처럼 모호한 말은 기간 표현이 아니다 — 화면 값을 그대로 써라.
범위도 마찬가지로, "포폴사만", "경쟁사" 같이 명시됐을 때만 바꾼다.
${uiScopes.includes('inter')
  ? '★ 범위로 "해외 트렌드"가 선택돼 있다 — 이번 조회는 inter_trends만 써라. search_articles·semantic_search·pitch_opportunities 등 국내 도구는 절대 부르지 마라(질문이 국내 얘기처럼 보여도 마찬가지 — 화면에서 명시적으로 고른 범위가 우선이다).'
  : ''}

[도구 사용 원칙]
- 답하기 전에 반드시 도구로 실제 데이터를 확인해라. 추측으로 답하지 마라.
- 조건은 전부 AND로 걸린다. 검색어를 많이 넣을수록 결과가 좁아지는 게 아니라,
  검색어 목록 중 하나라도 걸리는 기사(OR) 중에서 기간·범위·톤을 모두 만족하는 것만 남는다.
- ★ 이 챗봇은 스파크랩 내부 도구다. 사용자가 한 단어만 콕 집어 물으면("온도 어때?",
  "피치스 관련 기사 찾아줘") 그 단어가 흔한 일상어처럼 보여도 구글·네이버에 검색하듯
  일반적인 뜻으로 풀지 말고, 감시 대상(포트폴리오사 등) 이름을 먼저 의심해라 — 여기서
  검색했다는 것 자체가 회사 얘기라는 신호다.
- 검색어가 감시 대상 이름 자체였는데 0건이면(예: "온도"), 그건 오류가 아니라 "이 회사는
  최근 보도가 없다"는 실제 정보다. 이 경우엔 아래 "0건이면 비워서 넓혀라" 규칙을 따르지
  마라 — terms를 비우면 전혀 무관한 회사 기사들이 섞여 들어와 "이게 왜 나오지" 싶은 답이
  된다. 0건 그대로 답하고, matchedEntities에 실린 portfolioStatus가 'Live'가 아니면
  (Exit·Written-off) 그 상태를 먼저 알려라(예: "이 포트폴리오사는 현재 Written-off(청산)
  상태예요"). 화면의 "실시간 검색해볼까요" 제안 버튼은 시스템이 알아서 붙이니 네가 말로
  다시 물을 필요는 없다 — 다만 그 버튼은 terms(구체적 검색어)가 있을 때만 뜨고, 스코프만
  으로 조회한 질문(예: 범위="스파크랩"만 걸고 terms는 비운 경우)엔 안 뜬다.
  ★ "오늘", "방금", "최신"처럼 신선도를 묻는 질문은 이야기가 다르다 — 우리 수집은
  하루 한 번(보통 오전)만 돌아서, "오늘 0건"은 "그 회사 소식이 없다"가 아니라 "오늘
  수집 이후에 나온 기사를 우리가 아직 못 받았다"일 가능성이 크다. 이런 질문엔 terms가
  비어 있었더라도 절대 0건 그대로 "없다"고 답하지 말고, 질문에 나온 회사·스코프 이름을
  keyword로 삼아 live_search를 직접 불러서 실제로 오늘 나온 기사가 있는지 확인한 뒤 답해라.
- (그 외) 첫 검색이 0건이거나 눈에 띄게 적으면 그대로 "없다"고 하지 마라.
  이때 가장 먼저 할 일은 검색어를 다른 단어로 바꾸는 게 아니라 아예 비우는 것이다.
  terms를 빼고 기간·범위·톤만으로 조회하면 무엇이 있는지 실제로 보인다. 그 다음에 좁혀라.
  그래도 없으면 semantic_search로 뜻을 서술해서 찾아보고, 기간을 넓히거나 범위를 풀어라.
- 질문이 "해외 나가는 데", "새로 뭐 시작한 곳"처럼 주제를 상황으로 물어서 딱 떨어지는
  검색어를 못 고르겠으면, 처음부터 semantic_search를 써라. 그게 이 도구의 용도다.
- 좋다/나쁘다를 묻는 질문("시끄러운 데", "잘나가는 데")은 톤 필터가 답이다.
  only_negative=true로 조회해라. 검색어나 meaning에 "논란", "안 좋은" 같은 말을 넣는 게 아니다.
- 반대로 결과가 수천 건이면 너무 넓은 것이다. 검색어를 좁혀서 다시 불러라.
- 도구는 최대 ${MAX_STEPS}번까지 부를 수 있다. 2~3번 안에 끝내는 게 보통이다.
- search_articles(검색어 비우기까지)·semantic_search를 다 시도했는데도 0건이면, 포기하고
  "없다"고 하지 말고 live_search로 실시간 검색을 한 번 더 시도해라. 그 결과를 쓸 때는
  "우리 DB엔 없어서 실시간 검색 결과예요"라고 출처를 밝혀라.
- "늘었나/줄었나", "추세", "흐름", "언제부터" 같은 질문에는 반드시 monthly_trend를 불러라.
  직전 기간 한 개와의 비교만으로 추세를 말하지 마라 — 백필 구간에 걸려 왜곡되기 쉽다.
- 키워드·오탐·수집 설정을 물으면 noise_report를 써라.
- ★ 경쟁사(VC)를 통틀어 물으면("OO에 대해 알려줘", "OO 어때") 기사 통계(건수·매체·톤)와
  펀드 정보(펀드 개수·AUM) 둘 다 궁금한 것으로 보고 두 도구를 다 불러라 — search_articles로
  최근 기사 건수·매체·톤을 확인하고, 대상이 경쟁사(VC)면 competitor_funds도 같이 불러서
  펀드 규모까지 한 답변에 담아라. 펀드 정보만 주고 기사 통계를 빼먹거나 반대로 기사만
  주고 펀드 정보를 빼먹지 마라. 화면 카드는 "마지막으로 성공한 조회" 기준이니, 두 도구를
  다 부른 뒤에는 search_articles를 마지막에 한 번 더 불러 카드에 기사 통계(건수·톤·매체)가
  뜨게 해라.
- ★ 화면 카드(건수·집계·근거 기사 목록)에는 "마지막으로 성공한 조회" 결과가 뜬다.
  그러니 사용자에게 근거로 보여줄 조회를 맨 마지막에 해라. 예를 들어 해외 트렌드를
  물었으면 inter_trends를 마지막에 부른 상태로 답을 마쳐야 화면과 답변이 맞는다.
  탐색용으로 넓게 조회했다면, 답할 내용에 해당하는 조회를 한 번 더 부르고 끝내라.
- 답변에 쓰는 숫자는 화면 카드에 뜰 숫자와 같아야 한다. 여러 번 조회했다면
  어느 조회의 숫자인지 밝혀라("해외 AI 기사 173건", "국내 포폴사 기사 288건"처럼).

[답변 규칙]
- 한국어 존댓말. 인사말·서론 없이 바로 본론.
- ★ 도구 이름(search_articles, coverage_gap, inter_trends 등)을 답변에 절대 쓰지 마라.
  사용자는 그런 게 있는지 모른다. "감시 대상 218곳 기준으로", "해외 트렌드 데이터에서"처럼
  사람이 쓰는 말로 바꿔라.
- 표는 필요할 때만 쓴다. 쓸 때는 마크다운 표 문법(| 열 | 열 | 다음 줄에 |---|---|)을
  정확히 지켜라 — 형식이 어긋나면 화면에 기호가 그대로 보인다.
- 도구가 돌려준 숫자만 쓴다. 직접 계산하거나 추정하지 마라. 데이터에 없는 사실은 절대 지어내지 마라.
- 퍼센트(%) 증감률은 쓰지 마라. "이번 기간 N건, 직전 기간 M건"처럼 건수로 말한다.
- 굵게(**) 같은 마크다운 강조는 쓰지 마라. 평문으로 쓴다.
- 회사 이름을 말할 땐 무슨 일이 있었는지까지 붙인다. 나열만 하지 마라.
- 같은 사안을 여러 매체가 받아쓴 경우 그 사실을 짚어라(건수가 부풀어 보인다).
- 표본 경고(sampled)가 있으면 그 집계를 전체인 것처럼 말하지 마라.
- 기간 비교가 백필 구간에 걸리면 증감을 단정하지 말고 그 사실을 한 줄로 알려라.
- 검색을 여러 번 바꿔서 시도했는데도 결과가 없으면, 무엇을 어떻게 찾아봤는지 밝히고
  검색 조건을 어떻게 바꾸면 좋을지 제안해라.
${deep
      ? '- [심층 분석 켜짐] 6~10문장으로 길게. 기사들을 주제별로 묶고, 왜 이런 흐름인지 원인·맥락까지 짚고, 본부가 무엇을 해야 하는지로 마무리한다.'
      : '- [심층 분석 꺼짐] 3~5문장으로 간결하게. 무엇이 잡혔는지와 눈에 띄는 건만 짚는다. ' +
        '사용자가 "시사점 뽑아줘", "~가지로 정리해줘"처럼 항목별 정리를 요청해도 이 길이 제한이 ' +
        '우선이다 — 번호 매긴 항목이나 문단을 나누지 말고 3~5문장 안에 압축해서 이어지는 문장으로만 ' +
        '써라. 더 깊이 보고 싶으면 화면 상단의 "심층 분석"을 켜라고 짧게 안내해도 된다.'}
${asTable ? '- [표로 정리 켜짐] 핵심 내용을 마크다운 표로 정리해서 함께 보여준다.' : ''}

[후속 질문]
- 답변 본문을 다 쓴 뒤, 완전히 새 줄에 "###FOLLOWUPS###"로 시작하는 줄을 반드시 하나 추가해라.
  그 뒤에 이 답변에 이어 물어볼 만한 구체적인 질문 2~3개를 " | "로 구분해서 적어라.
  예) ###FOLLOWUPS### 이 중 부정 톤 기사만 보여줘 | 지난달과 비교하면 어때 | 경쟁사는 이 주제로 뭐라고 나왔어
- 방금 조회한 데이터로 실제 도구를 다시 불러 답할 수 있는 질문이어야 한다. 뻔하거나 답변과
  무관한 질문은 넣지 마라. 이번 답변이 0건이거나 안내/오류였으면 이 줄 자체를 넣지 마라.
- 이 줄은 사용자에게 문장으로 보여줄 답변이 아니라 시스템이 파싱해서 버튼으로 따로 그린다.
  그러니 이 줄 앞뒤로 설명을 붙이지 말고, 답변 본문 안에서 언급하지도 마라.`;
}

/** 도구 결과를 모델에 돌려줄 때 쓰는 압축 형태 — 링크·id 같은 화면 전용 필드는 뺀다. */
function compactResult(r: ChatQueryResult) {
  return {
    total: r.total,
    prevTotal: r.prevTotal,
    prevPeriodWarning: r.deltaUnavailableReason ?? r.deltaCaution ?? null,
    sampled: r.sampled ?? false,
    negativeCount: r.negativeCount,
    riskCount: r.riskCount,
    // 검색어가 감시 대상 이름과 정확히 일치했을 때만 채워진다. portfolioStatus가
    // 'Live'가 아니면(Exit/Written-off) 그 상태를 답변에 반드시 알려야 한다.
    matchedEntities: r.matchedEntities?.length ? r.matchedEntities : undefined,
    byCategory: r.byCategory.map((c) => ({ name: categoryLabel(c.category), count: c.count })),
    topCompanies: r.topCompanies,
    topSources: r.topSources,
    articles: r.articles.slice(0, ARTICLES_PER_TOOL_RESULT).map((a) => ({
      title: a.title,
      summary: a.oneLiner ?? null,
      company: a.matchedKeyword,
      source: a.source,
      date: a.pubDate.slice(0, 10),
      tone: a.tone,
      risk: a.riskFlag ? true : undefined,
    })),
  };
}

/**
 * 질문에 "명시적인" 기간 표현이 있는지. "요즘"·"최근"처럼 모호한 말은 포함하지 않는다.
 * 화면 드롭다운이 기간의 기준이고, 질문이 대놓고 다른 기간을 말할 때만 양보한다.
 */
const EXPLICIT_PERIOD =
  /지난\s*주|저번\s*주|이번\s*주|금주|주간|어제|오늘|당일|이번\s*달|이달|지난\s*달|저번\s*달|올해|금년|작년|재작년|분기|전체\s*기간|\d+\s*(년|개월|달|주|일)/;

/**
 * 모델이 준 기간을 그대로 믿지 않는다.
 *
 * 프롬프트로 "'요즘'은 기간 표현이 아니다"라고 아무리 적어도 모델이 계속 1개월로 좁혔다.
 * 사용자가 화면에서 3개월을 골라놨는데 답은 1개월 데이터로 나오면 그냥 틀린 답이다.
 * 질문에 명시적 기간 표현이 없으면 화면 값을 강제한다.
 */
function resolvePeriodArg(v: any, fb: ChatPeriod, question: string): ChatPeriod {
  if (!PERIODS.includes(v) || v === fb) return fb;
  return EXPLICIT_PERIOD.test(question) ? v : fb;
}

const asPeriod = (v: any, fb: ChatPeriod): ChatPeriod => (PERIODS.includes(v) ? v : fb);
const asScopes = (v: any): ChatScope[] => (Array.isArray(v) ? v.filter((s) => SCOPES.includes(s)) : []);
const asTerms = (v: any): string[] =>
  Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim().length >= 2).map((t) => t.trim()).slice(0, 8) : [];

export type AgentOutcome = {
  summary: string | null;
  result: ChatQueryResult | null;
  resultKind: ResultKind;
  /** 답변에 이어 물어볼 만한 후속 질문 2~3개. 모델이 summary 끝에 붙인 마커를 파싱한 것. */
  followUps: string[] | null;
  /** 어떤 조회를 몇 번 했는지 — 로그·디버깅용 */
  steps: string[];
  /** 이번 질문에 쓴 토큰. 도구를 여러 번 부르면 왕복마다 쌓이므로 눈에 보이게 남긴다. */
  usage: { calls: number; inputTokens: number; cachedTokens: number; outputTokens: number };
};

// 한자(CJK 통합 한자, U+4E00~U+9FFF) — 후속 질문은 순한글 문장이어야 하는데, 모델이 드물게
// 글자를 잘못 생성해 "관련" 대신 "관寺"처럼 한자가 섞여 나올 때가 있다(2026-08-12 실사용 발견).
// 정상적인 한국어 UI 문구엔 한자가 나올 이유가 없으므로, 섞여 있으면 그 버튼만 버린다.
const HANJA_RE = /[一-鿿]/;

/** summary 끝의 "###FOLLOWUPS### 질문1 | 질문2" 줄을 분리해낸다. 마커가 없으면 그대로 둔다. */
function splitFollowUps(raw: string | null): { summary: string | null; followUps: string[] | null } {
  if (!raw) return { summary: raw, followUps: null };
  const re = /\n?###FOLLOWUPS###\s*(.+)\s*$/;
  const m = raw.match(re);
  if (!m) return { summary: raw, followUps: null };
  const followUps = m[1]
    .split('|')
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && !HANJA_RE.test(q))
    .slice(0, 3);
  return { summary: raw.replace(re, '').trim() || null, followUps: followUps.length ? followUps : null };
}

/** noise_report만 단독으로 불렸을 때(uiResult가 없을 때) 오탐 데이터를 담을 빈 껍데기. */
function emptyResult(): ChatQueryResult {
  return {
    terms: [],
    periodLabel: '',
    total: 0,
    prevTotal: null,
    deltaPct: null,
    deltaUnavailableReason: null,
    deltaCaution: null,
    byCategory: [],
    topSources: [],
    topCompanies: [],
    negativeCount: 0,
    riskCount: 0,
    monthly: null,
    noisyKeywords: null,
    articles: [],
  };
}

/** 도구 이름 → 사용자에게 보여줄 말. 내부 이름을 그대로 노출하지 않는다. */
const TOOL_LABEL: Record<string, string> = {
  search_articles: '기사 검색',
  semantic_search: '의미로 검색',
  inter_trends: '해외 트렌드 조회',
  pitch_opportunities: '피칭 소재 찾기',
  coverage_gap: '노출 사각지대 확인',
  digest_archive: '다이제스트 기록 확인',
  monthly_trend: '월별 추이 집계',
  noise_report: '오탐 키워드 점검',
  data_coverage: '데이터 현황 확인',
  propose_keyword_fix: '설정 보완 제안 등록',
  pending_suggestions: '대기 중인 제안 확인',
  live_search: '실시간 뉴스 검색',
  competitor_funds: '경쟁사 펀드 포트폴리오 조회',
};

export async function runChatAgent(opts: {
  question: string;
  history: AgentTurn[];
  period: ChatPeriod;
  scopes: ChatScope[];
  /** 제안을 남길 때 "누가 요청했는지" 기록용 */
  userEmail: string;
  deep: boolean;
  asTable: boolean;
  /**
   * 진행 상황 알림. 도구를 부르기 직전과 결과가 나온 직후에 호출된다.
   * 화면에서 "지금 뭐 하는 중"을 보여주는 데 쓴다(조회가 5~20초 걸려서 빈 화면이 길다).
   */
  onProgress?: (e: { phase: 'tool_start' | 'tool_done' | 'thinking'; label: string; detail?: string }) => void;
}): Promise<AgentOutcome> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const steps: string[] = [];

  // 화면 카드에 뿌릴 조회 결과. 여러 번 검색하면 "건수가 잡힌 마지막 검색"을 쓴다.
  let uiResult: ChatQueryResult | null = null;
  let monthly: ChatQueryResult['monthly'] = null;
  let noisyKeywords: ChatQueryResult['noisyKeywords'] = null;
  let resultKind: ResultKind = null;

  const usage = { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  const track = (u: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined) => {
    usage.calls++;
    usage.inputTokens += u?.prompt_tokens ?? 0;
    usage.outputTokens += u?.completion_tokens ?? 0;
    usage.cachedTokens += u?.prompt_tokens_details?.cached_tokens ?? 0;
  };

  /**
   * 화면 카드용 결과에 월별 추이·오탐 키워드를 얹어 마무리한다.
   * noise_report만 단독으로 불려서 uiResult가 비어있어도, 모아둔 noisyKeywords는
   * 빈 껍데기에라도 실어 보낸다 — 안 그러면 오탐 점검만 물었을 때 결과가 통째로 null이 돼서
   * 화면·HTML 저장 둘 다 아무것도 못 보여준다(2026-08-11 발견).
   */
  const finish = (raw: string | null): AgentOutcome => {
    const base = uiResult ?? (monthly || noisyKeywords ? emptyResult() : null);
    let result = base ? { ...base, monthly: monthly ?? base.monthly, noisyKeywords: noisyKeywords ?? base.noisyKeywords } : null;

    // 결과가 8건 미만(0건 포함)이고 아직 실시간 검색을 시도하지 않았다면, 사용자에게 제안.
    // 0건도 포함시킨 이유 — 감시 대상 회사 이름으로 검색했는데 최근 보도가 없는 경우
    // (예: "온도")가 실제로 있는데, 예전엔 0건일 땐 이 제안이 아예 안 떠서 그 자리에서
    // 막혀버렸다(2026-08-13 실사용 피드백). noise·inter는 이 흐름과 안 맞아 제외한다 —
    // noise_report는 설정 점검 질문이라 "기사를 더 찾아볼까요"가 어색하고, inter는 해외
    // 데이터라 국내 뉴스만 훑는 실시간 검색으로는 애초에 못 채운다.
    // terms가 비어있으면(기간·범위만으로 조회한 넓은 질문) 실시간 검색이 구글·네이버에
    // 뭘 검색해야 할지 알 수 없다 — 버튼에 "실시간 검색 ()"처럼 빈 검색어가 뜨고, 눌러도
    // keyword가 빈 문자열이라 조용히 원래 채팅 흐름으로 되돌아가버렸다(2026-08-14 발견).
    // 구체적인 검색어가 최소 하나는 있을 때만 제안한다.
    if (result && result.total < 8 && result.terms.length > 0 && resultKind !== 'live' && resultKind !== 'noise' && resultKind !== 'inter') {
      result.needsLiveSearch = true;
    }

    const { summary, followUps } = splitFollowUps(raw);
    return {
      summary,
      result,
      resultKind,
      followUps,
      steps,
      usage,
    };
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(opts.period, opts.scopes, opts.deep, opts.asTable) },
    // 이전 대화 — 후속 질문("그중 부정적인 것만")을 이해하려면 필요하다. 최근 6턴만.
    ...opts.history.slice(-6).map((t) => ({ role: t.role, content: t.text }) as ChatCompletionMessageParam),
    { role: 'user', content: opts.question },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    opts.onProgress?.({ phase: 'thinking', label: step === 0 ? '질문 이해하는 중' : '결과 살펴보는 중' });
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2000,
      tools: TOOLS,
      messages,
    });

    track(resp.usage);
    const msg = resp.choices[0]?.message;
    if (!msg) break;
    messages.push(msg as ChatCompletionMessageParam);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) return finish(msg.content?.trim() || null);

    for (const call of calls) {
      if (call.type !== 'function') continue;
      opts.onProgress?.({
        phase: 'tool_start',
        label: TOOL_LABEL[call.function.name] ?? call.function.name,
      });
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        /* 인자가 깨지면 빈 객체로 두고 기본값으로 조회한다 */
      }

      let payload: unknown;
      try {
        switch (call.function.name) {
          case 'search_articles': {
            const terms = asTerms(args.terms);
            const r = await runChatQuery({
              question: opts.question,
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              scopes: asScopes(args.scopes),
              terms,
              onlyNegative: args.only_negative === true,
              limit: 30,
            });
            steps.push(`search(${terms.join('|') || '전체'}) → ${r.total}건`);
            if (!uiResult || r.total > 0) { uiResult = r; resultKind = 'search'; }
            payload = compactResult(r);
            break;
          }
          case 'semantic_search': {
            const meaning = String(args.meaning ?? opts.question).slice(0, 500);
            const r = await runSemanticQuery({
              meaning,
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              scopes: asScopes(args.scopes),
              onlyNegative: args.only_negative === true,
              limit: 30,
            });
            steps.push(`semantic("${meaning.slice(0, 24)}…") → ${r.total}건`);
            if (!uiResult || r.total > 0) { uiResult = r; resultKind = 'search'; }
            payload = {
              ...compactResult(r),
              searchKind: '의미 검색 결과다. 건수는 "관련도가 충분한 기사 수"이지 ' +
                '해당 주제 전체 건수가 아니다. 총량을 말할 때 이 숫자를 전체인 것처럼 쓰지 마라.',
            };
            break;
          }
          case 'monthly_trend': {
            // 월별 추이는 기간과 무관하게 최근 6개월을 세지만, 같은 호출로 기간 내
            // 건수·기사 목록도 함께 나온다. 화면 카드가 비지 않도록 그 결과도 받아둔다.
            const r = await runChatQuery({
              question: opts.question,
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              scopes: asScopes(args.scopes),
              terms: asTerms(args.terms),
              withTrend: true,
              limit: 30,
            });
            monthly = r.monthly;
            resultKind = 'trend';
            steps.push(`trend(${r.monthly?.length ?? 0}개월) → ${r.total}건`);
            if (!uiResult || r.total > 0) uiResult = r;
            payload = { monthly: r.monthly, ...compactResult(r) };
            break;
          }
          case 'inter_trends': {
            const outcome = await runInterQuery({
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              domain: args.domain ?? null,
              country: args.country ?? null,
              eventType: args.event_type ?? null,
              topicSector: args.topic_sector ?? null,
              portfolioOnly: args.portfolio_only === true,
              company: args.company ?? null,
              limit: 30,
            });
            steps.push(`inter(${outcome.result.terms.join('|') || '전체'}) → ${outcome.result.total}건`);
            if (!uiResult || outcome.result.total > 0) { uiResult = outcome.result; resultKind = 'inter'; }
            payload = compactInter(outcome);
            break;
          }
          case 'pitch_opportunities': {
            const period = resolvePeriodArg(args.period, opts.period, opts.question);
            const scopes = asScopes(args.scopes);
            const minScore = typeof args.min_score === 'number' ? args.min_score : 70;
            const [r, details] = await Promise.all([
              runPitchQuery({ period, scopes, minScore, limit: 30 }),
              pitchDetailsForModel({ period, scopes, minScore }),
            ]);
            // periodLabel은 조회 함수가 비워두므로 여기서 채운다.
            r.periodLabel = PERIOD_LABEL[period];
            steps.push(`pitch(${minScore}점↑) → ${r.total}건`);
            if (!uiResult || r.total > 0) { uiResult = r; resultKind = 'pitch'; }
            payload = {
              total: r.total,
              byTopic: r.topCompanies,
              bySource: r.topSources,
              candidates: details,
              hint: '점수는 수집 때 매긴 피칭 가능성이다. ourTake는 본부 관점 코멘트라 피칭 각도로 그대로 쓸 수 있다.',
            };
            break;
          }
          case 'coverage_gap': {
            const gap = await runCoverageGap({
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              scopes: asScopes(args.scopes),
              tier: args.tier ?? null,
            });
            steps.push(`gap → 무노출 ${gap.silentCount}/${gap.totalTargets}곳`);
            payload = gap;
            break;
          }
          case 'digest_archive': {
            const rows = await runDigestArchive({ limit: args.limit, on: args.on ?? null });
            steps.push(`digest → ${rows.length}건`);
            payload = { digests: rows };
            break;
          }
          case 'noise_report': {
            const r = await runChatQuery({
              question: opts.question,
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              scopes: [],
              terms: [],
              withNoise: true,
              limit: 1,
            });
            noisyKeywords = r.noisyKeywords;
            resultKind = 'noise';
            steps.push(`noise → ${r.noisyKeywords?.length ?? 0}개 키워드`);
            payload = { noisyKeywords: r.noisyKeywords };
            break;
          }
          case 'propose_keyword_fix': {
            const r = await proposeKeywordFix({
              targetName: String(args.target_name ?? ''),
              field: args.field === 'excludeWords' ? 'excludeWords' : 'contextWords',
              addition: String(args.addition ?? ''),
              reason: String(args.reason ?? ''),
              requestedBy: opts.userEmail,
            });
            steps.push(r.ok ? `제안 등록: ${r.targetName} ${r.field} +${r.addition}` : `제안 실패: ${r.error}`);
            payload = r.ok
              ? {
                  ...r,
                  note:
                    '승인 대기 목록에 올렸다. 아직 반영되지 않았다는 점과, 대시보드 > 노이즈 제안에서 ' +
                    '승인해야 적용된다는 점을 사용자에게 반드시 알려라.',
                }
              : r;
            break;
          }
          case 'pending_suggestions': {
            const rows = await listPendingSuggestions(args.limit);
            steps.push(`대기 제안 ${rows.length}건`);
            payload = { pending: rows };
            break;
          }
          case 'data_coverage': {
            payload = await getCoverageSummary();
            steps.push('coverage');
            break;
          }
          case 'live_search': {
            const keyword = String(args.keyword ?? opts.question).trim().slice(0, 60);
            const r = await runLiveSearch(keyword);
            steps.push(`live(${keyword}) → ${r.total}건`);
            if (!uiResult || r.total > 0) { uiResult = r; resultKind = 'live'; }
            payload = compactResult(r);
            break;
          }
          case 'competitor_funds': {
            const competitors = Array.isArray(args.competitors) ? args.competitors.map(String) : [];
            const summaries = await getCompetitorFundSummaries(competitors);
            const fundsByCompetitor = Array.from(summaries.entries()).map(([name, summary]) => ({
              competitor: name,
              investorName: summary.investorName,
              fundCount: summary.fundCount,
              totalAum: summary.totalAum,
              topSectors: summary.topSectors,
              funds: summary.funds.slice(0, 10),
            }));
            steps.push(`경쟁사펀드 → ${fundsByCompetitor.length}곳`);
            payload = { fundsByCompetitor };
            break;
          }
          default:
            payload = { error: `알 수 없는 도구: ${call.function.name}` };
        }
      } catch (e) {
        console.error('[chat-agent] 도구 실행 실패', call.function.name, e);
        payload = { error: '조회에 실패했습니다. 다른 조건으로 시도해 보세요.' };
      }

      // 방금 push된 step 문자열이 "무엇을 얼마나 찾았는지"를 담고 있다 — 그대로 보여준다.
      opts.onProgress?.({
        phase: 'tool_done',
        label: TOOL_LABEL[call.function.name] ?? call.function.name,
        detail: steps[steps.length - 1],
      });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(payload),
      });
    }
  }
  opts.onProgress?.({ phase: 'thinking', label: '답변 정리하는 중' });

  // 상한까지 도구만 부르고 안 끝났다 — 모은 데이터로 마무리하게 한 번 더 부른다(도구 없이).
  const final = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 1600,
    messages: [
      ...messages,
      { role: 'user', content: '더 조회하지 말고, 지금까지 확인한 데이터만으로 답변을 완성해라.' },
    ],
  });

  track(final.usage);
  return finish(final.choices[0]?.message?.content?.trim() || null);
}
