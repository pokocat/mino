import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

function buildConfig(over: Record<string, unknown> = {}): ConfigService {
  const base: Record<string, unknown> = {
    'embedding.baseUrl': 'https://api.example.com/v1',
    'embedding.apiKey': 'sk-test',
    'embedding.model': 'BAAI/bge-large-zh-v1.5',
    'embedding.dim': 1024,
    ...over,
  };
  return {
    get: (k: string) => base[k],
  } as unknown as ConfigService;
}

describe('EmbeddingService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('configured：有 key 为 true，空 key 为 false', () => {
    expect(new EmbeddingService(buildConfig()).configured).toBe(true);
    expect(
      new EmbeddingService(buildConfig({ 'embedding.apiKey': '' })).configured,
    ).toBe(false);
  });

  it('embed：POST /embeddings，按 index 排序对齐输入', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.4, 0.5] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new EmbeddingService(buildConfig());
    const out = await svc.embed(['a', 'b']);

    expect(out).toEqual([
      [0.1, 0.2],
      [0.4, 0.5],
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/embeddings');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      model: 'BAAI/bge-large-zh-v1.5',
      input: ['a', 'b'],
    });
  });

  it('embedOne：返回单条向量', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
    }) as unknown as typeof fetch;
    const svc = new EmbeddingService(buildConfig());
    await expect(svc.embedOne('hi')).resolves.toEqual([1, 2, 3]);
  });

  it('embed：空输入直接返回空数组，不发请求', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new EmbeddingService(buildConfig());
    await expect(svc.embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未配置 key：抛错且不发请求', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new EmbeddingService(buildConfig({ 'embedding.apiKey': '' }));
    await expect(svc.embed(['x'])).rejects.toThrow(/EMBEDDING_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 非 2xx：抛错', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    const svc = new EmbeddingService(buildConfig());
    await expect(svc.embed(['x'])).rejects.toThrow(/HTTP 429/);
  });

  it('响应长度与输入不符：抛错', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [1] }] }),
    }) as unknown as typeof fetch;
    const svc = new EmbeddingService(buildConfig());
    await expect(svc.embed(['a', 'b'])).rejects.toThrow(/长度不匹配/);
  });
});
