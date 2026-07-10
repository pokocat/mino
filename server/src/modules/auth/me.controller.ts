import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReportType, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { CurrentUser } from './current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

/** 报告计数摘要（派生数据，接口聚合，不落表）。 */
interface ReportStats {
  total: number;
  byType: Record<ReportType, number>;
  unread: number;
}

/** GET /me 返回结构。 */
interface MeResponse {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  industry: string | null;
  bizNote: string | null;
  streakDays: number;
  createdAt: string; // 注册时间（ISO 8601），供小程序「相伴 N 天」展示
  reportStats: ReportStats;
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: FastgptKbService,
  ) {}

  /** 入局 / 编辑资料：更新昵称、行业、生意背景。 */
  @Post('profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        nickname: dto.nickname,
        industry: dto.industry ?? null,
        bizNote: dto.bizNote ?? null,
      },
    });
  }

  /** 当前用户信息 + streak + 报告计数摘要。 */
  @Get()
  async me(@CurrentUser() user: User): Promise<MeResponse> {
    const reportStats = await this.buildReportStats(user.id);
    return {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      industry: user.industry,
      bizNote: user.bizNote,
      streakDays: user.streakDays,
      createdAt: user.createdAt.toISOString(),
      reportStats,
    };
  }

  /** 连续天数（M5 前先读 users 表，Redis 快路径后置）。 */
  @Get('streak')
  streak(@CurrentUser() user: User): { streakDays: number } {
    return { streakDays: user.streakDays };
  }

  /**
   * 账号与数据删除（合规 · 用户删除权）：级联删除该用户全部数据（Prisma onDelete:Cascade
   * 连带清 conversations/messages/reports/report_sources/tasks）+ 删除 FastGPT 知识库。
   * 幂等：先删知识库（best-effort），再以 deleteMany 删用户（已删除则 count=0 不报错），恒返回 {ok:true}。
   */
  @Delete()
  async deleteAccount(@CurrentUser() user: User): Promise<{ ok: true }> {
    // 先删外部知识库（deleteKb 内部已吞异常），再删本地数据；顺序保证 kbId 仍可读
    if (user.kbId) {
      await this.kb.deleteKb(user.kbId);
    }
    const { count } = await this.prisma.user.deleteMany({
      where: { id: user.id },
    });
    this.logger.log(`账号删除：user=${user.id} 级联删除完成（count=${count}）`);
    return { ok: true };
  }

  /** 用 Prisma groupBy 聚合报告计数（当前自然全 0）。 */
  private async buildReportStats(userId: string): Promise<ReportStats> {
    const grouped = await this.prisma.report.groupBy({
      by: ['type'],
      where: { userId, status: 'ready' },
      _count: { _all: true },
    });

    const byType: Record<ReportType, number> = {
      strategy: 0,
      resume: 0,
      review: 0,
      decision: 0,
    };
    let total = 0;
    for (const row of grouped) {
      const count = row._count._all;
      byType[row.type] = count;
      total += count;
    }

    const unread = await this.prisma.report.count({
      where: { userId, status: 'ready', isRead: false },
    });

    return { total, byType, unread };
  }
}
