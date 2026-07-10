import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { WxApiService } from './wx-api.service';

/** 构造一个用户实体（可覆盖字段）。 */
function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    wxOpenid: 'mock_abc',
    wxUnionid: null,
    nickname: null,
    avatarUrl: null,
    industry: null,
    bizNote: null,
    streakDays: 0,
    lastActiveDate: null,
    kbId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { upsert: jest.Mock } };
  let wxApi: { code2Session: jest.Mock };
  let jwt: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { user: { upsert: jest.fn() } };
    wxApi = { code2Session: jest.fn() };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: WxApiService, useValue: wxApi },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('新用户登录：nickname 为空 → isNewUser=true，并签发 token', async () => {
    wxApi.code2Session.mockResolvedValue({ openid: 'mock_new' });
    prisma.user.upsert.mockResolvedValue(
      buildUser({ id: 'u-new', wxOpenid: 'mock_new', nickname: null }),
    );

    const result = await service.wxLogin('code-new');

    expect(wxApi.code2Session).toHaveBeenCalledWith('code-new');
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wxOpenid: 'mock_new' } }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u-new' });
    expect(result).toEqual({ token: 'signed.jwt.token', isNewUser: true });
  });

  it('老用户登录：已填 nickname → isNewUser=false', async () => {
    wxApi.code2Session.mockResolvedValue({
      openid: 'mock_old',
      unionid: 'un-1',
    });
    prisma.user.upsert.mockResolvedValue(
      buildUser({ id: 'u-old', wxOpenid: 'mock_old', nickname: '老王' }),
    );

    const result = await service.wxLogin('code-old');

    expect(result).toEqual({ token: 'signed.jwt.token', isNewUser: false });
  });
});
