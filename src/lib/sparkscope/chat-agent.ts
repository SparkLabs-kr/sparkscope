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
import {
  runPitchQuery,
  pitchDetailsForModel,
  runCoverageGap,
  runDigestArchive,
  runDigestPreview,
  runCrisisWatch,
  runSavedArticles,
  runMediaAnalysis,
  crisisArticlesForUi,
} from './chat-ops';
import { proposeKeywordFix, listPendingSuggestions } from './chat-actions';
import { runLiveSearch } from './chat-live';
import {
  getCompetitorFundSummaries,
  getSparkLabsFundSummary,
  isFundDbConfigured,
  type CompetitorFundSummary,
} from './fund-db';
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
          date_from: {
            type: 'string',
            description:
              '사용자가 "8월 3일부터", "8/3~8/19"처럼 구체적인 시작·끝 날짜를 직접 말했을 때만 ' +
              'YYYY-MM-DD로 넣어라. 이땐 date_to도 같이 넣고 period는 무시된다(그래도 필수값이라 ' +
              '아무 값이나 채워라). "이번 주", "최근" 같은 상대 표현에는 쓰지 마라 — period로 충분하다.',
          },
          date_to: { type: 'string', description: 'date_from과 짝. YYYY-MM-DD.' },
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
      name: 'crisis_watch',
      description:
        '부정 기사가 몰린 포트폴리오사를 회사 단위로 찾는다. 대시보드 "위기 감지" 카드와 같은 판정이다. ' +
        '"지금 위기인 포폴사 있어?", "요즘 시끄러운 데 없나", "리스크 시그널 잡힌 곳", "터진 데 있어?" 같은 ' +
        '질문에는 search_articles(only_negative)가 아니라 반드시 이걸 써라 — ' +
        'only_negative는 부정 기사를 나열만 할 뿐 "어느 회사에 몇 건 몰렸는지"를 묶어주지 못한다. ' +
        '회사별 부정 기사 건수·원인 요약·대표 기사를 함께 돌려준다. ' +
        '결과가 0건이면 그것도 답이다 — "지금은 조용하다"고 분명히 말해라(억지로 기사를 찾아 나열하지 마라).',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description:
              '며칠치를 볼지. 사용자가 기간을 말했으면 반드시 그에 맞춰 채워라 — ' +
              '"오늘"=1, "이번 주"·"지난주"·"요 며칠"=7, "이번 달"·"최근 한 달"=30, "최근 3개월"=90. ' +
              '기간을 아예 말하지 않았을 때만 비워라(그때 기본 3일 — 대시보드와 같은 기준).',
          },
          threshold: {
            type: 'number',
            description:
              '부정 기사 몇 건부터 위기로 볼지(기본 2건). 0건으로 나왔는데 더 넓게 보고 싶으면 1로 낮춰서 다시 불러라.',
          },
          company: {
            type: 'string',
            description: '특정 회사만 볼 때 그 회사명. 안 주면 전체 포트폴리오사.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'saved_articles',
      description:
        '사용자가 저장해둔 기사를 다시 꺼낸다. "내가 스크랩한 거", "북마크해둔 기사", ' +
        '"저장해둔 거 다시 보여줘", "별표 찍은 기사" 같은 질문에 써라. ' +
        '검색이 아니라 저장 기록 조회다 — search_articles로는 절대 구할 수 없다. ' +
        '스크랩은 본부 공용(누가 찍었든 팀 전체가 같은 목록을 본다)이고 북마크는 개인용이라, ' +
        '둘을 합쳐 답할 때는 성격이 다르다는 걸 짧게 짚어라. 0건이면 note를 그대로 전해라.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['scrap', 'bookmark', 'both'],
            description:
              '사용자가 "스크랩"만 말하면 scrap, "북마크"만 말하면 bookmark, ' +
              '"저장해둔 거"처럼 뭉뚱그리면 both(기본).',
          },
          days: {
            type: 'number',
            description:
              '최근 며칠 안에 저장한 것만 볼지. **사용자가 기간을 말했을 때만 채워라** — ' +
              '저장은 오래된 걸 다시 찾으려는 것이라, 기본은 기간 제한 없이 전체다.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'media_analysis',
      description:
        '어느 매체가 다루고 있고 어디에 아직 안 실렸는지를 본다. ' +
        '"어느 매체가 우리를 제일 많이 다뤄?", "티어1 매체에 얼마나 실렸어?", ' +
        '"아직 안 실린 주요 매체 어디야?", "매체 분포 보여줘" 같은 질문에 써라. ' +
        '기사 검색도 상위 매체 5곳은 주지만 그건 건수 순일 뿐이다 — ' +
        '매체 티어(종합일간지/통신사/스타트업 전문) 비중과 "아직 안 실린 주요 매체"는 이걸로만 나온다. ' +
        'unreachedMajor는 다음 피칭 타깃 후보라는 뜻으로 전해라.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'week', 'month', 'quarter', 'all'],
            description: '집계 기간. 화면에서 고른 기간을 기본으로 쓰되 질문에 기간이 있으면 그쪽을 따른다.',
          },
          scopes: {
            type: 'array',
            items: { type: 'string', enum: ['portfolio', 'competitor', 'sparklabs', 'industry'] },
            description: '집계 범위. 비우면 전체.',
          },
          company: {
            type: 'string',
            description: '특정 회사의 매체 분포만 볼 때 그 회사명. 안 주면 범위 전체.',
          },
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
      name: 'digest_preview',
      description:
        '다이제스트를 실제 발송 메일과 똑같은 레이아웃으로 화면에 그린다. ' +
        '"다이제스트 초안 만들어줘", "이번 주 다이제스트 뽑아줘", "지난주에 나간 메일 보여줘"처럼 ' +
        '다이제스트 자체를 보고 싶어하는 질문에만 써라. ' +
        '★ 그냥 기사를 정리해 달라는 질문(예: "이번 주 투자유치 기사 정리해줘")에는 쓰지 마라 — ' +
        'search_articles로 답할 것을 메일 형태로 내놓으면 오히려 읽기 나쁘다. ' +
        '★ 이 도구를 쓰면 기사 목록이 화면에 이미 그려지므로, 답변에서 기사 제목을 다시 나열하지 마라.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['archive', 'draft'],
            description:
              'archive=이미 발송된 실제 메일을 그대로 보여준다("지난주 메일 보여줘"). ' +
              'draft=지금 데이터로 새 초안을 만든다("초안 만들어줘"). 애매하면 draft.',
          },
          on: { type: 'string', description: 'archive에서 특정 날짜(YYYY-MM-DD). 없으면 가장 최근 발송본' },
          intro: {
            type: 'string',
            description:
              'draft일 때 맨 위에 들어갈 편집자 한 줄(1~2문장). 이번 기간을 한마디로 요약하는 문장을 네가 직접 써라.',
          },
        },
        required: ['source'],
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
      name: 'fund_info',
      description:
        '펀드 자체의 정보를 조회한다 — 우리(스파크랩)와 경쟁사(VC) 둘 다. 펀드 개수·조성연도·만기, ' +
        '경쟁사는 운용자산(AUM)과 주요 투자 섹터까지 돌려준다. ' +
        '"우리 펀드 몇 개야?", "스파크랩 만기 다가오는 펀드 있어?", "카카오벤처스 펀드 규모가 얼마야?", ' +
        '"우리랑 경쟁사 펀드 비교해줘" 같은 질문에 써라. ' +
        '★ 우리(스파크랩) 펀드에는 AUM(운용자산) 데이터가 없다 — 별도 테이블이라 금액이 안 들어있다. ' +
        'totalAum이 0으로 와도 "운용자산 0원"이 아니라 "이 데이터엔 금액이 없다"는 뜻이니, ' +
        '금액을 0이라고 말하거나 경쟁사 AUM과 숫자로 비교하지 마라. 우리 쪽은 펀드 개수·조성연도·만기로만 말해라. ' +
        '★ 이 데이터에는 각 펀드가 실제로 투자한 개별 회사(포트폴리오사) 명단이 없다 — 펀드 그릇의 크기·개수·섹터까지만 안다. ' +
        '"OO벤처스가 어디에 투자했어?"처럼 투자처를 물으면 이 도구로는 답할 수 없다는 걸 요약에 분명히 밝혀라 ' +
        '("다시 물어보면 확인해드릴게요"처럼 있는 것처럼 말하지 마라).',
      parameters: {
        type: 'object',
        properties: {
          competitors: {
            type: 'array',
            items: { type: 'string' },
            description:
              '조회할 경쟁사(VC) 이름 배열. 예: ["카카오벤처스", "미래에셋벤처투자"]. 감시 대상에 등록된 경쟁사명으로. ' +
              '우리 펀드만 궁금하면 빈 배열로 두고 include_sparklabs만 true로 해라.',
          },
          include_sparklabs: {
            type: 'boolean',
            description:
              '우리(스파크랩) 펀드도 같이 볼지. "우리", "자사", "스파크랩" 펀드를 물었거나 ' +
              '경쟁사와 비교해달라고 하면 true.',
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
4) 발송된 다이제스트 기록 — digest_archive. 날짜·제목·수신자 수만 볼 때.
4-0) 다이제스트 화면 — digest_preview. "다이제스트를 보여줘/만들어줘"처럼 다이제스트
   자체가 목적인 질문은 이걸 써라. 실제 메일과 같은 레이아웃이 화면에 그려진다.
   ★ 쓰고 나면 기사 제목·매체·날짜를 답변에 다시 적지 마라. 화면에 이미 다 있고,
     같은 내용을 두 번 쓰는 꼴이다. 무엇을 골랐는지·눈에 띄는 점만 짧게 써라.
   ★ 그냥 기사 정리 요청("이번 주 투자유치 기사 정리해줘")에는 쓰지 마라.
4-1) 위기 감지 — crisis_watch. 부정 기사가 한 회사에 몰렸는지를 회사 단위로 묶어서 본다
   (대시보드 "위기 감지" 카드와 같은 판정: 기본 최근 3일·부정 2건 이상).
   기사 목록이 아니라 "어느 회사가 지금 문제인가"가 궁금한 질문은 전부 이걸로 답해라.
4-2) 저장한 기사 — saved_articles. "내가 스크랩한 거", "북마크해둔 기사", "저장해둔 거
   다시 보여줘"는 검색이 아니라 저장 기록 조회다. search_articles로 비슷한 기사를 찾아
   내놓지 마라 — 사용자가 직접 찍어둔 그 기사가 아니면 답이 아니다.
   ★ 스크랩은 본부 공용(팀 전체가 같은 목록)이고 북마크는 개인용이다. 둘을 합쳐 답할 때는
   이 차이를 한 줄로 짚어라. 기간은 사용자가 말했을 때만 걸어라(기본은 전체 기간).
4-3) 매체 분석 — media_analysis. "어느 매체가 많이 다뤄?", "티어1에 얼마나 실렸어?",
   "아직 안 실린 매체 어디야?"는 이걸로 답해라. 기사 검색의 상위 매체 5곳은 건수 순일
   뿐이라 티어 비중과 "안 실린 곳"을 답하지 못한다.
   ★ unreachedMajor(티어1·2 중 이 기간 노출 0)는 "다음에 뚫을 후보"라는 뜻이다. 그냥
   이름만 나열하지 말고 그렇게 설명해라.
5) 펀드 정보 — 우리(스파크랩)와 경쟁사(VC) 둘 다. fund_info로 조회한다.
   "우리 펀드 몇 개야?", "만기 다가오는 펀드 있어?", "카카오벤처스 펀드 규모가 얼마야?",
   "우리랑 경쟁사 비교해줘" 같은 질문에 써라(우리 것도 보려면 include_sparklabs=true).
   ★ 우리 펀드에는 운용자산(AUM) 금액이 아예 없다(다른 테이블이라 금액 칸이 없음). 0으로 오더라도
   "운용자산 0원"이라고 말하거나 경쟁사 AUM과 숫자로 비교하지 마라 — 우리 쪽은 펀드 개수·조성연도·
   만기로만 말하고, 금액 비교를 요청받으면 "우리 펀드는 금액 데이터가 없어 비교가 안 된다"고 밝혀라.
   ★ 이 데이터엔 각 펀드가 실제로 투자한 개별 회사(포트폴리오사) 명단이 없다. "OO벤처스가 어디에
   투자했어?"처럼 투자처를 물으면 fund_info로도 답이 안 나온다는 걸 그대로 알려라 —
   "개별 투자사가 필요하면 다시 물어보세요"처럼 있는 것처럼 안내하지 마라.

[화면에서 고른 값]
기간 ${PERIOD_LABEL[uiPeriod]} / 범위 ${uiScopes.length ? uiScopes.map((s) => SCOPE_LABEL[s]).join(', ') : '전체'}
이 값을 함부로 바꾸지 마라. 사용자가 직접 고른 것이다.
질문에 "지난주", "어제", "올해", "이번 달"처럼 기간이 명시됐을 때만 바꿔라.
"요즘", "최근", "요새"처럼 모호한 말은 기간 표현이 아니다 — 화면 값을 그대로 써라.
★ "8월 3일부터 19일까지", "8/3~8/19"처럼 구체적인 시작·끝 날짜를 직접 말했으면 period로는
표현이 안 된다(오늘/이번주/최근1개월/최근3개월/전체 다섯 구간뿐) — search_articles의
date_from·date_to에 YYYY-MM-DD로 각각 넣어라. 이때도 period는 필수값이라 아무 값이나
채우면 되고, date_from·date_to가 있으면 그쪽이 우선한다.
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
- ★ 회사명이나 감시 대상이 명시되면 무조건 terms에 포함해라. 범위와 별개다. 예를 들어
  사용자가 "스파크랩 기사"라고 물으면, 범위에 sparklabs가 있어도 terms에도 "스파크랩"을
  넣어야 한다. 그래야 0건일 때 "실시간 검색할까요?"가 뜬다. 범위만으로 조회하면 terms가
  비어서 실시간 검색을 못 제안한다.
- 검색어가 감시 대상 이름 자체였는데 0건이면(예: "온도"), 그건 오류가 아니라 "이 회사는
  최근 보도가 없다"는 실제 정보다. 이 경우엔 아래 "0건이면 비워서 넓혀라" 규칙을 따르지
  마라 — terms를 비우면 전혀 무관한 회사 기사들이 섞여 들어와 "이게 왜 나오지" 싶은 답이
  된다. 0건 그대로 답하고, matchedEntities에 실린 portfolioStatus가 'Live'가 아니면
  (Exit·Written-off) 그 상태를 먼저 알려라(예: "이 포트폴리오사는 현재 Written-off(청산)
  상태예요").
  ★ "오늘", "방금", "최신"처럼 신선도를 묻는 질문은 이야기가 다르다 — 우리 수집은
  하루 한 번(보통 오전)만 돌아서, "오늘 0건"은 "그 회사 소식이 없다"가 아니라 "오늘
  수집 이후에 나온 기사를 우리가 아직 못 받았다"일 가능성이 크다. 이런 질문엔 terms가
  있으면 live_search를 직접 불러서 실제로 오늘 나온 기사가 있는지 확인한 뒤 답해라.
- (그 외) 첫 검색이 0건이거나 눈에 띄게 적으면 그대로 "없다"고 하지 마라.
  이때 가장 먼저 할 일은 검색어를 다른 단어로 바꾸는 게 아니라 아예 비우는 것이다.
  terms를 빼고 기간·범위·톤만으로 조회하면 무엇이 있는지 실제로 보인다. 그 다음에 좁혀라.
  그래도 없으면 semantic_search로 뜻을 서술해서 찾아보고, 기간을 넓히거나 범위를 풀어라.
- 질문이 "해외 나가는 데", "새로 뭐 시작한 곳"처럼 주제를 상황으로 물어서 딱 떨어지는
  검색어를 못 고르겠으면, 처음부터 semantic_search를 써라. 그게 이 도구의 용도다.
- ★ "지금 위기인 데 있어?", "요즘 시끄러운 데 없나", "리스크 잡힌 곳", "터진 데 있어?"처럼
  어느 회사가 문제인지를 묻는 질문은 crisis_watch를 써라. only_negative로 기사만 나열하면
  "어느 회사에 몇 건 몰렸는지"가 안 보여서 질문에 답이 안 된다. crisis_watch가 0곳으로
  나오면 "지금은 조용하다"고 그대로 답해라 — 억지로 부정 기사를 긁어와 나열하지 마라.
- 그 밖에 좋다/나쁘다 톤으로 기사 목록 자체를 원하는 질문("부정 기사만 보여줘",
  "잘나가는 데")은 톤 필터가 답이다. only_negative=true(또는 긍정)로 조회해라.
  검색어나 meaning에 "논란", "안 좋은" 같은 말을 넣는 게 아니다.
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
  최근 기사 건수·매체·톤을 확인하고, 대상이 경쟁사(VC)면 fund_info도 같이 불러서
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
  그러니 이 줄 앞뒤로 설명을 붙이지 말고, 답변 본문 안에서 언급하지도 마라.

[리포트 제목]
- 후속 질문 줄 다음, 완전히 새 줄에 "###TITLE###"로 시작하는 줄을 하나 더 추가해라.
  그 뒤에 이 답변을 리포트로 저장했을 때 쓸 제목을 한 줄로 적어라(공백 포함 40자 이내).
  예) ###TITLE### 스파크클로 부트캠프 개시와 경쟁사 대형기관 리스크 이슈
- 사용자가 친 질문을 그대로 옮기지 마라("싹다 찾아서 정리해줘봐" 같은 말투는 제목이 아니다).
  무엇을 조회했고 무엇이 나왔는지를 요약한, 보고서 표지에 올려도 되는 명사형 제목으로 써라.
- 기간·건수는 시스템이 따로 붙이니 제목에 넣지 마라. 마침표로 끝내지 마라.
- 이 줄도 화면에 문장으로 보여주지 않는다. 앞뒤로 설명을 붙이지 마라.`;
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
  /** 다이제스트 메일 레이아웃 HTML — digest_preview를 썼을 때만. 화면 전용(모델에는 안 준다). */
  digestHtml: string | null;
  /** 답변에 이어 물어볼 만한 후속 질문 2~3개. 모델이 summary 끝에 붙인 마커를 파싱한 것. */
  followUps: string[] | null;
  /** HTML 리포트로 저장할 때 쓸 제목. 이것도 summary 끝 마커에서 파싱한다. */
  title: string | null;
  /** 어떤 조회를 몇 번 했는지 — 로그·디버깅용 */
  steps: string[];
  /** 이번 질문에 쓴 토큰. 도구를 여러 번 부르면 왕복마다 쌓이므로 눈에 보이게 남긴다. */
  usage: { calls: number; inputTokens: number; cachedTokens: number; outputTokens: number };
};

// 한자(CJK 통합 한자, U+4E00~U+9FFF) — 후속 질문은 순한글 문장이어야 하는데, 모델이 드물게
// 글자를 잘못 생성해 "관련" 대신 "관寺"처럼 한자가 섞여 나올 때가 있다(2026-08-12 실사용 발견).
// 정상적인 한국어 UI 문구엔 한자가 나올 이유가 없으므로, 섞여 있으면 그 버튼만 버린다.
const HANJA_RE = /[一-鿿]/;

/**
 * summary 끝에 붙은 시스템 마커 줄들을 떼어낸다.
 *   ###FOLLOWUPS### 질문1 | 질문2   → 후속 질문 버튼
 *   ###TITLE### 리포트 제목          → HTML 저장 시 제목
 * 마커가 없으면 그대로 둔다(옛 대화·모델이 빼먹은 경우 모두 정상 동작해야 한다).
 *
 * TITLE을 FOLLOWUPS보다 먼저 떼는 이유: TITLE이 뒷줄이라 먼저 잘라내야
 * FOLLOWUPS 정규식의 "$"(문자열 끝) 앵커가 맞는다.
 */
function splitMarkers(raw: string | null): {
  summary: string | null;
  followUps: string[] | null;
  title: string | null;
} {
  if (!raw) return { summary: raw, followUps: null, title: null };

  let rest = raw;
  let title: string | null = null;
  const titleRe = /\n?###TITLE###\s*(.+?)\s*$/;
  const tm = rest.match(titleRe);
  if (tm) {
    const t = tm[1].trim().replace(/[.。]+$/, '');
    // 한자가 섞였거나 비정상적으로 길면 제목으로 쓰지 않는다(호출부가 알아서 대체).
    if (t && !HANJA_RE.test(t) && t.length <= 60) title = t;
    rest = rest.replace(titleRe, '');
  }

  const re = /\n?###FOLLOWUPS###\s*(.+)\s*$/;
  const m = rest.match(re);
  if (!m) return { summary: rest.trim() || null, followUps: null, title };
  const followUps = m[1]
    .split('|')
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && !HANJA_RE.test(q))
    .slice(0, 3);
  return {
    summary: rest.replace(re, '').trim() || null,
    followUps: followUps.length ? followUps : null,
    title,
  };
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
  crisis_watch: '위기 감지 (회사별 부정 기사)',
  saved_articles: '저장한 기사 확인',
  media_analysis: '매체 분포 분석',
  coverage_gap: '노출 사각지대 확인',
  digest_archive: '다이제스트 기록 확인',
  digest_preview: '다이제스트 화면 구성',
  monthly_trend: '월별 추이 집계',
  noise_report: '오탐 키워드 점검',
  data_coverage: '데이터 현황 확인',
  propose_keyword_fix: '설정 보완 제안 등록',
  pending_suggestions: '대기 중인 제안 확인',
  live_search: '실시간 뉴스 검색',
  fund_info: '펀드 정보 조회',
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
  // 다이제스트 레이아웃 HTML — 모델에는 안 주고 화면에만 내려보낸다(runDigestPreview 참고).
  let digestHtml: string | null = null;

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
    // 결과가 8건 미만이면 실시간 검색 제안 (terms가 비어있어도, 원래 question을 검색어로 사용)
    if (result && result.total < 8 && resultKind !== 'live' && resultKind !== 'noise' && resultKind !== 'inter') {
      result.needsLiveSearch = true;
    }

    const { summary, followUps, title } = splitMarkers(raw);
    return {
      summary,
      result,
      resultKind,
      digestHtml,
      followUps,
      title,
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
            const period = resolvePeriodArg(args.period, opts.period, opts.question);
            const dateFrom = typeof args.date_from === 'string' ? args.date_from : undefined;
            const dateTo = typeof args.date_to === 'string' ? args.date_to : undefined;
            const r = await runChatQuery({
              question: opts.question,
              period,
              scopes: asScopes(args.scopes),
              terms,
              onlyNegative: args.only_negative === true,
              dateFrom,
              dateTo,
              limit: 30,
            });
            steps.push(`search(${terms.join('|') || '전체'}) → ${r.total}건${dateFrom ? ` [${dateFrom}~${dateTo ?? ''}]` : ''}`);
            if (!uiResult || r.total > 0) { uiResult = r; resultKind = 'search'; }

            // "오늘" 기간에 0건이고 검색어가 있으면 실시간 검색 자동 시도.
            // 단 date_from/date_to로 조회했으면 period는 무시된 값이라(모델이 필수값이라
            // 아무거나 채운다) 여기 걸리면 안 된다 — "8/3~8/19" 질문에 오늘 기사를
            // 실시간 검색해서 답하는 꼴이 된다.
            if (r.total === 0 && period === 'today' && terms.length > 0 && !dateFrom && !dateTo) {
              const liveResult = await runLiveSearch(terms[0]);
              steps.push(`→ live(${terms[0]}) → ${liveResult.total}건`);
              if (liveResult.total > 0) { uiResult = liveResult; resultKind = 'live'; }
              else { payload = { ...compactResult(r), liveSearchAttempted: true }; break; }
              payload = compactResult(liveResult);
              break;
            }

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
          case 'crisis_watch': {
            const cw = {
              days: typeof args.days === 'number' ? args.days : undefined,
              threshold: typeof args.threshold === 'number' ? args.threshold : undefined,
              company: typeof args.company === 'string' ? args.company : null,
            };
            // 회사별 판정(모델에게 줄 것)과 화면 카드용 기사 목록을 같이 만든다.
            const [watch, uiRows] = await Promise.all([runCrisisWatch(cw), crisisArticlesForUi(cw)]);
            steps.push(`위기감지(최근 ${watch.windowDays}일) → ${watch.crisisCount}곳`);
            // 0건이면 화면 카드를 덮어쓰지 않는다 — 빈 카드로 갈아치우면 앞선 조회 결과가
            // 사라져서 "아무것도 못 찾았다"처럼 보인다.
            if (watch.crisisCount > 0) { uiResult = uiRows; resultKind = 'search'; }
            payload = watch;
            break;
          }
          case 'saved_articles': {
            const saved = await runSavedArticles({
              kind: args.kind === 'scrap' || args.kind === 'bookmark' ? args.kind : 'both',
              userEmail: opts.userEmail,
              days: typeof args.days === 'number' ? args.days : null,
            });
            steps.push(
              `저장 기사 → 스크랩 ${saved.scrapCount}건 · 북마크 ${saved.bookmarkCount}건`
            );
            // 위기감지와 같은 이유로 0건이면 화면 카드를 덮어쓰지 않는다.
            if (saved.result.total > 0) { uiResult = saved.result; resultKind = 'search'; }
            payload = {
              kind: saved.kind,
              scrapCount: saved.scrapCount,
              bookmarkCount: saved.bookmarkCount,
              total: saved.result.total,
              periodLabel: saved.periodLabel,
              ...(saved.note ? { note: saved.note } : {}),
              articles: saved.result.articles.slice(0, 30).map((a) => ({
                title: a.title,
                source: a.source,
                pubDate: a.pubDate.slice(0, 10),
                company: a.matchedKeyword,
                tone: a.tone,
                oneLiner: a.oneLiner,
              })),
            };
            break;
          }
          case 'media_analysis': {
            const ma = await runMediaAnalysis({
              period: resolvePeriodArg(args.period, opts.period, opts.question),
              scopes: asScopes(args.scopes),
              company: typeof args.company === 'string' ? args.company : null,
            });
            steps.push(`매체 분석(${ma.periodLabel}) → ${ma.total}건 · 미노출 주요매체 ${ma.unreachedMajor.length}곳`);
            payload = ma;
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
          case 'digest_preview': {
            const source = args.source === 'archive' ? 'archive' : 'draft';
            const r = await runDigestPreview({
              source,
              on: typeof args.on === 'string' ? args.on : null,
              intro: typeof args.intro === 'string' ? args.intro : null,
            });
            steps.push(`digest_preview(${source}) → ${r.html ? '레이아웃 생성' : '없음'}`);
            // html은 화면으로만 내려보낸다. payload(=모델 컨텍스트)에는 절대 넣지 않는다.
            if (r.html) digestHtml = r.html;
            payload = r.meta;
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
          case 'fund_info': {
            const competitors: string[] = Array.isArray(args.competitors) ? args.competitors.map(String) : [];
            // 자사 펀드는 대시보드 스파크랩 탭이 쓰는 것과 같은 함수를 그대로 쓴다 —
            // 화면과 챗봇이 다른 숫자를 말하면 안 된다.
            const wantSparkLabs = args.include_sparklabs === true;
            const [summaries, sparkLabs] = await Promise.all([
              competitors.length
                ? getCompetitorFundSummaries(competitors)
                : Promise.resolve(new Map<string, CompetitorFundSummary>()),
              wantSparkLabs ? getSparkLabsFundSummary() : null,
            ]);
            const fundsByCompetitor = Array.from(summaries.entries()).map(([name, summary]) => ({
              competitor: name,
              investorName: summary.investorName,
              fundCount: summary.fundCount,
              // 키 이름에 단위를 박는다 — 그냥 totalAum으로 주면 모델이 "총 운용자산 4043"처럼
              // 단위 없는 숫자를 그대로 뱉는다(2026-08-19 실제 사례).
              totalAumEokWon: summary.totalAum,
              topSectors: summary.topSectors,
              funds: summary.funds.slice(0, 10).map((f) => ({
                name: f.name,
                vintage: f.vintage,
                aumEokWon: f.aum,
                maturityDate: f.maturityDate,
              })),
            }));
            // 펀드 DB에 매핑이 없는 곳은 조용히 빠지면 모델이 "펀드가 없다"로 오해한다.
            // 조회 자체를 못 했다는 사실을 명시적으로 넘긴다.
            const unavailable = competitors.filter((c) => !summaries.has(c));
            steps.push(
              `펀드조회 → ${wantSparkLabs ? '스파크랩' : ''}${wantSparkLabs && fundsByCompetitor.length ? '+' : ''}${fundsByCompetitor.length ? `경쟁사 ${fundsByCompetitor.length}곳` : ''}`
            );
            payload = {
              ...(sparkLabs
                ? {
                    sparklabs: {
                      fundCount: sparkLabs.fundCount,
                      latestVintage: sparkLabs.latestVintage,
                      // aum 필드 자체를 빼서 넘긴다. 0을 보여주고 "0으로 읽지 마라"고
                      // 당부하는 것보다, 아예 안 보이는 게 확실하다.
                      funds: sparkLabs.funds.slice(0, 15).map((f) => ({
                        name: f.name,
                        vintage: f.vintage,
                        maturityDate: f.maturityDate,
                      })),
                      // 금액이 0으로 오는 걸 "규모 0원"으로 오해하지 않도록 못을 박는다.
                      aumNote:
                        '우리 펀드 데이터에는 운용자산(AUM) 금액이 없다. 금액을 0이라고 말하거나 경쟁사 AUM과 숫자로 비교하지 마라.',
                    },
                  }
                : {}),
              ...(fundsByCompetitor.length ? { fundsByCompetitor, aumUnitNote: 'AUM 숫자의 단위는 억원이다. 답할 때 반드시 "억원"을 붙여라.' } : {}),
              ...(unavailable.length
                ? {
                    unavailableCompetitors: unavailable,
                    unavailableNote: isFundDbConfigured()
                      ? `${unavailable.join(', ')}는 우리 펀드 DB(국내 VC 공시 기준)에 없어 조회 자체가 안 된다. ` +
                        '"펀드가 없다"가 아니라 "이 DB에서는 확인할 수 없다"고 답해라.'
                      : '펀드 DB 연결이 없어 경쟁사 펀드를 하나도 조회하지 못했다. 펀드 정보는 모른다고 답해라.',
                  }
                : {}),
              ...(wantSparkLabs && !sparkLabs
                ? { sparklabsError: '자사 펀드 데이터를 불러오지 못했다(펀드 DB 연결 없음). 모른다고 답해라.' }
                : {}),
            };
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
