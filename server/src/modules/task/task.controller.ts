import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TaskService, TodayTaskView } from './task.service';

/**
 * 任务路由（M5 · 与小程序代理硬契约）：
 *  GET  /tasks/today      → {id, question, hint, estMinutes, status} | null（无任务/已过期；当日无任务惰性生成）
 *  POST /tasks/:id/start  → {conversationId}（鉴权+归属；幂等）
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** 今日一问（无则 null；当日无任务时惰性生成）。 */
  @Get('today')
  today(@CurrentUser() user: User): Promise<TodayTaskView | null> {
    return this.taskService.getToday(user.id);
  }

  /** 开始聊：建会话注入 promptSeed 开场，task→started，返回 conversationId。 */
  @Post(':id/start')
  start(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ conversationId: string }> {
    return this.taskService.start(user.id, id);
  }
}
