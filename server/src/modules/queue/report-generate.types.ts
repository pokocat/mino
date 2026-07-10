/** report-generate 队列名。 */
export const REPORT_GENERATE_QUEUE = 'report-generate';

/** report-generate job 载荷：待生成报告的行 id（其余素材由 Worker 现取）。 */
export interface ReportGenerateJobData {
  reportId: string;
}
