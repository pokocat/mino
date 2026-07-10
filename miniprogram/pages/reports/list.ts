// 报告库页（tab 根 2）。列表 / 4 类筛选（计数来自 /reports/stats）/ 未读态 /
// 生成中占位 / 下拉刷新 / cursor 分页触底加载。对照 02 屏。
import { listReports, getReportStats } from '../../utils/api';
import type { ReportListItem, ReportStats, ReportType } from '../../utils/api';

const PAGE_SIZE = 4; // 每页条数（小页便于演示触底加载）

Page({
  data: {
    activeType: '', // '' | ReportType
    stats: null as ReportStats | null,
    items: [] as ReportListItem[],
    nextCursor: null as string | null,
    loading: false,
    loadingMore: false,
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
    this.setData({ loading: true });
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
      .catch(() => this.setData({ loading: false, inited: true }))
      .then(() => done && done());
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
});
