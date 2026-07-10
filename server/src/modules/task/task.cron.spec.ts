import { PrismaService } from '../../prisma/prisma.service';
import { WxPushService } from '../push/wx-push.service';
import { TaskService } from './task.service';
import { TaskCron } from './task.cron';

describe('TaskCron', () => {
  const now = new Date('2026-07-10T02:00:00Z');

  describe('selectActiveUsers（选人逻辑）', () => {
    it('WHERE = streakDays>0 OR 近 14 天有消息', async () => {
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const cron = new TaskCron(
        prisma as unknown as PrismaService,
        {} as TaskService,
        {} as WxPushService,
      );
      await cron.selectActiveUsers(now);

      const arg = prisma.user.findMany.mock.calls[0][0];
      expect(arg.where.OR).toHaveLength(2);
      expect(arg.where.OR[0]).toEqual({ streakDays: { gt: 0 } });
      // 近 14 天：since = now - 14d
      const since: Date =
        arg.where.OR[1].conversations.some.messages.some.createdAt.gte;
      expect(since.toISOString()).toBe('2026-06-26T02:00:00.000Z');
      expect(arg.select).toEqual({ id: true, wxOpenid: true, nickname: true });
    });
  });

  describe('runDailyDispatch（派发 + 推送 + 隔离失败）', () => {
    it('为每个活跃用户生成 daily_q 并推送、markPushed', async () => {
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u1', wxOpenid: 'o1', nickname: 'A' },
            { id: 'u2', wxOpenid: 'o2', nickname: 'B' },
          ]),
        },
      };
      const taskService = {
        generateForUser: jest.fn().mockImplementation((id: string) =>
          Promise.resolve({
            id: `task-${id}`,
            question: 'Q',
            estMinutes: 3,
          }),
        ),
        markPushed: jest.fn().mockResolvedValue(undefined),
      };
      const push = {
        sendDailyQuestion: jest.fn().mockResolvedValue(undefined),
      };
      const cron = new TaskCron(
        prisma as unknown as PrismaService,
        taskService as unknown as TaskService,
        push as unknown as WxPushService,
      );

      const dispatched = await cron.runDailyDispatch(now);
      expect(dispatched).toBe(2);
      expect(taskService.generateForUser).toHaveBeenCalledTimes(2);
      expect(push.sendDailyQuestion).toHaveBeenCalledTimes(2);
      expect(push.sendDailyQuestion).toHaveBeenCalledWith(
        { wxOpenid: 'o1', nickname: 'A' },
        { id: 'task-u1', question: 'Q', estMinutes: 3 },
      );
      expect(taskService.markPushed).toHaveBeenCalledTimes(2);
    });

    it('单用户生成抛错不影响其余（隔离失败）', async () => {
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u1', wxOpenid: 'o1', nickname: 'A' },
            { id: 'u2', wxOpenid: 'o2', nickname: 'B' },
          ]),
        },
      };
      const taskService = {
        generateForUser: jest
          .fn()
          .mockRejectedValueOnce(new Error('boom'))
          .mockResolvedValueOnce({
            id: 'task-u2',
            question: 'Q',
            estMinutes: 3,
          }),
        markPushed: jest.fn().mockResolvedValue(undefined),
      };
      const push = {
        sendDailyQuestion: jest.fn().mockResolvedValue(undefined),
      };
      const cron = new TaskCron(
        prisma as unknown as PrismaService,
        taskService as unknown as TaskService,
        push as unknown as WxPushService,
      );

      const dispatched = await cron.runDailyDispatch(now);
      expect(dispatched).toBe(1);
      expect(push.sendDailyQuestion).toHaveBeenCalledTimes(1);
    });
  });
});
