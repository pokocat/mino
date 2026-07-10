import { IsNotEmpty, IsString } from 'class-validator';

/** POST /auth/wx-login 请求体。 */
export class WxLoginDto {
  /** 小程序 wx.login 返回的临时登录凭证。 */
  @IsString()
  @IsNotEmpty()
  code!: string;
}
