// 「我的」页（tab 根 3）。自上而下：身份头卡 / streak 里程卡 / 报告战绩宫格 /
// 我的画像卡 / 设置分组。数据来自 GET /me（含 createdAt、streakDays）+ GET /reports/stats。
// 沿用 07 屏视觉体系（深墨大卡 / 宫格 tile / 行分组），只用 V3 真实数据，无段位/里程碑。
import { getMe, getReportStats, deleteMe } from '../../utils/api';
import type { UserProfile, ReportStats, ReportType } from '../../utils/api';
import { clearToken } from '../../utils/request';
import { config, STORAGE_KEYS } from '../../utils/config';
import { requestSubscribe } from '../../utils/subscribe';

// 四类报告的宫格元信息（label + 类型 class，颜色由 wxss 类型色变量给）
const TYPE_META: { type: ReportType; label: string }[] = [
  { type: 'strategy', label: '战略分析' },
  { type: 'resume', label: '创业履历' },
  { type: 'review', label: '复盘战报' },
  { type: 'decision', label: '决策记录' },
];

// 宫格单元
interface GridCell {
  type: ReportType;
  label: string;
  count: number;
}

Page({
  data: {
    inited: false,
    // 身份
    nickname: '',
    avatarText: '客', // 昵称首字，无昵称用「客」
    industry: '',
    bizNote: '',
    companionDays: -1, // 相伴天数；-1 表示无 createdAt，隐藏该行
    // streak
    streakDays: 0,
    // 报告
    reportTotal: 0,
    reportUnread: 0,
    grid: [] as GridCell[],
    // 设置
    version: 'v0.1.0',
    // 删除账号二次确认弹层
    deleteModalVisible: false,
    deleteInput: '',
  },

  onShow() {
    const tabBar = this.getTabBar?.() as
      | (WechatMiniprogram.Component.TrivialInstance & { refreshBadge?: () => void })
      | undefined;
    if (tabBar) {
      tabBar.setData({ active: 'me' });
      tabBar.refreshBadge?.();
    }
    this._load();
  },

  // 拉取用户信息 + 报告统计，填充各模块
  _load() {
    Promise.all([getMe(), getReportStats()])
      .then(([me, stats]) => {
        this._apply(me, stats);
      })
      .catch(() => {
        // request 层已统一 toast；保留既有数据
        this.setData({ inited: true });
      });
  },

  _apply(me: UserProfile, stats: ReportStats) {
    const nickname = (me.nickname || '').trim();
    const avatarText = nickname ? nickname.slice(0, 1) : '客';
    const grid: GridCell[] = TYPE_META.map((m) => ({
      type: m.type,
      label: m.label,
      count: stats.byType[m.type] || 0,
    }));
    this.setData({
      inited: true,
      nickname,
      avatarText,
      industry: (me.industry || '').trim(),
      bizNote: (me.bizNote || '').trim(),
      companionDays: this._companionDays(me.createdAt),
      streakDays: me.streakDays || 0,
      reportTotal: stats.total,
      reportUnread: stats.unread,
      grid,
    });
  },

  // 相伴天数 = floor((now - createdAt)/一天)+1；无 createdAt 返回 -1（隐藏该行）
  _companionDays(createdAt?: string): number {
    if (!createdAt) return -1;
    const start = new Date(createdAt).getTime();
    if (!start || Number.isNaN(start)) return -1;
    const diff = Date.now() - start;
    return Math.floor(diff / 86400000) + 1;
  },

  // streak=0 时 CTA「去聊 →」：切到军师对话
  onGoChat() {
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  // 点宫格 → 预置类型筛选并跳报告库（storage 传参，reports/list onShow 消费）
  onGridTap(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as ReportType;
    wx.setStorageSync(STORAGE_KEYS.reportsPresetType, type);
    wx.switchTab({ url: '/pages/reports/list' });
  },

  // 改一改 → 画像编辑轻页
  onEditProfile() {
    wx.navigateTo({ url: '/pages/me/profile-edit' });
  },

  // 通知提醒：主动请求订阅授权（模板未配置则提示）
  onNotify() {
    const tmplIds = config.subscribeTmplIds;
    if (!tmplIds || tmplIds.length === 0) {
      wx.showToast({ title: '模板未配置', icon: 'none' });
      return;
    }
    requestSubscribe('meSettings');
    wx.showToast({ title: '已尝试开启', icon: 'none' });
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?type=agreement' });
  },
  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
  },

  // 退出登录：确认 → 清 token → 回 onboarding
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '退出',
      confirmColor: '#B23A2E',
      success: (m) => {
        if (!m.confirm) return;
        clearToken();
        wx.reLaunch({ url: '/pages/onboarding/onboarding' });
      },
    });
  },

  // 删除账号 · 第一步：警示确认
  onDeleteAccount() {
    wx.showModal({
      title: '删除账号',
      content: '对话与报告将全部删除且不可恢复。确定继续吗？',
      confirmText: '继续删除',
      confirmColor: '#B23A2E',
      success: (m) => {
        if (!m.confirm) return;
        // 第二步：输入「删除」二字二次确认（页内自制弹层）
        this.setData({ deleteModalVisible: true, deleteInput: '' });
      },
    });
  },

  onDeleteInput(e: WechatMiniprogram.Input) {
    this.setData({ deleteInput: e.detail.value });
  },

  onDeleteCancel() {
    this.setData({ deleteModalVisible: false, deleteInput: '' });
  },

  // 删除账号 · 第二步确认：输入需等于「删除」
  onDeleteConfirm() {
    if (this.data.deleteInput.trim() !== '删除') {
      wx.showToast({ title: '请输入「删除」二字', icon: 'none' });
      return;
    }
    deleteMe()
      .then(() => {
        this.setData({ deleteModalVisible: false });
        clearToken();
        wx.reLaunch({ url: '/pages/onboarding/onboarding' });
      })
      .catch(() => {
        // request 层已 toast
      });
  },
});
