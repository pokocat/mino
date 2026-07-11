// 画像编辑轻页（非 tab，navigateTo 进入）。复用 onboarding 入局三字段样式与校验，
// 昵称也可改。onLoad 拉当前资料回填；提交 POST /me/profile 后返回，我的页 onShow 自动刷新。
import { getMe, updateProfile } from '../../utils/api';

Page({
  data: {
    loading: true,
    submitting: false,
    form: {
      nickname: '',
      industry: '',
      bizNote: '',
    },
  },

  onLoad() {
    getMe()
      .then((me) => {
        this.setData({
          loading: false,
          form: {
            nickname: me.nickname || '',
            industry: me.industry || '',
            bizNote: me.bizNote || '',
          },
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  onBack() {
    wx.navigateBack();
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as keyof typeof this.data.form;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async onSubmit() {
    const { nickname, industry, bizNote } = this.data.form;
    if (!nickname.trim() || !industry.trim() || !bizNote.trim()) {
      wx.showToast({ title: '三项都填一下，米诺才好认识你', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await updateProfile({
        nickname: nickname.trim(),
        industry: industry.trim(),
        bizNote: bizNote.trim(),
      });
      wx.showToast({ title: '已更新', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
    } catch (e) {
      console.error('[profile-edit] update failed', e);
    } finally {
      this.setData({ submitting: false });
    }
  },
});
