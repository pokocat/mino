import { Test, TestingModule } from '@nestjs/testing';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
    user: { update: jest.Mock };
    report: { groupBy: jest.Mock; count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { update: jest.fn() },
      report: { groupBy: jest.fn(), count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [{ provide: PrismaService, useValue: prisma }],
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
    const user = buildUser({ nickname: '阿明', streakDays: 5 });
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
});
