// 登录 / 首次入局页（同一页面 mode 切换）。
// login 态：微信登录 + 协议勾选；form 态：昵称/行业/生意背景三字段入局。
import { wxLogin, updateProfile } from '../../utils/api';
import { setToken } from '../../utils/request';

// wx.login 取 code 的 Promise 封装
function getLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new Error('无 code'))),
      fail: (e) => reject(e),
    });
  });
}

Page({
  data: {
    mode: 'login' as 'login' | 'form', // 页面态
    agreed: false, // 协议勾选
    loading: false, // 登录中
    submitting: false, // 入局提交中
    form: {
      // 默认「微信用户」兜底；type="nickname" 输入框会引导用户一键填入微信昵称，也可手改
      nickname: '微信用户',
    },
  },

  // 勾选/取消协议
  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  // 协议 / 隐私：跳静态协议页
  onViewAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?type=agreement' });
  },
  onViewPrivacy() {
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
  },

  // 微信登录
  async onLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并勾选协议', icon: 'none' });
      return;
    }
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const code = await getLoginCode();
      const { token, isNewUser } = await wxLogin(code);
      setToken(token);
      if (isNewUser) {
        // 新用户：切到入局表单
        this.setData({ mode: 'form' });
      } else {
        // 老用户：直接进对话 tab
        wx.switchTab({ url: '/pages/chat/chat' });
      }
    } catch (e) {
      // request 层已统一 toast，此处兜底日志
      console.error('[onboarding] login failed', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 表单输入
  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as keyof typeof this.data.form;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  // 提交入局（仅昵称，缺省用「微信用户」兜底，行业/生意背景后续引导补全）
  async onSubmit() {
    const nickname = this.data.form.nickname.trim() || '微信用户';
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await updateProfile({ nickname });
      wx.switchTab({ url: '/pages/chat/chat' });
    } catch (e) {
      console.error('[onboarding] profile failed', e);
    } finally {
      this.setData({ submitting: false });
    }
  },
});
