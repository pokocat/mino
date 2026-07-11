import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MINO_SYSTEM_PROMPT } from '../chat/mino-system-prompt';
import { MINO_OPENING, FOLLOWUP_PROMPT } from '../chat/mino-constants';

/** 设置项键名常量（与 settings 表主键一一对应，未来管理后台按这些键编辑）。 */
export const SETTING_KEYS = {
  /** 米诺 system prompt（openai 直连模式注入的首条 system 消息）。 */
  MINO_SYSTEM_PROMPT: 'mino_system_prompt',
  /** 米诺开场白（建会话时落库的首条 assistant 消息）。 */
  MINO_OPENING: 'mino_opening',
  /** 追问 suggestions 生成用的 system 提示词（真实模式）。 */
  FOLLOWUP_PROMPT: 'followup_prompt',
  /** 无 report_ready 标记时，触发「写报告」建议所需的最少用户轮次（回退阈值）。 */
  REPORT_SUGGEST_MIN_TURNS: 'report_suggest_min_turns',
} as const;

/** 代码内置默认值：DB 缺该键时补种、库不可用时回退。 */
const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.MINO_SYSTEM_PROMPT]: MINO_SYSTEM_PROMPT,
  [SETTING_KEYS.MINO_OPENING]: MINO_OPENING,
  [SETTING_KEYS.FOLLOWUP_PROMPT]: FOLLOWUP_PROMPT,
  [SETTING_KEYS.REPORT_SUGGEST_MIN_TURNS]: '3',
};

/**
 * DB 支撑的键值设置存储：启动时补种缺失键并载入内存缓存，运行期从缓存读取（管理后台 set 后即时更新）。
 * 数据库/表未就绪时（首次部署迁移前）只告警、回退到代码默认，绝不阻断启动。
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 先以默认值填满缓存，保证即便 DB 不可用也能正常回答
    for (const [key, value] of Object.entries(DEFAULTS)) {
      this.cache.set(key, value);
    }
    try {
      await this.seedMissing();
      await this.reload();
    } catch (err) {
      this.logger.warn(
        `设置表初始化失败，回退到代码内置默认（迁移未执行？）：${String(err)}`,
      );
    }
  }

  /** 缺失键补种：只在该键不存在时写入默认值，已存在则原样保留（不覆盖管理后台改过的值）。 */
  private async seedMissing(): Promise<void> {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      await this.prisma.setting.upsert({
        where: { key },
        update: {}, // no-op：已存在则不动
        create: { key, value },
      });
    }
  }

  /** 全量重载缓存（管理后台批量改动后可调）。 */
  async reload(): Promise<void> {
    const rows = await this.prisma.setting.findMany();
    for (const row of rows) {
      this.cache.set(row.key, row.value);
    }
  }

  /** 读字符串：缓存优先，缺失回退到代码默认，再无则空串。 */
  getString(key: string): string {
    return this.cache.get(key) ?? DEFAULTS[key] ?? '';
  }

  /** 全量读取：返回每个已知键的当前值（缓存优先，缺失回退代码默认）。供管理后台展示/编辑。 */
  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(DEFAULTS)) {
      result[key] = this.getString(key);
    }
    return result;
  }

  /** 读数字：解析失败回退到给定 fallback。 */
  getNumber(key: string, fallback: number): number {
    const raw = this.getString(key);
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 写设置：落库 + 即时更新缓存（管理后台保存入口）。 */
  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.cache.set(key, value);
  }

  /** 米诺 system prompt。 */
  getSystemPrompt(): string {
    return this.getString(SETTING_KEYS.MINO_SYSTEM_PROMPT);
  }

  /** 写报告建议的回退阈值（用户轮次），默认 3。 */
  getReportMinTurns(): number {
    return this.getNumber(SETTING_KEYS.REPORT_SUGGEST_MIN_TURNS, 3);
  }
}
