/** report-generate 队列名。 */
export const REPORT_GENERATE_QUEUE = 'report-generate';

/**
 * report-generate job 载荷：待生成报告的行 id（其余素材由 Worker 现取）。
 * mode 缺省为 'generate'（首次生成）；'append' 为续写修订，此时 conversationId 指定续写会话。
 */
export interface ReportGenerateJobData {
  reportId: string;
  mode?: 'generate' | 'append';
  conversationId?: string;
}
