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

// ---------------- 对话（M2）----------------

// 报告 4 类型
export type ReportType = 'strategy' | 'resume' | 'review' | 'decision';

// suggestions 事件中的单条「接着聊」气泡
export interface SuggestionItem {
  text: string;
  primary?: boolean; // true=深墨底金字主气泡（通常为「写报告」）
  action?: 'generateReport' | 'chat'; // 点击语义：生成报告 / 作为用户输入直接发送
  reportType?: ReportType; // action=generateReport 时的建议类型
}

// 一条会话消息（GET /conversations/:id/messages 返回项）
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

// 会话摘要（GET /conversations 返回项，与方案 §6 一致）
// lastMessageAt：最后一条消息时间；空会话可能为 null
export interface Conversation {
  id: string;
  title: string;
  lastMessageAt: string | null;
}

// POST /conversations 返回
export interface CreateConversationResult {
  conversationId: string;
  fastgptChatId: string;
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

// POST /conversations → {conversationId, fastgptChatId}（新建一段会话）
export function createConversation(): Promise<CreateConversationResult> {
  return request<CreateConversationResult>({ url: '/conversations', method: 'POST' });
}

// GET /conversations?limit= → 最近会话列表
export function listConversations(limit = 10): Promise<Conversation[]> {
  return request<Conversation[]>({ url: `/conversations?limit=${limit}`, method: 'GET' });
}

// GET /conversations/:id/messages → 历史消息（含军师开场白）
export function getMessages(conversationId: string): Promise<ChatMessage[]> {
  return request<ChatMessage[]>({
    url: `/conversations/${conversationId}/messages`,
    method: 'GET',
  });
}
