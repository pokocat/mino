import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ReportType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService, SETTING_KEYS } from '../settings/settings.service';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminLoginDto } from './dto/admin-login.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';

/** 已知设置键集合（校验 PUT /admin/settings 的 key）。 */
const KNOWN_KEYS = new Set<string>(Object.values(SETTING_KEYS));

/** 后台仪表盘统计返回结构。 */
export interface AdminStats {
  users: number;
  conversations: number;
  messages: number;
  reports: number;
  reportsByType: Record<ReportType, number>;
  activeUsers7d: number;
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** 后台登录（公开）：账号密码换 JWT；失败 401。 */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto): Promise<{ token: string }> {
    const result = await this.admin.login(dto.user, dto.pass);
    if (!result) {
      throw new UnauthorizedException({ code: 401, message: '账号或密码错误' });
    }
    return result;
  }

  /** 读全部设置（需后台鉴权）。 */
  @Get('settings')
  @UseGuards(AdminAuthGuard)
  getSettings(): { settings: Record<string, string> } {
    return { settings: this.settings.getAll() };
  }

  /** 改一个设置键（需后台鉴权）：未知键 400，落库 + 即时更新缓存。 */
  @Put('settings')
  @UseGuards(AdminAuthGuard)
  async updateSetting(@Body() dto: UpdateSettingDto): Promise<{ ok: true }> {
    if (!KNOWN_KEYS.has(dto.key)) {
      throw new BadRequestException({
        code: 400,
        message: `未知设置键：${dto.key}`,
      });
    }
    await this.settings.set(dto.key, dto.value);
    return { ok: true };
  }

  /** 仪表盘统计（需后台鉴权）。 */
  @Get('stats')
  @UseGuards(AdminAuthGuard)
  async stats(): Promise<AdminStats> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [users, conversations, messages, reports, grouped, activeGroups] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.conversation.count(),
        this.prisma.message.count(),
        this.prisma.report.count(),
        this.prisma.report.groupBy({
          by: ['type'],
          _count: { _all: true },
        }),
        // 近 7 天有消息（lastMessageAt 随每条消息刷新）的去重用户
        this.prisma.conversation.groupBy({
          by: ['userId'],
          where: { lastMessageAt: { gte: sevenDaysAgo } },
        }),
      ]);

    const reportsByType: Record<ReportType, number> = {
      strategy: 0,
      resume: 0,
      review: 0,
      decision: 0,
    };
    for (const row of grouped) {
      reportsByType[row.type] = row._count._all;
    }

    return {
      users,
      conversations,
      messages,
      reports,
      reportsByType,
      activeUsers7d: activeGroups.length,
    };
  }
}
