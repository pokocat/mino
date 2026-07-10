// MOCK_API=true 时的内置假数据。
// 键 = `METHOD /path`；返回值模拟后端约定结构（camelCase），带轻微延迟模拟网络。

import type {
  ChatMessage,
  Conversation,
  CreateConversationResult,
  DailyTask,
  GenerateReportResult,
  ReportDetail,
  ReportListItem,
  ReportListResult,
  ReportStats,
  ReportType,
  StartTaskResult,
  TaskStatus,
  UserProfile,
  WxLoginResult,
} from './api';

// MOCK 军师开场白（真实模式由服务端历史消息返回；此处内置以走通首次进入路径）
const MOCK_OPENING =
  '昨天你说想砍掉那条副线。今天先别急——你手里哪张牌最硬？咱们聊透了我记进你的档案，往后越聊我越懂你。';

// ---------------- 报告 mock 库 ----------------

// 战略分析全文（受限规范：## 小节 / 有序列表 / 段落 / **粗体**）
const BODY_STRATEGY = [
  '## 主要矛盾',
  '你想扩张，但你真正的家底——客户信任——是慢功夫攒出来的，快不得。**扩张的速度 vs 信任的沉淀速度**，这是当前最主要的矛盾。',
  '',
  '## 定位',
  '不做「更多」，做「更被信任」。你的根据地是老客户的口碑，别人拿钱砸半年也砸不动。',
  '',
  '## 三步走',
  '1. **守。**先把现有老客户的复购和转介绍做到极致，别分心。',
  '2. **攒。**把「凭什么被信任」拆成可复制的动作，写成手册。',
  '3. **扩。**手册跑通后再开第二家，让信任可迁移，而非从零再来。',
].join('\n');

// 创业履历全文（自传体：段落 + 首段首字下沉「二」）
const BODY_RESUME = [
  '二〇一七年冬天，牧之在一家国企干到第七个年头，忽然觉得日子像一潭静水。',
  '',
  '他辞职那天没跟任何人商量。不是冲动——是攒了太久的一口气。他想验证一件事：离开体系的庇护，自己那点本事还值不值钱。',
  '',
  '头半年很苦。可他发现，真正让客户留下来的，从来不是价格，是那种「交给他放心」的踏实感。这后来成了他整盘生意的底色。',
].join('\n');

const BODY_REVIEW = [
  '## 这周砍了什么',
  '砍掉了拖了两个月的副线业务。它一直在偷走你的注意力，却始终不赚钱。**砍掉不是失败，是把火力收回主战场。**',
  '',
  '## 收获',
  '主线的转化明显回升。你验证了一件事：聚焦本身就是一种战斗力。',
  '',
  '## 下一步',
  '1. 守住主线的节奏，别急着补新坑。',
  '2. 把这两个月的教训写进决策清单，下次少走弯路。',
].join('\n');

const BODY_DECISION = [
  '## 决定',
  '暂缓拓展第二家门店，先把第一家的模型跑透。',
  '',
  '## 为什么',
  '现在开第二家，是把没验证的东西复制一遍。**先把「凭什么成」说清楚，再谈复制。**',
  '',
  '## 待验证',
  '1. 第一家的复购率能否稳定在目标线以上。',
  '2. 核心动作是否已经不依赖你本人。',
].join('\n');

// 详情库（id → ReportDetail）
const REPORT_DETAILS: Record<string, ReportDetail> = {
  'r-huchenghe': {
    id: 'r-huchenghe',
    type: 'strategy',
    status: 'ready',
    title: '你的护城河：把信任做成根据地',
    bodyMd: BODY_STRATEGY,
    annotation: '「别急着摊大。风来了先把帆张稳，扩张是水到渠成的事。」',
    origin: 'agent',
    isRead: false,
    wordCount: 900,
    sequenceNo: null,
    meta: { kbSynced: true },
    createdAt: daysAgo(0, '14:32'),
    sources: [{ conversationId: 'c-cards', title: '最值钱的牌' }],
  },
  'r-qishi': {
    id: 'r-qishi',
    type: 'resume',
    status: 'ready',
    title: '起势：我为什么下海',
    bodyMd: BODY_RESUME,
    annotation: '「你说是赌一口气，其实是你早就看清了自己的牌。下海不是冲动，是时势到了。」',
    origin: 'user',
    isRead: true,
    wordCount: 1200,
    sequenceNo: 1,
    meta: { kbSynced: true },
    createdAt: daysAgo(20),
    sources: [
      { conversationId: 'c-620', title: '6/20 对话' },
      { conversationId: 'c-cut', title: '副线取舍' },
      { conversationId: 'c-first', title: '第一桶金' },
    ],
  },
  'r-fupan': {
    id: 'r-fupan',
    type: 'review',
    status: 'ready',
    title: '第 6 周复盘：砍掉副线之后',
    bodyMd: BODY_REVIEW,
    annotation: '「砍得干脆，是因为你终于分得清主次了。这就是长进。」',
    origin: 'agent',
    isRead: true,
    wordCount: 700,
    sequenceNo: null,
    meta: { kbSynced: true },
    createdAt: daysAgo(22),
    sources: [{ conversationId: 'c-week6', title: '第 6 周复盘' }],
  },
  'r-juece': {
    id: 'r-juece',
    type: 'decision',
    status: 'ready',
    title: '决定：暂缓拓第二家门店',
    bodyMd: BODY_DECISION,
    annotation: '「慢一步不是怕，是先把地基夯实。稳了再快，才快得住。」',
    origin: 'user',
    isRead: true,
    wordCount: 400,
    sequenceNo: null,
    meta: { kbSynced: false, verifyStatus: 'pending' },
    createdAt: daysAgo(25),
    sources: [{ conversationId: 'c-store2', title: '第二家门店' }],
  },
  'r-huchenghe-2': {
    id: 'r-huchenghe-2',
    type: 'strategy',
    status: 'ready',
    title: '你的定价：别再用成本记账',
    bodyMd: BODY_STRATEGY,
    annotation: '「定价是你对自己价值的判断，别让成本表替你说话。」',
    origin: 'user',
    isRead: true,
    wordCount: 800,
    sequenceNo: null,
    meta: { kbSynced: true },
    createdAt: daysAgo(28),
    sources: [{ conversationId: 'c-price', title: '定价这件事' }],
  },
  // 列表内的「生成中」占位卡（不可点，GET 详情恒为 generating）
  'r-generating': {
    id: 'r-generating',
    type: 'strategy',
    status: 'generating',
    title: '军师正在执笔…',
    bodyMd: '',
    annotation: '',
    origin: 'agent',
    isRead: true,
    wordCount: 0,
    sequenceNo: null,
    meta: {},
    createdAt: daysAgo(0, '15:10'),
    sources: [],
  },
};

// 列表展示顺序（新未读卡与生成中卡靠前，便于走查）
const REPORT_ORDER = [
  'r-huchenghe',
  'r-generating',
  'r-qishi',
  'r-fupan',
  'r-juece',
  'r-huchenghe-2',
];

// 详情 → 列表项（列表页不需要 bodyMd/annotation 等重字段）
function toListItem(d: ReportDetail): ReportListItem {
  const summaryMap: Record<string, string> = {
    'r-huchenghe': '主要矛盾 · 定位 · 三步走。基于今天关于「最值钱的牌」的对话。',
    'r-generating': '正在把刚才的对话整理成一份《战略分析》报告。',
    'r-qishi': '离开体系那年冬天，你赌上的其实是自己早已看清的一张牌。',
    'r-fupan': '砍掉副线之后，主线的战斗力反而回来了。',
    'r-juece': '先把第一家的模型跑透，再谈第二家。',
    'r-huchenghe-2': '别再用成本记账——定价是你对自己价值的判断。',
  };
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    title: d.title,
    summary: summaryMap[d.id] || '',
    origin: d.origin,
    isRead: d.isRead,
    wordCount: d.wordCount,
    createdAt: d.createdAt,
  };
}

// 报告计数（仅统计 ready；与 /me reportStats 对齐）
function reportStats(): ReportStats {
  const ready = REPORT_ORDER.map((id) => REPORT_DETAILS[id]).filter((d) => d.status === 'ready');
  const byType = { strategy: 0, resume: 0, review: 0, decision: 0 };
  let unread = 0;
  ready.forEach((d) => {
    byType[d.type] += 1;
    if (!d.isRead) unread += 1;
  });
  return { total: ready.length, byType, unread };
}

// 生成中报告的完成时点（reportId → 到期毫秒），到期后 GET 详情翻转为 ready
const genDeadline: Record<string, number> = {};
const GEN_MS = 5000; // 约 5s（弹层每 2s 轮询，2~3 次后 ready）

// ---------------- 今日一问 mock（走查整条动线用）----------------

const DAILY_TASK_ID = 'task-today-1';
const DAILY_CONV_ID = 'mock-conv-daily';
// 任务态：初次 pending；start 后翻为 started，再次进入卡片显示「继续聊 →」。
let dailyTaskStatus: TaskStatus = 'pending';

// GET /tasks/today（设计稿那条「最值钱的牌」，estMinutes=3）
function mockDailyTask(): DailyTask {
  return {
    id: DAILY_TASK_ID,
    question: '今天想通一件事：你最值钱的一张牌是什么？',
    hint: '聊透了，我给你写进《战略分析》。',
    estMinutes: 3,
    status: dailyTaskStatus,
  };
}

// ---------------- 用户 mock ----------------

// 全 0 stats 的默认用户；profile 提交时用入参覆盖对应字段。
function mockUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: 'mock-user-1',
    nickname: '',
    avatarUrl: '',
    industry: '',
    bizNote: '',
    streakDays: 47,
    reportStats: reportStats(),
    ...overrides,
  };
}

// 相对今天的日期串（ISO）；hhmm 指定时刻，默认 09:00
function daysAgo(n: number, hhmm = '09:00'): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// 依据 method+url 返回 mock 数据；未命中返回空对象。
export function resolveMock<T>(
  method: string,
  url: string,
  data?: Record<string, unknown>
): Promise<T> {
  const path = url.split('?')[0]; // 去掉 query
  const query = url.split('?')[1] || '';
  const M = method.toUpperCase();
  const key = `${M} ${path}`;
  let payload: unknown = {};

  // 先处理带路径参数的路由（正则）
  const msgMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
  const reportReadMatch = path.match(/^\/reports\/([^/]+)\/read$/);
  const reportChatMatch = path.match(/^\/reports\/([^/]+)\/chat$/);
  const reportIdMatch = path.match(/^\/reports\/([^/]+)$/);
  const taskStartMatch = path.match(/^\/tasks\/([^/]+)\/start$/);

  if (M === 'POST' && taskStartMatch) {
    // 开始聊：任务翻 started（幂等），返回今日一问专属会话 id（其历史首条为军师开场提问）
    dailyTaskStatus = 'started';
    payload = { conversationId: DAILY_CONV_ID } as StartTaskResult;
  } else if (M === 'GET' && msgMatch) {
    // 历史消息：给一条军师开场白（首次进入即续聊此开场）
    payload = [
      {
        id: 'mock-msg-opening',
        role: 'assistant',
        content: MOCK_OPENING,
        createdAt: new Date().toISOString(),
      },
    ] as ChatMessage[];
  } else if (M === 'POST' && path === '/reports/generate') {
    // 受理生成：登记到期时点，返回 generating
    const reportId = `r-gen-${Date.now()}`;
    genDeadline[reportId] = Date.now() + GEN_MS;
    payload = { reportId, status: 'generating' } as GenerateReportResult;
  } else if (M === 'GET' && path === '/reports/stats') {
    payload = reportStats() as ReportStats;
  } else if (M === 'GET' && path === '/reports') {
    payload = mockReportList(query);
  } else if (M === 'POST' && reportReadMatch) {
    // 标记已读：翻转固定库中的 isRead（走查未读态消除用）
    const d = REPORT_DETAILS[reportReadMatch[1]];
    if (d) d.isRead = true;
    payload = { ok: true };
  } else if (M === 'POST' && reportChatMatch) {
    payload = { conversationId: `mock-conv-from-report-${Date.now()}` };
  } else if (M === 'GET' && reportIdMatch) {
    payload = mockReportDetail(reportIdMatch[1]);
  } else {
    switch (key) {
      case 'POST /auth/wx-login':
        // 首次登录：isNewUser=true → 走入局表单
        payload = { token: 'mock-token', isNewUser: true } as WxLoginResult;
        break;
      case 'POST /me/profile':
        payload = mockUser({
          nickname: (data?.nickname as string) || '',
          industry: (data?.industry as string) || '',
          bizNote: (data?.bizNote as string) || '',
        });
        break;
      case 'GET /me':
        payload = mockUser();
        break;
      case 'GET /tasks/today':
        // 今日一问：设计稿「最值钱的牌」，status 随 start 动线变化
        payload = mockDailyTask();
        break;
      case 'POST /conversations':
        payload = {
          conversationId: `mock-conv-${Date.now()}`,
          fastgptChatId: `mock-fastgpt-${Date.now()}`,
        } as CreateConversationResult;
        break;
      case 'GET /conversations':
        // 无历史会话：返回空数组 → chat 页走「自动建会话 + 开场白」路径
        payload = [] as Conversation[];
        break;
      default:
        payload = {};
    }
  }

  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(payload as T), 300);
  });
}

// GET /reports：按 type 过滤 + cursor 分页（cursor = 起始下标字符串）
function mockReportList(query: string): ReportListResult {
  const params = new Map<string, string>();
  query.split('&').forEach((kv) => {
    const [k, v] = kv.split('=');
    if (k) params.set(k, decodeURIComponent(v || ''));
  });
  const type = params.get('type') || '';
  const limit = parseInt(params.get('limit') || '10', 10);
  const cursor = parseInt(params.get('cursor') || '0', 10);

  let ids = REPORT_ORDER.slice();
  if (type) ids = ids.filter((id) => REPORT_DETAILS[id].type === (type as ReportType));

  const page = ids.slice(cursor, cursor + limit);
  const nextIndex = cursor + limit;
  const items = page.map((id) => toListItem(REPORT_DETAILS[id]));
  const nextCursor = nextIndex < ids.length ? String(nextIndex) : null;
  return { items, nextCursor };
}

// GET /reports/:id：固定库命中直接返回；生成态 id 到期翻转为 ready（借战略全文）
function mockReportDetail(id: string): ReportDetail {
  const fixed = REPORT_DETAILS[id];
  if (fixed) return fixed;

  const deadline = genDeadline[id];
  if (deadline && Date.now() >= deadline) {
    return {
      id,
      type: 'strategy',
      status: 'ready',
      title: '你的护城河：把信任做成根据地',
      bodyMd: BODY_STRATEGY,
      annotation: '「别急着摊大。风来了先把帆张稳，扩张是水到渠成的事。」',
      origin: 'user',
      isRead: false,
      wordCount: 900,
      sequenceNo: null,
      meta: { kbSynced: true },
      createdAt: new Date().toISOString(),
      sources: [{ conversationId: 'c-cards', title: '最值钱的牌' }],
    };
  }
  // 未到期：仍在生成
  return {
    id,
    type: 'strategy',
    status: 'generating',
    title: '',
    bodyMd: '',
    annotation: '',
    origin: 'user',
    isRead: false,
    wordCount: 0,
    sequenceNo: null,
    meta: {},
    createdAt: new Date().toISOString(),
    sources: [],
  };
}
