import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService, WxLoginResult } from './auth.service';
import { WxLoginDto } from './dto/wx-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 微信登录：code2session → upsert 用户 → 签发 JWT。 */
  @Post('wx-login')
  @HttpCode(HttpStatus.OK)
  async wxLogin(@Body() dto: WxLoginDto): Promise<WxLoginResult> {
    return this.authService.wxLogin(dto.code);
  }
}
