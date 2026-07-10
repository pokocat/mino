import { IsNotEmpty, IsString } from 'class-validator';

/** POST /reports/:id/append/commit 入参：续写会话 id。 */
export class AppendCommitDto {
  @IsString()
  @IsNotEmpty()
  conversationId!: string;
}
