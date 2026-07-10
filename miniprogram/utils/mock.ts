// MOCK_API=true 时的内置假数据。
// 键 = `METHOD /path`；返回值模拟后端约定结构（camelCase），带轻微延迟模拟网络。

import type { UserProfile, WxLoginResult } from './api';

// 全 0 stats 的默认用户；profile 提交时用入参覆盖对应字段。
function mockUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: 'mock-user-1',
    nickname: '',
    avatarUrl: '',
    industry: '',
    bizNote: '',
    streakDays: 0,
    reportStats: {
      total: 0,
      byType: { strategy: 0, resume: 0, review: 0, decision: 0 },
      unread: 0,
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
  const key = `${method.toUpperCase()} ${url}`;
  let payload: unknown = {};

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
    default:
      payload = {};
  }

  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(payload as T), 300);
  });
}
