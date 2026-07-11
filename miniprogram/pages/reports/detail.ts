// 报告详情页（二级页，type 驱动双版式）。对照 03（结构化）/ 04（自传体）屏。
// 头部 + md-report 正文 + 米诺批注 + 溯源标签 + 底部操作条；onShow 未读 → POST /read。
import {
  getReport,
  markReportRead,
  chatFromReport,
  appendReport,
  exportReport,
} from '../../utils/api';
import type { ReportDetail, ReportType, ApiError } from '../../utils/api';
import { STORAGE_KEYS } from '../../utils/config';
import { renderShareCard } from '../../utils/share-card';

const TYPE_LABELS: Record<ReportType, string> = {
  strategy: '战略分析',
  resume: '创业履历',
  review: '复盘战报',
  decision: '决策记录',
};
const ORIGIN_LABEL: Record<'user' | 'agent', string> = {
  user: '我请米诺写的',
  agent: '米诺执笔',
};
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

Page({
  data: {
    id: '',
    loading: true,
    loadError: false, // 首屏网络错误 → error-retry 组件
    report: null as ReportDetail | null,
    // 派生渲染字段
    navTitle: '报告',
    narrative: false,
    chipSuffix: '',
    originLabel: '',
    dateLabel: '',
    primaryText: '跟米诺聊这份报告',
    secondaryIcons: ['export'] as string[], // 副按钮图标序列（resume 双按钮：✎ + ↧）
    exporting: false, // 分享图导出中（防抖）
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
    this.setData({ loading: true, loadError: false });
    getReport(id)
      .then((r) => {
        const narrative = r.type === 'resume';
        this.setData({
          loading: false,
          report: r,
          navTitle: TYPE_LABELS[r.type] || '报告',
          narrative,
          chipSuffix: narrative && r.sequenceNo ? `· 第${cn(r.sequenceNo)}篇` : '',
          originLabel: ORIGIN_LABEL[r.origin] || '米诺执笔',
          dateLabel: formatDate(r.createdAt),
          primaryText: narrative ? '跟米诺补充这一篇' : '跟米诺聊这份报告',
          // resume 并列 ✎ 补充 + ↧ 导出；其余三类仅 ↧ 导出
          secondaryIcons: narrative ? ['edit', 'export'] : ['export'],
        });
        // 未读 → 标记已读（消除报告库「米诺刚写好」描边）
        if (r.status === 'ready' && !r.isRead) {
          markReportRead(id).catch(() => {
            /* 静默 */
          });
        }
      })
      .catch((err: ApiError) => {
        // 404/403：报告已删除或无权访问 → toast + 返回；其余按网络错误显示重试
        const code = String(err && err.code);
        if (code.indexOf('404') >= 0 || code.indexOf('403') >= 0) {
          wx.showToast({ title: '这份报告不在了', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 800);
          return;
        }
        this.setData({ loading: false, loadError: true });
      });
  },

  // error-retry 组件重试
  onRetry() {
    this._load(this.data.id);
  },

  onBack() {
    wx.navigateBack();
  },

  // 转发分享（nav 右上 button open-type="share" 触发此回调）
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const r = this.data.report;
    return {
      title: r ? r.title : '米诺战略参谋部 · 米诺报告',
      path: `/pages/reports/detail?id=${this.data.id}&type=${r ? r.type : 'strategy'}`,
    };
  },

  // 主按钮：resume（自传体）=「跟米诺补充这一篇」走续写动线；其余=常规「跟米诺聊这份报告」
  onPrimary() {
    if (this.data.narrative) {
      this._appendThisReport();
    } else {
      this._chatThisReport();
    }
  },

  // 副按钮：✎ 补充（走续写动线）/ ↧ 导出分享图；按 e.detail.icon 区分
  onSecondary(e: WechatMiniprogram.CustomEvent<{ icon: string }>) {
    if (e.detail && e.detail.icon === 'edit') {
      this._appendThisReport();
    } else {
      this._exportShare();
    }
  },

  // 常规跟聊：POST /reports/:id/chat 建/续会话 → 回流 chat 页续该会话
  _chatThisReport() {
    chatFromReport(this.data.id)
      .then((r) => this._gotoChatConversation(r.conversationId))
      .catch(() => {
        /* request 层已 toast */
      });
  },

  // 续写补充：POST /reports/:id/append 建续写会话（开场已引用报告标题）→ 复用同一回流机制续该会话
  _appendThisReport() {
    appendReport(this.data.id)
      .then((r) => this._gotoChatConversation(r.conversationId))
      .catch(() => {
        /* request 层已 toast */
      });
  },

  // 暂存目标会话 id（chat 页 onShow 检查此键并续该会话），切回对话 tab
  _gotoChatConversation(conversationId: string) {
    wx.setStorageSync(STORAGE_KEYS.pendingConversationId, conversationId);
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  // 导出分享图：GET export → 绘制宣纸风长图 → 操作面板（保存相册 / 发送给朋友）
  _exportShare() {
    if (this.data.exporting) return;
    const id = this.data.id;
    this.setData({ exporting: true });
    wx.showLoading({ title: '米诺落笔中…', mask: true });
    exportReport(id)
      .then((data) => renderShareCard(this, '#shareCanvas', data))
      .then((tempFilePath) => {
        wx.hideLoading();
        this.setData({ exporting: false });
        this._showShareActions(tempFilePath);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ exporting: false });
        wx.showToast({ title: '导出没成，稍后再试', icon: 'none' });
      });
  },

  // 操作面板：保存到相册 / 发送给朋友
  _showShareActions(tempFilePath: string) {
    wx.showActionSheet({
      itemList: ['保存到相册', '发送给朋友'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this._saveToAlbum(tempFilePath);
        } else {
          // 小程序无法直接拉起图片转发：如实引导用户预览后长按转发
          wx.previewImage({
            urls: [tempFilePath],
            success: () =>
              wx.showToast({ title: '长按图片可发送给朋友', icon: 'none' }),
          });
        }
      },
    });
  },

  // 保存到相册；授权拒绝时引导去设置页开启
  _saveToAlbum(tempFilePath: string) {
    wx.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => wx.showToast({ title: '已存到相册', icon: 'success' }),
      fail: (e) => {
        // 用户拒绝相册授权：引导去设置页
        if (String(e.errMsg).indexOf('auth') >= 0 || String(e.errMsg).indexOf('deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存分享图需要你授权相册，去设置里开启一下？',
            confirmText: '去设置',
            success: (m) => {
              if (m.confirm) wx.openSetting();
            },
          });
        }
      },
    });
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
