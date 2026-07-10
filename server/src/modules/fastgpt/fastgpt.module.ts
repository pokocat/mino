import { Module } from '@nestjs/common';
import { FastgptChatService } from './fastgpt-chat.service';

/** FastGPT 集成模块：军师对话流（M2）；知识库/报告工作流后续（M3+）加入。 */
@Module({
  providers: [FastgptChatService],
  exports: [FastgptChatService],
})
export class FastgptModule {}
