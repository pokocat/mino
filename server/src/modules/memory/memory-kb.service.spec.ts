import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { MemoryKbService } from './memory-kb.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';

// 工厂 mock @mastra/pg（ESM，不能被 jest 直接 require）：PgVector 换成可控构造器。
jest.mock('@mastra/pg', () => ({ PgVector: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PgVector } = require('@mastra/pg') as { PgVector: jest.Mock };

const INDEX = 'mino_memory';

describe('MemoryKbService（真实 pgvector 路径，PgVector 与 embedding 均 mock）', () => {
  let pg: {
    createIndex: jest.Mock;
    upsert: jest.Mock;
    query: jest.Mock;
    deleteVectors: jest.Mock;
    disconnect: jest.Mock;
  };
  let embedding: EmbeddingService;

  function buildConfig(): ConfigService {
    return {
      get: (k: string) =>
        k === 'database.url'
          ? 'postgresql://mino:mino@localhost:5432/mino'
          : undefined,
    } as unknown as ConfigService;
  }
  function buildPrisma(kbId: string | null): PrismaService {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue({ kbId }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
  }

  beforeEach(() => {
    pg = {
      createIndex: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(['vid1']),
      query: jest.fn().mockResolvedValue([]),
      deleteVectors: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    PgVector.mockImplementation(() => pg);
    embedding = {
      embedOne: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      dim: 1024,
    } as unknown as EmbeddingService;
  });

  it('ensureUserKb：kbId 为空 → 建索引 + 回填 pgv_<userId>', async () => {
    const prisma = buildPrisma(null);
    const svc = new MemoryKbService(buildConfig(), prisma, embedding);
    const kbId = await svc.ensureUserKb('user-1');

    expect(kbId).toBe('pgv_user-1');
    expect(pg.createIndex).toHaveBeenCalledWith({
      indexName: INDEX,
      dimension: 1024,
      metric: 'cosine',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kbId: 'pgv_user-1' },
    });
  });

  it('ensureUserKb：已有 kbId → 直接返回、不回填、仍确保索引', async () => {
    const prisma = buildPrisma('pgv_user-1');
    const svc = new MemoryKbService(buildConfig(), prisma, embedding);
    const kbId = await svc.ensureUserKb('user-1');

    expect(kbId).toBe('pgv_user-1');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(pg.createIndex).toHaveBeenCalledTimes(1);
  });

  it('pushText：embed + upsert（metadata 带 userId/title/text）', async () => {
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    await svc.pushText('pgv_user-1', '记忆·标题', '这位老板做宠物殡葬');

    expect(embedding.embedOne).toHaveBeenCalledWith('这位老板做宠物殡葬');
    expect(pg.upsert).toHaveBeenCalledTimes(1);
    const arg = pg.upsert.mock.calls[0][0];
    expect(arg.indexName).toBe(INDEX);
    expect(arg.vectors).toEqual([[0.1, 0.2, 0.3]]);
    expect(arg.metadata[0]).toMatchObject({
      userId: 'user-1',
      title: '记忆·标题',
      text: '这位老板做宠物殡葬',
    });
    expect(typeof arg.metadata[0].createdAt).toBe('string');
  });

  it('pushText：空文本直接返回，不 embed、不 upsert', async () => {
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    await svc.pushText('pgv_user-1', 't', '   ');
    expect(embedding.embedOne).not.toHaveBeenCalled();
    expect(pg.upsert).not.toHaveBeenCalled();
  });

  it('search：embed(query) + query(filter userId) → 命中文本数组', async () => {
    pg.query.mockResolvedValue([
      { id: 'a', score: 0.9, metadata: { userId: 'user-1', text: '要点甲' } },
      { id: 'b', score: 0.8, metadata: { userId: 'user-1', text: '要点乙' } },
      { id: 'c', score: 0.7, metadata: { userId: 'user-1' } }, // 无 text → 过滤
    ]);
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    const hits = await svc.search('pgv_user-1', '宠物殡葬获客', 3);

    expect(hits).toEqual(['要点甲', '要点乙']);
    const arg = pg.query.mock.calls[0][0];
    expect(arg).toMatchObject({
      indexName: INDEX,
      topK: 3,
      filter: { userId: 'user-1' },
    });
    expect(arg.queryVector).toEqual([0.1, 0.2, 0.3]);
  });

  it('search：空 query → 返回空数组，不 embed', async () => {
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    await expect(svc.search('pgv_user-1', '  ', 3)).resolves.toEqual([]);
    expect(embedding.embedOne).not.toHaveBeenCalled();
  });

  it('deleteKb：按 userId 过滤删除全部向量', async () => {
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    await svc.deleteKb('pgv_user-1');
    expect(pg.deleteVectors).toHaveBeenCalledWith({
      indexName: INDEX,
      filter: { userId: 'user-1' },
    });
  });

  it('deleteKb：删除失败吞异常（best-effort，不抛）', async () => {
    pg.deleteVectors.mockRejectedValue(new Error('boom'));
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    await expect(svc.deleteKb('pgv_user-1')).resolves.toBeUndefined();
  });

  it('pushText：embedding 失败向上抛（交队列重试）', async () => {
    (embedding.embedOne as jest.Mock).mockRejectedValue(
      new Error('embed 挂了'),
    );
    const svc = new MemoryKbService(
      buildConfig(),
      buildPrisma('pgv_user-1'),
      embedding,
    );
    await expect(svc.pushText('pgv_user-1', 't', 'x')).rejects.toThrow(
      /embed 挂了/,
    );
  });
});

describe('FastgptKbService 记忆后端选路', () => {
  function cfg(over: Record<string, unknown>): ConfigService {
    return { get: (k: string) => over[k] } as unknown as ConfigService;
  }
  function prisma(): PrismaService {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue({ kbId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
  }
  function fakeMemory() {
    return {
      ensureUserKb: jest.fn().mockResolvedValue('pgv_user-1'),
      pushText: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue(['记住的事']),
      deleteKb: jest.fn().mockResolvedValue(undefined),
    } as unknown as MemoryKbService;
  }

  it('openai + 有 EMBEDDING_API_KEY + 注入 memoryKb → 委托 MemoryKbService', async () => {
    const mem = fakeMemory();
    const svc = new FastgptKbService(
      cfg({ 'llm.provider': 'openai', 'embedding.apiKey': 'sk-x' }),
      prisma(),
      mem,
    );
    await svc.ensureUserKb('user-1');
    await svc.pushText('pgv_user-1', 't', 'x');
    const hits = await svc.search('pgv_user-1', 'q', 3);
    await svc.deleteKb('pgv_user-1');

    expect(mem.ensureUserKb).toHaveBeenCalledWith('user-1');
    expect(mem.pushText).toHaveBeenCalledWith('pgv_user-1', 't', 'x');
    expect(mem.search).toHaveBeenCalledWith('pgv_user-1', 'q', 3);
    expect(mem.deleteKb).toHaveBeenCalledWith('pgv_user-1');
    expect(hits).toEqual(['记住的事']);
  });

  it('openai 但缺 EMBEDDING_API_KEY → 回退内存 mock，不触碰 memoryKb', async () => {
    const mem = fakeMemory();
    const svc = new FastgptKbService(
      cfg({ 'llm.provider': 'openai', 'embedding.apiKey': '' }),
      prisma(),
      mem,
    );
    const kbId = await svc.ensureUserKb('user-1');
    await svc.pushText(kbId, '记忆', '做宠物殡葬');
    const hits = await svc.search(kbId, '宠物殡葬', 3);

    expect(kbId).toBe('mock_kb_user-1'); // 走内存 mock 分支
    expect(hits).toContain('做宠物殡葬');
    expect(mem.pushText).not.toHaveBeenCalled();
    expect(mem.search).not.toHaveBeenCalled();
  });

  it('FASTGPT_MOCK=true → 内存 mock，即便注入 memoryKb 也不委托', async () => {
    const mem = fakeMemory();
    const svc = new FastgptKbService(
      cfg({ 'fastgpt.mock': true, 'llm.provider': 'openai' }),
      prisma(),
      mem,
    );
    const kbId = await svc.ensureUserKb('user-1');
    expect(kbId).toBe('mock_kb_user-1');
    expect(mem.ensureUserKb).not.toHaveBeenCalled();
  });
});
