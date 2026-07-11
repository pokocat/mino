import { IsNotEmpty, IsString } from 'class-validator';

/** PUT /admin/settings 请求体：改一个设置键的值。 */
export class UpdateSettingDto {
  /** 设置键名（须为 SETTING_KEYS 之一，控制器校验，未知键 400）。 */
  @IsString()
  @IsNotEmpty()
  key!: string;

  /** 新值（字符串；数值型设置也以字符串存储）。 */
  @IsString()
  value!: string;
}
