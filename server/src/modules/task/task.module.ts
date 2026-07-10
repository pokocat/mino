import { Module } from '@nestjs/common';
import { FastgptModule } from '../fastgpt/fastgpt.module';
import { PushModule } from '../push/push.module';
import { TaskController } from './task.controller';
import { TaskCron } from './task.cron';
import { TaskService } from './task.service';

/**
 * 任务模块（M5 · 回访）：今日一问 cron 派发（每日 08:30 Asia/Shanghai）+ 订阅消息推送、
 * GET /tasks/today（惰性生成）、POST /tasks/:id/start（建会话，复用报告回流同款机制）。
 */
@Module({
  imports: [FastgptModule, PushModule],
  controllers: [TaskController],
  providers: [TaskService, TaskCron],
  exports: [TaskService],
})
export class TaskModule {}
