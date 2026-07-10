import { Module } from '@nestjs/common';
import { FastgptChatService } from './fastgpt-chat.service';
import { FastgptKbService } from './fastgpt-kb.service';

/** FastGPT 集成模块：军师对话流（M2）+ 每用户知识库（M3）。报告工作流后续（M4+）加入。 */
@Module({
  providers: [FastgptChatService, FastgptKbService],
  exports: [FastgptChatService, FastgptKbService],
})
export class FastgptModule {}
