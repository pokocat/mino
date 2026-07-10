import { Module } from '@nestjs/common';
import { FastgptModule } from '../fastgpt/fastgpt.module';
import { QueueModule } from '../queue/queue.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * 对话模块（M2 + M3）：建会话、SSE 流式对话、report_ready 标记拦截、suggestions 注入；
 * M3 增：流前检索用户知识库拼装上下文、流后异步入队 kb.ingest。
 */
@Module({
  imports: [FastgptModule, QueueModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
