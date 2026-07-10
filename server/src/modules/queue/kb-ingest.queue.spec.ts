import { ConfigService } from '@nestjs/config';
import { KbIngestQueue } from './kb-ingest.queue';

function config(values: Record<string, unknown>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('KbIngestQueue（Redis 降级容错）', () => {
  it('队列未启用（无 REDIS_URL）时 enqueue 为空操作，绝不抛出', async () => {
    const queue = new KbIngestQueue(
      config({ 'queue.enabled': false, 'redis.url': undefined }),
    );
    await expect(
      queue.enqueue({ conversationId: 'c1', messageIds: ['m1'] }),
    ).resolves.toBeUndefined();
  });

  it('底层 Queue.add 抛出时 enqueue 吞掉异常（记忆旁路不拖垮主链路）', async () => {
    const queue = new KbIngestQueue(
      config({ 'queue.enabled': false, 'redis.url': undefined }),
    );
    // 注入一个会抛错的假队列，验证 enqueue 不外抛
    (queue as unknown as { queue: { add: jest.Mock } }).queue = {
      add: jest.fn().mockRejectedValue(new Error('boom')),
    };
    await expect(
      queue.enqueue({ conversationId: 'c1', messageIds: ['m1'] }),
    ).resolves.toBeUndefined();
  });
});
