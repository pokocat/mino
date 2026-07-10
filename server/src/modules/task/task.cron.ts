import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WxPushService } from '../push/wx-push.service';
import { TaskService } from './task.service';

/** 「活跃用户」判定窗口：近 14 天有消息 或 streakDays>0。 */
const ACTIVE_WINDOW_DAYS = 14;

/** 选人时的用户投影。 */
interface ActiveUser {
  id: string;
  wxOpenid: string;
  nickname: string | null;
}

/**
 * 今日一问 cron 派发（M5 · §6）。
 * 每日 08:30 Asia/Shanghai：为活跃用户生成当日 daily_q（幂等）并推送订阅消息。
 * 纪律：单个用户失败不影响其余；生成/推送异常均在内部消化。
 */
@Injectable()
export class TaskCron {
  private readonly logger = new Logger(TaskCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly push: WxPushService,
  ) {}

  /** 每日 08:30（Asia/Shanghai）。 */
  @Cron('30 8 * * *', { timeZone: 'Asia/Shanghai' })
  async handleCron(): Promise<void> {
    await this.runDailyDispatch();
  }

  /**
   * 执行一次派发（供 cron 与手动触发/测试复用）。
   * @returns 成功派发的用户数
   */
  async runDailyDispatch(now: Date = new Date()): Promise<number> {
    const users = await this.selectActiveUsers(now);
    this.logger.log(`今日一问派发：命中活跃用户 ${users.length} 人`);
    let dispatched = 0;
    for (const user of users) {
      try {
        const task = await this.taskService.generateForUser(user.id, now);
        if (!task) continue;
        await this.push.sendDailyQuestion(
          { wxOpenid: user.wxOpenid, nickname: user.nickname },
          { id: task.id, question: task.question, estMinutes: task.estMinutes },
        );
        await this.taskService.markPushed(task.id, now);
        dispatched++;
      } catch (err) {
        // 单用户失败隔离，不影响其余
        this.logger.warn(
          `今日一问派发失败（用户 ${user.id}，已跳过）：${String(err)}`,
        );
      }
    }
    this.logger.log(`今日一问派发完成：${dispatched}/${users.length}`);
    return dispatched;
  }

  /** 选活跃用户：streakDays>0 或 近 14 天有消息。 */
  async selectActiveUsers(now: Date): Promise<ActiveUser[]> {
    const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86400000);
    return this.prisma.user.findMany({
      where: {
        OR: [
          { streakDays: { gt: 0 } },
          {
            conversations: {
              some: { messages: { some: { createdAt: { gte: since } } } },
            },
          },
        ],
      },
      select: { id: true, wxOpenid: true, nickname: true },
    });
  }
}
