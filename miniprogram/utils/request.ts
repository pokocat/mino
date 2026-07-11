// 网络层：Promise 封装 wx.request。
// - baseUrl 走 config；自动带 Authorization: Bearer <token>（token 存 storage）
// - 401 清 token 并 reLaunch 回 onboarding
// - 非 2xx / 网络失败统一 toast
// - MOCK_API=true 时短路返回内置 mock，不发请求

import { MOCK_API, STORAGE_KEYS, config } from './config';
import { resolveMock } from './mock';
import type { ApiError } from './api';

// ---- token 存取 ----
export function getToken(): string {
  return wx.getStorageSync<string>(STORAGE_KEYS.token) || '';
}
export function setToken(token: string): void {
  wx.setStorageSync(STORAGE_KEYS.token, token);
}
export function clearToken(): void {
  wx.removeStorageSync(STORAGE_KEYS.token);
}

// 登录跳转去重：多个并发 401 或登出后的残余请求只触发一次友好跳转，避免请求/跳转风暴。
let redirectingToLogin = false;
function goLoginOnce(message = '登录已失效，请重新登录'): void {
  if (redirectingToLogin) return;
  // 已经在登录页就不再跳，避免自跳循环
  const pages = getCurrentPages();
  const top = pages[pages.length - 1];
  if (top && (top.route || '').indexOf('pages/onboarding/onboarding') !== -1) {
    return;
  }
  redirectingToLogin = true;
  wx.showToast({ title: message, icon: 'none' });
  wx.reLaunch({
    url: '/pages/onboarding/onboarding',
    complete: () => {
      // 切换完成后稍延迟解锁，避免切换途中的残余请求立刻再次触发跳转
      setTimeout(() => {
        redirectingToLogin = false;
      }, 800);
    },
  });
}

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
  auth?: boolean; // 是否带 token，默认 true
}

export function request<T>(opts: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, auth = true } = opts;

  // 开发无后端：直接返回 mock
  if (MOCK_API) {
    return resolveMock<T>(method, url, data);
  }

  // 需要鉴权但无 token：直接短路，不打网络、不制造 401 风暴，友好跳登录。
  if (auth && !getToken()) {
    goLoginOnce('请先登录');
    return Promise.reject({ code: 'UNAUTHORIZED', message: '请先登录' } as ApiError);
  }

  return new Promise<T>((resolve, reject) => {
    const header: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      const token = getToken();
      if (token) {
        header.Authorization = `Bearer ${token}`;
      }
    }

    wx.request({
      url: `${config.baseUrl}${url}`,
      method,
      data,
      header,
      success: (res) => {
        const status = res.statusCode;

        // 401：登录态失效 → 清 token 回登录页
        if (status === 401) {
          clearToken();
          goLoginOnce();
          reject({ code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' } as ApiError);
          return;
        }

        if (status >= 200 && status < 300) {
          resolve(res.data as T);
          return;
        }

        // 其他错误：优先用后端 {code,message}
        const body = res.data as Partial<ApiError> | undefined;
        const err: ApiError = {
          code: body?.code || `HTTP_${status}`,
          message: body?.message || '请求失败，请稍后再试',
        };
        wx.showToast({ title: err.message, icon: 'none' });
        reject(err);
      },
      fail: (e) => {
        const err: ApiError = { code: 'NETWORK', message: '网络异常，请稍后再试' };
        wx.showToast({ title: err.message, icon: 'none' });
        // 保留原始 errMsg 便于排查
        reject({ ...err, message: e.errMsg || err.message });
      },
    });
  });
}
