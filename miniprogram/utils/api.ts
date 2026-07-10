// API 契约（与服务端严格约定，字段全 camelCase）
// 对应方案 §6 / 交接文档 §7。M1 只用到鉴权 / 入局 / 用户信息三个端点。

import { request } from './request';

// POST /auth/wx-login 返回
export interface WxLoginResult {
  token: string;
  isNewUser: boolean;
}

// 报告计数摘要（GET /me 内嵌）
export interface ReportStats {
  total: number;
  byType: {
    strategy: number;
    resume: number;
    review: number;
    decision: number;
  };
  unread: number;
}

// 用户对象（GET /me、POST /me/profile 返回）
export interface UserProfile {
  id: string;
  nickname: string;
  avatarUrl: string;
  industry: string;
  bizNote: string;
  streakDays: number;
  reportStats: ReportStats;
}

// POST /me/profile 入参
export interface ProfileInput {
  nickname: string;
  industry: string;
  bizNote: string;
}

// 统一错误结构
export interface ApiError {
  code: string;
  message: string;
}

// POST /auth/wx-login {code} → {token, isNewUser}
export function wxLogin(code: string): Promise<WxLoginResult> {
  return request<WxLoginResult>({
    url: '/auth/wx-login',
    method: 'POST',
    data: { code },
    auth: false,
  });
}

// POST /me/profile {nickname, industry, bizNote} → 用户对象
export function updateProfile(input: ProfileInput): Promise<UserProfile> {
  return request<UserProfile>({
    url: '/me/profile',
    method: 'POST',
    data: { ...input },
  });
}

// GET /me → 用户信息 + streakDays + reportStats
export function getMe(): Promise<UserProfile> {
  return request<UserProfile>({ url: '/me', method: 'GET' });
}
