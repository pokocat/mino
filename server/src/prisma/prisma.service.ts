import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端封装：随 Nest 生命周期建立/断开数据库连接。
 * 通过全局 PrismaModule 导出，供各业务模块直接注入。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma 已连接数据库');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
