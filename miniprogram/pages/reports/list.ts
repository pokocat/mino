// 报告库页（tab 根 2）。列表 / 4 类筛选（计数来自 /reports/stats）/ 未读态 /
// 生成中占位 / 下拉刷新 / cursor 分页触底加载。对照 02 屏。
import { listReports, getReportStats, getReport, generateReport } from '../../utils/api';
import type { ReportListItem, ReportStats, ReportType } from '../../utils/api';
import { STORAGE_KEYS } from '../../utils/config';

const PAGE_SIZE = 4; // 每页条数（小页便于演示触底加载）

Page({
  data: {
    activeType: '', // '' | ReportType
    stats: null as ReportStats | null,
    items: [] as ReportListItem[],
    nextCursor: null as string | null,
    loading: false,
    loadingMore: false,
    loadError: false, // 首屏加载失败 → error-retry
    inited: false,
  },

  onShow() {
    const tabBar = this.getTabBar?.() as
      | (WechatMiniprogram.Component.TrivialInstance & { refreshBadge?: () => void })
      | undefined;
    if (tabBar) {
      tabBar.setData({ active: 'reports' });
      tabBar.refreshBadge?.();
    }
    // 我的页宫格跳入时预置类型筛选（storage 传参，消费后立即清除，避免污染后续进入）
    const preset = wx.getStorageSync<string>(STORAGE_KEYS.reportsPresetType);
    if (preset) {
      wx.removeStorageSync(STORAGE_KEYS.reportsPresetType);
      this.setData({ activeType: preset as ReportType, items: [], nextCursor: null });
    }
    // 每次进入刷新：反映详情已读后未读态/角标变化
    this._reload();
  },

  onPullDownRefresh() {
    this._reload(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this._loadMore();
  },

  // 拉计数 + 重置到首页
  _reload(done?: () => void) {
    this.setData({ loading: true, loadError: false });
    Promise.all([
      getReportStats(),
      listReports(this.data.activeType, '', PAGE_SIZE),
    ])
      .then(([stats, res]) => {
        this.setData({
          stats,
          items: res.items,
          nextCursor: res.nextCursor,
          loading: false,
          inited: true,
        });
      })
      .catch(() => {
        // 首屏失败（无既有数据）→ error-retry；已有数据则静默
        this.setData({
          loading: false,
          inited: true,
          loadError: this.data.items.length === 0,
        });
      })
      .then(() => done && done());
  },

  // error-retry 组件重试
  onRetry() {
    this._reload();
  },

  // 失败卡：确认后请军师重写（取源对话，同 type 重新 generate）
  onCardRetry(e: WechatMiniprogram.CustomEvent<{ id: string; type: ReportType }>) {
    const { id, type } = e.detail;
    wx.showModal({
      title: '重写这份报告',
      content: '让军师重新写一份？',
      confirmText: '让军师重写',
      success: (m) => {
        if (!m.confirm) return;
        // 取源对话（失败报告的 sources[0]），同会话同 type 重新生成
        getReport(id)
          .then((d) => {
            const convId = d.sources && d.sources[0] && d.sources[0].conversationId;
            if (!convId) throw new Error('无源对话');
            return generateReport(convId, type);
          })
          .then(() => {
            wx.showToast({ title: '军师重新执笔了', icon: 'none' });
            this._reload();
          })
          .catch(() => {
            /* request 层已 toast */
          });
      },
    });
  },

  // 触底加载下一页（追加）
  _loadMore() {
    if (this.data.loadingMore || !this.data.nextCursor) return;
    this.setData({ loadingMore: true });
    listReports(this.data.activeType, this.data.nextCursor, PAGE_SIZE)
      .then((res) => {
        this.setData({
          items: this.data.items.concat(res.items),
          nextCursor: res.nextCursor,
          loadingMore: false,
        });
      })
      .catch(() => this.setData({ loadingMore: false }));
  },

  // 筛选切换：重置列表
  onFilterChange(e: WechatMiniprogram.CustomEvent<{ type: string }>) {
    const type = e.detail.type as ReportType | '';
    this.setData({ activeType: type, items: [], nextCursor: null });
    this._reload();
  },

  // 点卡进详情（生成中卡不触发本事件——组件已拦截）
  onCardTap(e: WechatMiniprogram.CustomEvent<{ id: string; type: ReportType }>) {
    const { id, type } = e.detail;
    wx.navigateTo({ url: `/pages/reports/detail?id=${id}&type=${type}` });
  },

  // 默认转发文案
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '我的军师报告库——对话产出报告，报告喂养对话。',
      path: '/pages/reports/list',
    };
  },
});
