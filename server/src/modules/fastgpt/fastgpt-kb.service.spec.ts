import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptKbService } from './fastgpt-kb.service';

/** FASTGPT_MOCK=true 的 config。 */
const mockConfig = {
  get: (k: string) => (k === 'fastgpt.mock' ? true : undefined),
} as unknown as ConfigService;

describe('FastgptKbService（mock 内存实现）', () => {
  function buildPrisma(kbId: string | null): PrismaService {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue({ kbId }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
  }

  it('ensureUserKb：kbId 为空时生成 mock_kb_<userId> 并回填', async () => {
    const prisma = buildPrisma(null);
    const svc = new FastgptKbService(mockConfig, prisma);
    const kbId = await svc.ensureUserKb('user-1');
    expect(kbId).toBe('mock_kb_user-1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kbId: 'mock_kb_user-1' },
    });
  });

  it('ensureUserKb：已有 kbId 时直接返回、不再回填', async () => {
    const prisma = buildPrisma('mock_kb_user-1');
    const svc = new FastgptKbService(mockConfig, prisma);
    const kbId = await svc.ensureUserKb('user-1');
    expect(kbId).toBe('mock_kb_user-1');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('pushText 写入 → search 关键词命中', async () => {
    const svc = new FastgptKbService(mockConfig, buildPrisma('mock_kb_user-1'));
    await svc.ensureUserKb('user-1');
    await svc.pushText('mock_kb_user-1', '记忆', '这位老板做宠物殡葬生意');
    await svc.pushText('mock_kb_user-1', '记忆', '最怕获客渠道断掉');

    const hits = await svc.search('mock_kb_user-1', '宠物殡葬怎么获客', 3);
    expect(hits).toContain('这位老板做宠物殡葬生意');
    expect(hits).toContain('最怕获客渠道断掉');
  });

  it('search：无命中返回空数组', async () => {
    const svc = new FastgptKbService(mockConfig, buildPrisma('mock_kb_user-1'));
    await svc.pushText('mock_kb_user-1', '记忆', '做宠物殡葬');
    const hits = await svc.search('mock_kb_user-1', '完全无关的话题XYZ', 3);
    expect(hits).toEqual([]);
  });
});
