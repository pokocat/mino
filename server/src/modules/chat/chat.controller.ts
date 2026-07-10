import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService, SseEvent } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';

/** 结构化事件 → SSE 线协议帧（帧以 \n\n 分隔，与小程序代理硬契约一字不差）。 */
function serializeSse(evt: SseEvent): string {
  return `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
}

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** 新建会话。 */
  @Post()
  async create(@CurrentUser() user: User) {
    return this.chatService.createConversation(user.id);
  }

  /** 会话列表。 */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.chatService.listConversations(user.id, limit);
  }

  /** 历史消息（校验归属）。 */
  @Get(':id/messages')
  async messages(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chatService.getMessages(user.id, id);
  }

  /**
   * 发消息 → SSE 流式回复。
   * 先校验归属（失败走 JSON 403，尚未写响应头），再切换到 event-stream 流式输出。
   */
  @Post(':id/messages')
  async sendMessage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    // 归属校验在写响应头之前完成，非法访问统一走全局异常过滤器（JSON 403）
    const conv = await this.chatService.getOwnedConversation(user.id, id);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    for await (const evt of this.chatService.streamReply(conv, dto.content)) {
      res.write(serializeSse(evt));
    }
    res.end();
  }
}
