import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /conversations/:id/messages 请求体。 */
export class CreateMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'content 不能为空' })
  @MaxLength(4000, { message: 'content 过长' })
  content!: string;
}
