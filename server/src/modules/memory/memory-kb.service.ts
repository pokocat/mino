import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// 仅取类型：@mastra/pg 是 ESM，运行时用 require 惰性加载（见 client()），
// 避免「仅 import 本服务」就把 @mastra/pg 及其 ESM 依赖拉进进程 / 测试。
import type { PgVector } from '@mastra/pg';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

/**
 * 每用户记忆知识库 · 真实 pgvector 实现（Phase 1）。
 *
 * 与 FastgptKbService 保持完全相同的四方法签名，由 FastgptKbService 在
 * 「provider=openai 且 EMBEDDING_API_KEY 已配置」时委托进来（调用方零改动）。
 *
 * 存储模型：所有用户的记忆共用一张 pgvector 表（indexName=mino_memory），
 * 以 metadata.userId 分区；检索/删除按 userId 过滤。相比「每人一张表」更省 DDL 与索引开销。
 * 该表由 @mastra/pg 的 PgVector 运行时自建于 public schema（不进 Prisma schema，
 * 故不影响 CI 的迁移漂移校验——漂移校验只对比 migrations 与 schema.prisma，不看业务库实况）。
 *
 * kbId 约定：pgv_<userId>，写回 users.kbId 兼容现有读点；四方法从 kbId 反解 userId。
 */
@Injectable()
export class MemoryKbService implements OnModuleDestroy {
  private readonly logger = new Logger(MemoryKbService.name);

  /** 全体用户共用的向量索引（= pgvector 表名）。 */
  private static readonly INDEX = 'mino_memory';

  private store: PgVector | null = null;
  private indexReady: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** 惰性拿到 PgVector 客户端（连接串复用 DATABASE_URL）。 */
  private client(): PgVector {
    if (!this.store) {
      const connectionString = this.config.get<string>('database.url') ?? '';
      if (!connectionString) {
        throw new Error('DATABASE_URL 未配置，MemoryKbService 无法初始化');
      }
      // 运行时 require（@mastra/pg 为 ESM，惰性加载，避免顶层 import 拉入 ESM 依赖）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PgVector } = require('@mastra/pg') as typeof import('@mastra/pg');
      this.store = new PgVector({ id: 'mino-memory', connectionString });
    }
    return this.store;
  }

  /** 确保共享向量索引已建（幂等，仅首次真正建表）。 */
  private ensureIndex(): Promise<void> {
    if (!this.indexReady) {
      this.indexReady = this.client()
        .createIndex({
          indexName: MemoryKbService.INDEX,
          dimension: this.embedding.dim,
          metric: 'cosine',
        })
        .catch((err) => {
          // 建表失败不缓存 promise，下次重试
          this.indexReady = null;
          throw err;
        });
    }
    return this.indexReady;
  }

  /** kbId(pgv_<userId>) → userId。 */
  private userIdOf(kbId: string): string {
    return kbId.startsWith('pgv_') ? kbId.slice(4) : kbId;
  }

  /**
   * 确保该用户已有专属记忆库标识。约定 kbId=pgv_<userId>，写回 users.kbId。
   * 同时确保底层共享索引存在（首次建表）。
   */
  async ensureUserKb(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kbId: true },
    });
    if (user?.kbId) {
      // 已有 kbId：仍确保底层索引就绪（幂等），避免历史用户首次写入时表不存在。
      await this.ensureIndex();
      return user.kbId;
    }

    await this.ensureIndex();
    const kbId = `pgv_${userId}`;
    await this.prisma.user.update({ where: { id: userId }, data: { kbId } });
    this.logger.log(`已为用户 ${userId} 建立记忆库 ${kbId}`);
    return kbId;
  }

  /**
   * 写入一条要点：embed → upsert（metadata 带 userId/title/text/createdAt）。
   * 失败抛出，交给队列重试（与 FastGPT 实现一致）。
   */
  async pushText(kbId: string, title: string, text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;
    const userId = this.userIdOf(kbId);

    await this.ensureIndex();
    const vector = await this.embedding.embedOne(body);
    await this.client().upsert({
      indexName: MemoryKbService.INDEX,
      vectors: [vector],
      metadata: [
        {
          userId,
          title,
          text: body,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    this.logger.debug(`记忆写入 ${kbId}：${title}`);
  }

  /**
   * 检索：embed(query) → query(filter userId, topK=limit) → 命中片段文本数组。
   * 失败抛出（调用方作旁路处理）。
   */
  async search(kbId: string, query: string, limit: number): Promise<string[]> {
    const q = query.trim();
    if (!q) return [];
    const userId = this.userIdOf(kbId);

    await this.ensureIndex();
    const queryVector = await this.embedding.embedOne(q);
    const results = await this.client().query({
      indexName: MemoryKbService.INDEX,
      queryVector,
      topK: limit,
      filter: { userId },
    });
    return results
      .map((r) => {
        const t = (r.metadata as { text?: unknown } | undefined)?.text;
        return typeof t === 'string' ? t.trim() : '';
      })
      .filter((s) => s.length > 0)
      .slice(0, limit);
  }

  /**
   * 删除该用户全部记忆向量（合规 · DELETE /me 级联）。
   * best-effort：失败只告警、不抛出，保证账号删除幂等可完成。
   * @mastra/pg 原生支持按 metadata 过滤删除（deleteVectors filter）。
   */
  async deleteKb(kbId: string): Promise<void> {
    if (!kbId) return;
    const userId = this.userIdOf(kbId);
    try {
      await this.ensureIndex();
      await this.client().deleteVectors({
        indexName: MemoryKbService.INDEX,
        filter: { userId },
      });
      this.logger.log(`已删除用户 ${userId} 的记忆向量`);
    } catch (err) {
      this.logger.warn(`删除记忆向量 ${kbId} 异常（已忽略）：${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.store) {
      try {
        await this.store.disconnect();
      } catch {
        // 忽略关闭异常
      }
    }
  }
}
