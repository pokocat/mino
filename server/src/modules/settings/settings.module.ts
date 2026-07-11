import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * 设置模块：DB 键值配置存储（米诺 system prompt / 写报告建议阈值等）。
 * 导出 SettingsService 供 ChatModule 等注入；未来管理后台在此模块下挂控制器编辑设置。
 */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
