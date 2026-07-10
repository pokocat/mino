import { Module } from '@nestjs/common';
import { FastgptModule } from '../fastgpt/fastgpt.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** 对话模块（M2）：建会话、SSE 流式对话、report_ready 标记拦截、suggestions 注入。 */
@Module({
  imports: [FastgptModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
