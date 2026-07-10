import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { parseRedisUrl } from './kb-ingest.types';
import {
  REPORT_GENERATE_QUEUE,
  ReportGenerateJobData,
} from './report-generate.types';

/**
 * report-generate 入队器（复用 kb.ingest 的 Redis 容错纪律）。
 *
 * 与记忆旁路不同：报告是唯一交付物，不能「静默丢弃」。因此 enqueue 返回布尔——
 *  - true：已成功入队，交由 Worker 异步生成。
 *  - false：队列未启用 / Redis 不可达 / 入队超时，由调用方**降级为同步（或就地异步）执行**，保证功能可用。
 */
@Injectable()
export class ReportGenerateQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ReportGenerateQueue.name);
  private queue?: Queue<ReportGenerateJobData>;
  private warned = false;

  constructor(private readonly config: ConfigService) {
    const enabled = this.config.get<boolean>('queue.enabled');
    const url = this.config.get<string>('redis.url');
    if (!enabled || !url) {
      this.logger.warn(
        'report-generate 队列未启用（无 REDIS_URL 或已显式关闭），生成将降级为同步执行',
      );
      return;
    }
    try {
      this.queue = new Queue<ReportGenerateJobData>(REPORT_GENERATE_QUEUE, {
        connection: {
          ...parseRedisUrl(url),
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (times: number) =>
            times > 3 ? null : Math.min(times * 200, 1000),
        },
      });
      this.queue.on('error', (err) => this.warnOnce(err));
    } catch (err) {
      this.logger.warn(
        `report-generate 队列初始化失败，降级为同步执行：${String(err)}`,
      );
      this.queue = undefined;
    }
  }

  /** 是否有可用队列（false 时调用方走同步降级）。 */
  get enabled(): boolean {
    return !!this.queue;
  }

  /** 入队一份报告生成任务；返回是否成功入队（false → 调用方降级执行）。 */
  async enqueue(data: ReportGenerateJobData): Promise<boolean> {
    if (!this.queue) return false;
    try {
      await withTimeout(
        this.queue.add('generate', data, {
          // 内容层解析失败由 Processor 内部重试并置 failed；此处不做 BullMQ 重试
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 50,
        }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (err) {
      this.warnOnce(err);
      return false;
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `report-generate 队列连接异常（将降级为同步执行）：${String(err)}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/** 入队兜底超时（毫秒）。 */
const ENQUEUE_TIMEOUT_MS = 2000;

/** 给 promise 套超时；超时则 reject。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`入队超时 ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
}
