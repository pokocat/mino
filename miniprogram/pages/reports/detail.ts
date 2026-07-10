// 报告详情页（二级页，type 驱动双版式）。对照 03（结构化）/ 04（自传体）屏。
// 头部 + md-report 正文 + 军师批注 + 溯源标签 + 底部操作条；onShow 未读 → POST /read。
import { getReport, markReportRead, chatFromReport } from '../../utils/api';
import type { ReportDetail, ReportType } from '../../utils/api';
import { STORAGE_KEYS } from '../../utils/config';

const TYPE_LABELS: Record<ReportType, string> = {
  strategy: '战略分析',
  resume: '创业履历',
  review: '复盘战报',
  decision: '决策记录',
};
const ORIGIN_LABEL: Record<'user' | 'agent', string> = {
  user: '我请军师写的',
  agent: '军师执笔',
};
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

Page({
  data: {
    id: '',
    loading: true,
    report: null as ReportDetail | null,
    // 派生渲染字段
    navTitle: '报告',
    narrative: false,
    chipSuffix: '',
    originLabel: '',
    dateLabel: '',
    primaryText: '跟军师聊这份报告',
    secondaryIcon: 'export',
  },

  onLoad(query: Record<string, string>) {
    const id = query.id || '';
    const type = (query.type as ReportType) || 'strategy';
    // 先按 query.type 铺 nav 标题，避免加载前空白
    this.setData({ id, navTitle: TYPE_LABELS[type] || '报告' });
    this._load(id);
  },

  _load(id: string) {
    if (!id) return;
    getReport(id)
      .then((r) => {
        const narrative = r.type === 'resume';
        this.setData({
          loading: false,
          report: r,
          navTitle: TYPE_LABELS[r.type] || '报告',
          narrative,
          chipSuffix: narrative && r.sequenceNo ? `· 第${cn(r.sequenceNo)}篇` : '',
          originLabel: ORIGIN_LABEL[r.origin] || '军师执笔',
          dateLabel: formatDate(r.createdAt),
          primaryText: narrative ? '跟军师补充这一篇' : '跟军师聊这份报告',
          secondaryIcon: narrative ? 'edit' : 'export',
        });
        // 未读 → 标记已读（消除报告库「军师刚写好」描边）
        if (r.status === 'ready' && !r.isRead) {
          markReportRead(id).catch(() => {
            /* 静默 */
          });
        }
      })
      .catch(() => this.setData({ loading: false }));
  },

  onBack() {
    wx.navigateBack();
  },

  // 分享（本期占位）
  onShare() {
    wx.showToast({ title: '分享将在 M6 上线', icon: 'none' });
  },

  // 主按钮：跟军师聊/补充这份报告 → 建/续会话 → 回对话页
  onPrimary() {
    const id = this.data.id;
    chatFromReport(id)
      .then((r) => {
        // 暂存目标会话 id，chat 页 onShow 检查并续该会话
        wx.setStorageSync(STORAGE_KEYS.pendingConversationId, r.conversationId);
        wx.switchTab({ url: '/pages/chat/chat' });
      })
      .catch(() => {
        /* request 层已 toast */
      });
  },

  // 副按钮：导出/补充（本期占位）
  onSecondary() {
    wx.showToast({ title: '导出将在 M6 上线', icon: 'none' });
  },
});

// 1→一、10→十、11→十一（够用即可，超范围退回数字）
function cn(n: number): string {
  if (n <= 10) return CN_NUM[n] || String(n);
  if (n < 20) return '十' + (n % 10 === 0 ? '' : CN_NUM[n % 10]);
  return String(n);
}

// ISO → 「今天 HH:MM」/「M月D日」
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `今天 ${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
