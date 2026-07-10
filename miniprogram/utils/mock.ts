// MOCK_API=true 时的内置假数据。
// 键 = `METHOD /path`；返回值模拟后端约定结构（camelCase），带轻微延迟模拟网络。

import type {
  ChatMessage,
  Conversation,
  CreateConversationResult,
  UserProfile,
  WxLoginResult,
} from './api';

// MOCK 军师开场白（真实模式由服务端历史消息返回；此处内置以走通首次进入路径）
const MOCK_OPENING =
  '昨天你说想砍掉那条副线。今天先别急——你手里哪张牌最硬？咱们聊透了我记进你的档案，往后越聊我越懂你。';

// 全 0 stats 的默认用户；profile 提交时用入参覆盖对应字段。
// 注：demo 值给 streak/report 一点数字，便于问候区与 streak 芯片可视。
function mockUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: 'mock-user-1',
    nickname: '',
    avatarUrl: '',
    industry: '',
    bizNote: '',
    streakDays: 47,
    reportStats: {
      total: 6,
      byType: { strategy: 3, resume: 1, review: 1, decision: 1 },
      unread: 1,
    },
    ...overrides,
  };
}

// 依据 method+url 返回 mock 数据；未命中返回空对象。
export function resolveMock<T>(
  method: string,
  url: string,
  data?: Record<string, unknown>
): Promise<T> {
  const path = url.split('?')[0]; // 去掉 query
  const key = `${method.toUpperCase()} ${path}`;
  let payload: unknown = {};

  // 先处理带路径参数的路由（正则）
  const msgMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);

  if (method.toUpperCase() === 'GET' && msgMatch) {
    // 历史消息：给一条军师开场白（首次进入即续聊此开场）
    payload = [
      {
        id: 'mock-msg-opening',
        role: 'assistant',
        content: MOCK_OPENING,
        createdAt: new Date().toISOString(),
      },
    ] as ChatMessage[];
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
