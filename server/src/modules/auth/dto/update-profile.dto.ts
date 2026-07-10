import { IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /me/profile 请求体（入局三字段）。 */
export class UpdateProfileDto {
  /** 昵称。 */
  @IsString()
  @MaxLength(30)
  nickname!: string;

  /** 行业。 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  industry?: string;

  /** 一句话生意背景。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bizNote?: string;
}
