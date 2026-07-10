import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeStreak } from './streak.util';

/**
 * 连续天数（streak）结算服务，方案 R6。
 *
 * 挂在 ChatService 发消息入口（异步旁路）：用户每日**第一条消息**触发结算。
 * 纪律：任何异常都在内部消化，绝不抛出——streak 计错不能影响对话主链路。
 * users.streakDays / lastActiveDate 为权威落库值；GET /me、GET /me/streak 直接读该值。
 */
@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 结算一次用户活跃。幂等：当日重复调用只在第一次改动 streak。
   * @returns 结算后的 streakDays（异常时返回 null，调用方无需关心）
   */
  async settleOnMessage(
    userId: string,
    now: Date = new Date(),
  ): Promise<number | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { streakDays: true, lastActiveDate: true },
      });
      if (!user) return null;

      const result = computeStreak({
        lastActiveDate: user.lastActiveDate,
        streakDays: user.streakDays,
        now,
      });
      if (!result.changed) return user.streakDays;

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          streakDays: result.streakDays,
          lastActiveDate: result.lastActiveDate,
        },
      });
      this.logger.debug(
        `streak 结算：用户 ${userId} → ${result.streakDays} 天`,
      );
      return result.streakDays;
    } catch (err) {
      // 旁路容错：结算失败仅告警，不影响对话
      this.logger.warn(`streak 结算失败（已忽略）：${String(err)}`);
      return null;
    }
  }

  /** 读取当前连续天数（供 GET /me/streak）。 */
  async getStreak(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { streakDays: true },
    });
    return user?.streakDays ?? 0;
  }
}
