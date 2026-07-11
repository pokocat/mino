import { IsNotEmpty, IsString } from 'class-validator';

/** POST /admin/login 请求体（后台单账号登录）。 */
export class AdminLoginDto {
  /** 管理员账号（比对 config admin.user）。 */
  @IsString()
  @IsNotEmpty()
  user!: string;

  /** 管理员密码（比对 config admin.pass）。 */
  @IsString()
  @IsNotEmpty()
  pass!: string;
}
