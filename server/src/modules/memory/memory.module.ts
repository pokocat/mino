import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { MemoryKbService } from './memory-kb.service';

/**
 * 每用户记忆模块（Phase 1）：OpenAI 兼容 embedding + pgvector 持久化。
 * 由 FastgptModule 导入，供 FastgptKbService 在 openai 模式下委托。
 * PrismaService/ConfigService 均为全局，无需在此 import。
 */
@Module({
  providers: [EmbeddingService, MemoryKbService],
  exports: [EmbeddingService, MemoryKbService],
})
export class MemoryModule {}
