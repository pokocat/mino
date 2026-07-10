import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * FastGPT 每用户知识库服务（M3「越来越懂你」）。
 *
 * 三个能力：建库(ensureUserKb) / 写入(pushText) / 检索(search)，全部走 FastGPT OpenAPI。
 * FASTGPT_MOCK=true 时三方法改走进程内存 Map，无真实 FastGPT 也能把记忆全链路跑通与测试。
 *
 * OpenAPI 端点依据 FastGPT v4.9.x（自托管，见 docker-compose 固定 tag v4.9.11）：
 *  - 建库：POST {baseUrl}/api/core/dataset/create              → data 为 datasetId 字符串
 *  - 写入：POST {baseUrl}/api/core/dataset/collection/create/text
 *          （pushData 需已存在 collectionId；create/text 一步建集合并入库，是等价且更省事的写入端点）
 *  - 检索：POST {baseUrl}/api/core/dataset/searchTest          → data.list[] 命中片段
 * 授权统一 Authorization: Bearer {FASTGPT_OPENAPI_KEY}。
 */
@Injectable()
export class FastgptKbService {
  private readonly logger = new Logger(FastgptKbService.name);

  // Mock 内存态：kbId → 该库的文本片段列表
  private readonly mockStore = new Map<string, string[]>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** 是否 mock 模式。 */
  private get mock(): boolean {
    return this.config.get<boolean>('fastgpt.mock') === true;
  }

  /** baseUrl（去尾斜杠）。 */
  private get baseUrl(): string {
    return (this.config.get<string>('fastgpt.baseUrl') ?? '').replace(
      /\/+$/,
      '',
    );
  }

  /** OpenAPI Key。 */
  private get openApiKey(): string {
    return this.config.get<string>('fastgpt.openApiKey') ?? '';
  }

  /**
   * 确保该用户已有专属知识库，返回其 kbId。
   * users.kbId 为空时创建并回填；已有则直接返回。
   */
  async ensureUserKb(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kbId: true },
    });
    if (user?.kbId) return user.kbId;

    const kbId = this.mock
      ? `mock_kb_${userId}`
      : await this.createDataset(userId);

    if (this.mock && !this.mockStore.has(kbId)) {
      this.mockStore.set(kbId, []);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { kbId },
    });
    this.logger.log(`已为用户 ${userId} 建立知识库 ${kbId}`);
    return kbId;
  }

  /**
   * 写入一条要点到知识库。
   * @param kbId  知识库 id（datasetId）
   * @param title 片段标题（含日期与会话 id，便于溯源）
   * @param text  要点正文
   */
  async pushText(kbId: string, title: string, text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;

    if (this.mock) {
      const list = this.mockStore.get(kbId) ?? [];
      list.push(body);
      this.mockStore.set(kbId, list);
      this.logger.debug(`[mock] 写入知识库 ${kbId}：${title}`);
      return;
    }

    // POST /api/core/dataset/collection/create/text —— 建文本集合并入库（v4.9.x）
    const res = await fetch(
      `${this.baseUrl}/api/core/dataset/collection/create/text`,
      {
        method: 'POST',
        headers: this.jsonAuthHeaders(),
        body: JSON.stringify({
          datasetId: kbId,
          name: title,
          text: body,
          trainingType: 'chunk',
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`FastGPT pushText 失败：HTTP ${res.status}`);
    }
  }

  /**
   * 检索知识库，返回命中片段文本数组（最多 limit 条）。
   * @param query 检索词（通常为用户本条消息）
   */
  async search(kbId: string, query: string, limit: number): Promise<string[]> {
    const q = query.trim();
    if (!q) return [];

    if (this.mock) {
      const list = this.mockStore.get(kbId) ?? [];
      // 朴素关键词包含匹配：query 与片段有任一 2+ 字公共子串即算命中
      const hits = list.filter((frag) => naiveMatch(frag, q));
      return hits.slice(0, limit);
    }

    // POST /api/core/dataset/searchTest —— 知识库检索（v4.9.x）
    const res = await fetch(`${this.baseUrl}/api/core/dataset/searchTest`, {
      method: 'POST',
      headers: this.jsonAuthHeaders(),
      body: JSON.stringify({ datasetId: kbId, text: q, limit }),
    });
    if (!res.ok) {
      throw new Error(`FastGPT search 失败：HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: { list?: Array<{ q?: string; a?: string }> };
    };
    const list = json?.data?.list ?? [];
    return list
      .map((item) => [item.q, item.a].filter(Boolean).join(' ').trim())
      .filter((s) => s.length > 0)
      .slice(0, limit);
  }

  /**
   * 删除知识库（合规 · DELETE /me 级联）。best-effort：失败只记日志、不抛出，保证账号删除幂等可完成。
   * mock 清内存；真实走 DELETE /api/core/dataset/delete?id={kbId}（v4.9.x）。
   */
  async deleteKb(kbId: string): Promise<void> {
    if (!kbId) return;

    if (this.mock) {
      this.mockStore.delete(kbId);
      this.logger.debug(`[mock] 删除知识库 ${kbId}`);
      return;
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/api/core/dataset/delete?id=${encodeURIComponent(kbId)}`,
        { method: 'DELETE', headers: this.jsonAuthHeaders() },
      );
      if (!res.ok) {
        this.logger.warn(`FastGPT 删除知识库 ${kbId} 失败：HTTP ${res.status}`);
        return;
      }
      this.logger.log(`已删除知识库 ${kbId}`);
    } catch (err) {
      this.logger.warn(
        `FastGPT 删除知识库 ${kbId} 异常（已忽略）：${String(err)}`,
      );
    }
  }

  /** 真实建库：POST /api/core/dataset/create，返回 datasetId。 */
  private async createDataset(userId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/core/dataset/create`, {
      method: 'POST',
      headers: this.jsonAuthHeaders(),
      body: JSON.stringify({
        type: 'dataset',
        name: `mino_user_${userId}`,
        intro: '米诺战略参谋部 · 该老板的专属战略档案',
        vectorModel: this.config.get<string>('fastgpt.kbVectorModel'),
        agentModel: this.config.get<string>('fastgpt.kbAgentModel'),
      }),
    });
    if (!res.ok) {
      throw new Error(`FastGPT 建库失败：HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: string };
    const kbId = json?.data;
    if (!kbId) {
      throw new Error('FastGPT 建库响应缺少 datasetId');
    }
    return kbId;
  }

  /** JSON + Bearer 头。 */
  private jsonAuthHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.openApiKey}`,
    };
  }
}

/** 朴素匹配：片段与检索词是否共享长度 ≥2 的公共子串（供 mock 检索用）。 */
function naiveMatch(fragment: string, query: string): boolean {
  const frag = fragment.toLowerCase();
  for (let i = 0; i < query.length - 1; i++) {
    const gram = query.slice(i, i + 2).toLowerCase();
    if (gram.trim().length === 2 && frag.includes(gram)) return true;
  }
  return false;
}
