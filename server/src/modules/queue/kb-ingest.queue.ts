import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  KB_INGEST_QUEUE,
  KbIngestJobData,
  parseRedisUrl,
} from './kb-ingest.types';

/**
 * kb.ingest 入队器（记忆旁路）。
 *
 * 关键容错（方案 R9 精神）：记忆是旁路，绝不能拖垮主链路。
 *  - Redis 不可达 / 队列未启用：enqueue **静默降级**，仅告警日志，绝不抛出。
 *  - 队列构造失败：吞掉，退化为无队列（入队即空操作）。
 * 应用因此在 Redis 缺席时仍能照常启动、对话照常完成。
 */
@Injectable()
export class KbIngestQueue implements OnModuleDestroy {
  private readonly logger = new Logger(KbIngestQueue.name);
  private queue?: Queue<KbIngestJobData>;
  private warned = false;

  constructor(private readonly config: ConfigService) {
    const enabled = this.config.get<boolean>('queue.enabled');
    const url = this.config.get<string>('redis.url');
    if (!enabled || !url) {
      this.logger.warn(
        'kb.ingest 队列未启用（无 REDIS_URL 或已显式关闭），记忆写入降级为空操作',
      );
      return;
    }
    try {
      this.queue = new Queue<KbIngestJobData>(KB_INGEST_QUEUE, {
        connection: {
          ...parseRedisUrl(url),
          // 关键：Redis 不可达时命令**立即失败**而非排队等待，避免 add() 阻塞主链路
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          // 连接重试有上限，超过则放弃（记忆旁路，不为它无限重连）
          retryStrategy: (times: number) =>
            times > 3 ? null : Math.min(times * 200, 1000),
        },
      });
      // 连接层错误只告警一次，不影响主链路
      this.queue.on('error', (err) => this.warnOnce(err));
    } catch (err) {
      this.logger.warn(
        `kb.ingest 队列初始化失败，降级为空操作：${String(err)}`,
      );
      this.queue = undefined;
    }
  }

  /** 入队一轮对话的要点提取任务。失败仅告警，绝不抛出（记忆旁路）。 */
  async enqueue(data: KbIngestJobData): Promise<void> {
    if (!this.queue) {
      this.logger.debug('队列未启用，跳过 kb.ingest 入队');
      return;
    }
    try {
      // 兜底超时：无论底层如何，入队至多阻塞 ENQUEUE_TIMEOUT_MS，绝不拖住对话收尾
      await withTimeout(
        this.queue.add('ingest', data, {
          // 提取/写入失败至多重试到 2 次尝试（不无限重试拖累记忆链路）
          attempts: 2,
          backoff: { type: 'fixed', delay: 3000 },
          removeOnComplete: true,
          removeOnFail: 50,
        }),
        ENQUEUE_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(
        `kb.ingest 入队失败（记忆旁路，不影响对话）：${String(err)}`,
      );
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `kb.ingest 队列连接异常（记忆旁路，不影响对话）：${String(err)}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/** 入队兜底超时（毫秒）：超过即视作失败，保证记忆旁路不阻塞主链路。 */
const ENQUEUE_TIMEOUT_MS = 2000;

/** 给 promise 套一个超时；超时则 reject。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`入队超时 ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
}
