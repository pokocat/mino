// 设计 token 的 JS 常量镜像（供 canvas 绘制取色，wxss 无法在 canvas 内生效）。
// 纪律：此处色值必须与 styles/tokens.wxss 同源同值；改色时两处一起改。
// 仅导出 canvas 分享图会用到的子集。标识符英文、注释中文。

import type { ReportType } from './api';

export const THEME = {
  paper: '#f6f1e5', // --color-paper-start 纸底
  card: '#fbf7ef', // --color-card 卡面 / 批注块底
  ink: '#1f1b16', // --color-ink 正文墨
  inkSecondary: '#574f44', // --color-ink-secondary 次要文字
  inkTertiary: '#6b6256', // --color-ink-tertiary 元信息
  inkFaint: '#9b9384', // --color-ink-faint 最弱元信息
  vermilion: '#b23a2e', // --color-vermilion 朱砂：印章 / 战略色
  gold: '#9a7b3f', // --color-gold 描金：批注竖线 / 履历色
  goldText: '#e8c77a', // --color-gold-text 金字（印章上文字）
  // 报告 4 类型色（与 --color-type-* 同源）
  typeStrategy: '#b23a2e',
  typeResume: '#9a7b3f',
  typeReview: '#3d6fa0',
  typeDecision: '#7a5ba0',
} as const;

// 报告类型 → 章色
export function typeColor(type: ReportType): string {
  switch (type) {
    case 'resume':
      return THEME.typeResume;
    case 'review':
      return THEME.typeReview;
    case 'decision':
      return THEME.typeDecision;
    case 'strategy':
    default:
      return THEME.typeStrategy;
  }
}
