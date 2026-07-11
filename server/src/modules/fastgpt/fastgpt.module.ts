import { Module } from '@nestjs/common';
import { FastgptChatService } from './fastgpt-chat.service';
import { FastgptKbService } from './fastgpt-kb.service';
import { MemoryModule } from '../memory/memory.module';

/** FastGPT 集成模块：米诺对话流（M2）+ 每用户知识库（M3）。报告工作流后续（M4+）加入。 */
@Module({
  // MemoryModule 提供 MemoryKbService：openai 模式下 FastgptKbService 委托给它做真实 pgvector 记忆。
  imports: [MemoryModule],
  providers: [FastgptChatService, FastgptKbService],
  exports: [FastgptChatService, FastgptKbService],
})
export class FastgptModule {}
