import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportType, User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GenerateReportDto } from './dto/generate-report.dto';
import { ReportService } from './report.service';

/**
 * 报告端点（与小程序代理的硬契约，一字不差）。全部鉴权 + 归属校验（403）。
 * 路由顺序：静态路径 /reports/generate、/reports/stats 必须在动态 /reports/:id 之前声明。
 */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /** POST /reports/generate {conversationId,type} → {reportId, status:'generating'} */
  @Post('generate')
  async generate(@CurrentUser() user: User, @Body() dto: GenerateReportDto) {
    return this.reportService.generate(user.id, dto.conversationId, dto.type);
  }

  /** GET /reports?type=&cursor=&limit= → {items, nextCursor} */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query('type') type: ReportType | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit', new DefaultValuePipe('20')) limit: string,
  ) {
    const parsed = Number.parseInt(limit, 10);
    return this.reportService.list(user.id, {
      type: isReportType(type) ? type : undefined,
      cursor: cursor || undefined,
      limit: Number.isFinite(parsed) ? parsed : 20,
    });
  }

  /** GET /reports/stats → {total, byType, unread}（只计 ready） */
  @Get('stats')
  async stats(@CurrentUser() user: User) {
    return this.reportService.stats(user.id);
  }

  /** GET /reports/:id → 详情（含 sources） */
  @Get(':id')
  async detail(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reportService.getDetail(user.id, id);
  }

  /** POST /reports/:id/read → {ok:true} */
  @Post(':id/read')
  async read(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reportService.markRead(user.id, id);
  }

  /** POST /reports/:id/chat → {conversationId}（新建会话，注入报告开场与上下文） */
  @Post(':id/chat')
  async chat(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reportService.chatAboutReport(user.id, id);
  }
}

/** 运行时校验 type 查询参数是否合法报告类型。 */
function isReportType(v: unknown): v is ReportType {
  return (
    v === 'strategy' || v === 'resume' || v === 'review' || v === 'decision'
  );
}
