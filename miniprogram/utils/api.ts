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
  createdAt?: string; // 注册时间（ISO）；用于「与军师相伴 N 天」，缺省则隐藏该行
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
  // 点击语义：生成报告 / 作为用户输入直接发送 / 把补充织进原报告（续写会话专属）
  action?: 'generateReport' | 'chat' | 'appendCommit';
  reportType?: ReportType; // action=generateReport 时的建议类型
  reportId?: string; // action=appendCommit 时携带：要织入的原报告 id
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

// DELETE /me → {ok:true}（注销账号：连带清对话/报告/知识库，后端职责）
export function deleteMe(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({ url: '/me', method: 'DELETE' });
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

// ---------------- 今日一问 / streak（M5）----------------

// 今日一问任务态：pending 待办 / started 已开聊 / done 已完成 / expired 已过期
export type TaskStatus = 'pending' | 'started' | 'done' | 'expired';

// GET /tasks/today 返回（无今日一问则为 null，前端隐藏卡片）
export interface DailyTask {
  id: string;
  question: string;
  hint: string;
  estMinutes: number;
  status: TaskStatus;
}

// POST /tasks/:id/start 返回（注入 prompt_seed 为开场，task→started）
export interface StartTaskResult {
  conversationId: string;
}

// GET /me/streak 返回（页面用 /me 内嵌的 streakDays，此端点备用）
export interface StreakResult {
  streakDays: number;
}

// GET /tasks/today → 今日一问 | null
export function getTodayTask(): Promise<DailyTask | null> {
  return request<DailyTask | null>({ url: '/tasks/today', method: 'GET' });
}

// POST /tasks/:id/start → {conversationId}（幂等：started 任务续同一会话）
export function startTask(id: string): Promise<StartTaskResult> {
  return request<StartTaskResult>({ url: `/tasks/${id}/start`, method: 'POST' });
}

// GET /me/streak → {streakDays}（页面主用 /me，此端点为契约完整性保留）
export function getStreak(): Promise<StreakResult> {
  return request<StreakResult>({ url: '/me/streak', method: 'GET' });
}

// ---------------- 报告（M4）----------------

// 报告生成态
export type ReportStatus = 'generating' | 'ready' | 'failed';
// 报告来源：user=我请军师写的 / agent=军师执笔
export type ReportOrigin = 'user' | 'agent';

// 列表项（GET /reports items[]）
export interface ReportListItem {
  id: string;
  type: ReportType;
  status: ReportStatus;
  title: string;
  summary: string;
  origin: ReportOrigin;
  isRead: boolean;
  wordCount: number;
  createdAt: string;
}

// GET /reports?type=&cursor=&limit= 返回
export interface ReportListResult {
  items: ReportListItem[];
  nextCursor: string | null;
}

// 报告溯源对话（详情 sources[]）
export interface ReportSource {
  conversationId: string;
  title: string;
}

// 报告详情类型专属元数据（meta，全可选）
export interface ReportMeta {
  kbSynced?: boolean; // 存入知识库标记（溯源标签用）
  verifyStatus?: 'pending' | 'verified' | 'failed'; // decision「待验证」等
}

// GET /reports/:id 返回
export interface ReportDetail {
  id: string;
  type: ReportType;
  status: ReportStatus;
  title: string;
  bodyMd: string;
  annotation: string;
  origin: ReportOrigin;
  isRead: boolean;
  wordCount: number;
  sequenceNo: number | null; // 创业履历「第一篇」编号
  meta: ReportMeta;
  createdAt: string;
  sources: ReportSource[];
}

// POST /reports/generate 返回
export interface GenerateReportResult {
  reportId: string;
  status: ReportStatus;
}

// ---------------- 报告导出（M6 分享图）----------------

// 导出正文段落（受限结构：小节标题 / 正文 / 有序项）
export interface ExportParagraph {
  kind: 'heading' | 'text' | 'item';
  text: string;
}

// 品牌信息（分享图页脚）
export interface ExportBrand {
  name: string;
  slogan: string;
}

// GET /reports/:id/export 返回（canvas 分享图绘制所需结构化数据）
export interface ExportData {
  title: string;
  type: ReportType;
  typeLabel: string;
  createdAt: string;
  wordCount: number;
  origin: ReportOrigin;
  paragraphs: ExportParagraph[];
  annotation: string;
  brand: ExportBrand;
}

// POST /reports/generate {conversationId, type} → {reportId, status}
export function generateReport(
  conversationId: string,
  type: ReportType
): Promise<GenerateReportResult> {
  return request<GenerateReportResult>({
    url: '/reports/generate',
    method: 'POST',
    data: { conversationId, type },
  });
}

// GET /reports?type=&cursor=&limit= → {items, nextCursor}
// type 为空串表示「全部」；cursor 为空表示首页
export function listReports(
  type = '',
  cursor = '',
  limit = 10
): Promise<ReportListResult> {
  const qs: string[] = [`limit=${limit}`];
  if (type) qs.push(`type=${type}`);
  if (cursor) qs.push(`cursor=${cursor}`);
  return request<ReportListResult>({ url: `/reports?${qs.join('&')}`, method: 'GET' });
}

// GET /reports/stats → {total, byType, unread}
export function getReportStats(): Promise<ReportStats> {
  return request<ReportStats>({ url: '/reports/stats', method: 'GET' });
}

// GET /reports/:id → 详情
export function getReport(id: string): Promise<ReportDetail> {
  return request<ReportDetail>({ url: `/reports/${id}`, method: 'GET' });
}

// POST /reports/:id/read → {ok:true}
export function markReportRead(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({ url: `/reports/${id}/read`, method: 'POST' });
}

// POST /reports/:id/chat → {conversationId}（跟军师聊/补充这份报告，续该会话）
export function chatFromReport(id: string): Promise<{ conversationId: string }> {
  return request<{ conversationId: string }>({
    url: `/reports/${id}/chat`,
    method: 'POST',
  });
}

// GET /reports/:id/export → 分享图绘制所需结构化数据
export function exportReport(id: string): Promise<ExportData> {
  return request<ExportData>({ url: `/reports/${id}/export`, method: 'GET' });
}

// ---------------- 报告续写 / 织入（V3 append）----------------

// POST /reports/:id/append → {conversationId}（仅 ready 报告；服务端建好续写会话，开场引用报告标题）
export function appendReport(id: string): Promise<{ conversationId: string }> {
  return request<{ conversationId: string }>({
    url: `/reports/${id}/append`,
    method: 'POST',
  });
}

// POST /reports/:id/append/commit {conversationId} → {reportId, status:"generating"}
// 把续写会话里的补充织进原报告（reportId 即原报告 id，随后轮询其详情等 ready）
export function commitAppend(
  id: string,
  conversationId: string
): Promise<GenerateReportResult> {
  return request<GenerateReportResult>({
    url: `/reports/${id}/append/commit`,
    method: 'POST',
    data: { conversationId },
  });
}
