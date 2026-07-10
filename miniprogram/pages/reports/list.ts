// 报告库页（tab 根 2）。M1 只做空态骨架；M4 实现列表 / 4 类筛选 / 未读态。
Page({
  onShow() {
    const tabBar = this.getTabBar?.();
    if (tabBar) {
      tabBar.setData({ active: 'reports' });
    }
  },
});
