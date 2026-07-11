import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OpenAI 兼容 /embeddings 调用（自写 fetch，不引入 AI SDK）。
 *
 * 约定端点：POST {EMBEDDING_BASE_URL}/embeddings
 *   body: { model, input: string | string[] }
 *   resp: { data: [{ embedding: number[], index }] }
 * 授权：Authorization: Bearer {EMBEDDING_API_KEY}
 *
 * 默认指向 SiliconFlow（https://api.siliconflow.cn/v1）的 BAAI/bge-large-zh-v1.5（1024 维）。
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  // 单次请求超时（ms）。embeddings 通常很快，20s 足够容忍抖动。
  private static readonly TIMEOUT_MS = 20_000;

  constructor(private readonly config: ConfigService) {}

  /** base（去尾斜杠）。 */
  private get baseUrl(): string {
    return (
      this.config.get<string>('embedding.baseUrl') ??
      'https://api.siliconflow.cn/v1'
    ).replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return this.config.get<string>('embedding.apiKey') ?? '';
  }

  private get model(): string {
    return (
      this.config.get<string>('embedding.model') ?? 'BAAI/bge-large-zh-v1.5'
    );
  }

  /** 维度（用于建 index / 一致性校验）。 */
  get dim(): number {
    return this.config.get<number>('embedding.dim') ?? 1024;
  }

  /** 是否已配置可用的 embedding key。 */
  get configured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  /** 单条文本 → 向量。 */
  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    return vec;
  }

  /**
   * 批量文本 → 向量数组（顺序与输入一致）。
   * 失败抛出（调用方按旁路/队列重试处理）。
   */
  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    if (!this.configured) {
      throw new Error('EMBEDDING_API_KEY 未配置，无法向量化');
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      EmbeddingService.TIMEOUT_MS,
    );
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: inputs }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`embeddings 请求失败：${String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`embeddings 失败：HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const data = json?.data;
    if (!Array.isArray(data) || data.length !== inputs.length) {
      throw new Error('embeddings 响应缺少 data 或长度不匹配');
    }
    // 按 index 排序，保证顺序与输入严格对齐（部分供应商乱序返回）。
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => {
      const v = d.embedding;
      if (!Array.isArray(v) || v.length === 0) {
        throw new Error('embeddings 响应含空向量');
      }
      return v;
    });
  }
}
