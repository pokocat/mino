import { IsIn, IsString, IsNotEmpty } from 'class-validator';
import { ReportType } from '@prisma/client';

const REPORT_TYPES: ReportType[] = ['strategy', 'resume', 'review', 'decision'];

/** POST /reports/generate 入参：会话 id + 报告类型。 */
export class GenerateReportDto {
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsIn(REPORT_TYPES)
  type!: ReportType;
}
