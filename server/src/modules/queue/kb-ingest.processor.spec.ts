import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { KbIngestProcessor, parsePoints } from './kb-ingest.processor';

function buildPrisma(msgs: { role: string; content: string }[]): PrismaService {
  return {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        fastgptChatId: 'chat-1',
      }),
    },
    message: {
      findMany: jest.fn().mockResolvedValue(msgs),
    },
  } as unknown as PrismaService;
}

describe('KbIngestProcessor', () => {
  const data = { conversationId: 'conv-1', messageIds: ['m1', 'm2'] };
  const msgs = [
    { role: 'user', content: '我做宠物殡葬，最怕获客断' },
    { role: 'assistant', content: '兄弟，主要矛盾是获客渠道…' },
  ];

  it('mock 提取出要点 → ensureUserKb + 逐条 pushText', async () => {
    const prisma = buildPrisma(msgs);
    const chat = {
      complete: jest.fn().mockResolvedValue('1. 做宠物殡葬\n2. 最怕获客断'),
    } as unknown as FastgptChatService;
    const kb = {
      ensureUserKb: jest.fn().mockResolvedValue('mock_kb_user-1'),
      pushText: jest.fn().mockResolvedValue(undefined),
    } as unknown as FastgptKbService;

    const processor = new KbIngestProcessor(prisma, chat, kb);
    await processor.process(data);

    expect(kb.ensureUserKb).toHaveBeenCalledWith('user-1');
    expect((kb.pushText as jest.Mock).mock.calls).toHaveLength(2);
    // title 带日期与会话短 id；text 为要点原文
    const [kbId, title, text] = (kb.pushText as jest.Mock).mock.calls[0];
    expect(kbId).toBe('mock_kb_user-1');
    expect(title).toMatch(/记忆·\d{4}-\d{2}-\d{2}·会话conv-1/);
    expect(text).toBe('做宠物殡葬');
  });

  it('提取为 NONE → 跳过写入（不建库、不 pushText）', async () => {
    const prisma = buildPrisma(msgs);
    const chat = {
      complete: jest.fn().mockResolvedValue('NONE'),
    } as unknown as FastgptChatService;
    const kb = {
      ensureUserKb: jest.fn(),
      pushText: jest.fn(),
    } as unknown as FastgptKbService;

    const processor = new KbIngestProcessor(prisma, chat, kb);
    await processor.process(data);

    expect(kb.ensureUserKb).not.toHaveBeenCalled();
    expect(kb.pushText).not.toHaveBeenCalled();
  });

  describe('parsePoints', () => {
    it('NONE / 空 → 空数组', () => {
      expect(parsePoints('NONE')).toEqual([]);
      expect(parsePoints('  none ')).toEqual([]);
      expect(parsePoints('')).toEqual([]);
    });
    it('去序号、去空行、最多 3 条', () => {
      expect(parsePoints('1. 甲\n2、乙\n- 丙\n* 丁')).toEqual([
        '甲',
        '乙',
        '丙',
      ]);
    });
  });
});
