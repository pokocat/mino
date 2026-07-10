import { Test, TestingModule } from '@nestjs/testing';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MeController } from './me.controller';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    wxOpenid: 'mock_abc',
    wxUnionid: null,
    nickname: null,
    avatarUrl: null,
    industry: null,
    bizNote: null,
    streakDays: 3,
    lastActiveDate: null,
    kbId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('MeController', () => {
  let controller: MeController;
  let prisma: {
    user: { update: jest.Mock; deleteMany: jest.Mock };
    report: { groupBy: jest.Mock; count: jest.Mock };
  };
  let kb: { deleteKb: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      report: { groupBy: jest.fn(), count: jest.fn() },
    };
    kb = { deleteKb: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: FastgptKbService, useValue: kb },
      ],
    }).compile();

    controller = module.get<MeController>(MeController);
  });

  it('POST /me/profile 更新昵称/行业/生意背景', async () => {
    const user = buildUser();
    const dto: UpdateProfileDto = {
      nickname: '阿明',
      industry: '餐饮',
      bizNote: '开了家小面馆',
    };
    prisma.user.update.mockResolvedValue(buildUser({ ...dto }));

    const result = await controller.updateProfile(user, dto);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { nickname: '阿明', industry: '餐饮', bizNote: '开了家小面馆' },
    });
    expect(result.nickname).toBe('阿明');
  });

  it('GET /me 聚合报告计数（groupBy → byType/total，count → unread）', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const user = buildUser({ nickname: '阿明', streakDays: 5, createdAt });
    prisma.report.groupBy.mockResolvedValue([
      { type: 'strategy', _count: { _all: 2 } },
      { type: 'review', _count: { _all: 1 } },
    ]);
    prisma.report.count.mockResolvedValue(1);

    const result = await controller.me(user);

    expect(result).toEqual({
      id: 'user-1',
      nickname: '阿明',
      avatarUrl: null,
      industry: null,
      bizNote: null,
      streakDays: 5,
      createdAt: '2026-01-01T00:00:00.000Z', // ISO 8601 字符串，供「相伴 N 天」
      reportStats: {
        total: 3,
        byType: { strategy: 2, resume: 0, review: 1, decision: 0 },
        unread: 1,
      },
    });
  });

  it('GET /me 空数据时报告计数全 0', async () => {
    const user = buildUser({ nickname: '阿明' });
    prisma.report.groupBy.mockResolvedValue([]);
    prisma.report.count.mockResolvedValue(0);

    const result = await controller.me(user);

    expect(result.reportStats).toEqual({
      total: 0,
      byType: { strategy: 0, resume: 0, review: 0, decision: 0 },
      unread: 0,
    });
  });

  it('GET /me/streak 直接读 users.streakDays', () => {
    const user = buildUser({ streakDays: 7 });
    expect(controller.streak(user)).toEqual({ streakDays: 7 });
  });

  it('DELETE /me 有 kbId：先删知识库再级联删用户，返回 {ok:true}', async () => {
    const user = buildUser({ kbId: 'mock_kb_user-1' });
    const result = await controller.deleteAccount(user);

    expect(kb.deleteKb).toHaveBeenCalledWith('mock_kb_user-1');
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('DELETE /me 无 kbId：不调用 deleteKb，仍删用户并返回 {ok:true}', async () => {
    const user = buildUser({ kbId: null });
    const result = await controller.deleteAccount(user);

    expect(kb.deleteKb).not.toHaveBeenCalled();
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('DELETE /me 幂等：用户已不存在（count=0）仍返回 {ok:true}', async () => {
    prisma.user.deleteMany.mockResolvedValue({ count: 0 });
    const user = buildUser({ kbId: null });
    await expect(controller.deleteAccount(user)).resolves.toEqual({ ok: true });
  });
});
