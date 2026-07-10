// 协议/隐私静态页（非 tab，query type=agreement|privacy）。
// 占位条款（标题 + 分节占位 + 「正式版本以线上发布为准」）。onboarding 链接跳转至此。
type LegalType = 'agreement' | 'privacy';

interface Section {
  heading: string;
  body: string;
}

// 两类静态占位文案（正式版本以线上发布为准）
const CONTENT: Record<LegalType, { title: string; intro: string; sections: Section[] }> = {
  agreement: {
    title: '用户协议',
    intro:
      '欢迎使用米诺战略参谋部。在使用本小程序前，请你阅读并同意以下条款。以下为占位条款，正式版本以线上发布为准。',
    sections: [
      {
        heading: '一 · 服务说明',
        body: '米诺战略参谋部提供基于对话的战略参谋与报告生成服务。军师的回复与报告均由 AI 生成，仅供参考，不构成任何投资、法律或经营决策建议。',
      },
      {
        heading: '二 · 账号与使用',
        body: '你通过微信授权登录使用本服务。你应对账号下的行为负责，不得利用本服务从事违反法律法规或公序良俗的活动。',
      },
      {
        heading: '三 · 内容与知识产权',
        body: '你与军师的对话内容归你所有；报告仅本人可见。你可随时删除自己的报告与对话数据。',
      },
      {
        heading: '四 · 免责与变更',
        body: '因不可抗力或第三方服务导致的服务中断，我们将尽力恢复但不承担由此产生的损失。本协议可能不时更新，更新后继续使用即视为接受。',
      },
    ],
  },
  privacy: {
    title: '隐私政策',
    intro:
      '我们重视你的隐私。本政策说明我们如何收集、使用与保护你的信息。以下为占位条款，正式版本以线上发布为准。',
    sections: [
      {
        heading: '一 · 我们收集的信息',
        body: '为提供服务，我们收集你的微信登录标识、你填写的昵称/行业/生意背景，以及你与军师的对话与生成的报告。',
      },
      {
        heading: '二 · 信息的使用',
        body: '你的信息仅用于生成更懂你的军师回复与报告。对话要点会写入你的专属知识库，检索仅挂在你本人名下，构成隐私边界。',
      },
      {
        heading: '三 · 信息的存储与保护',
        body: '你的报告仅本人可见。我们采取合理的技术与管理措施保护你的数据安全。',
      },
      {
        heading: '四 · 你的权利',
        body: '你可以随时查看、删除自己的报告与对话数据，或注销账号。',
      },
    ],
  },
};

Page({
  data: {
    title: '',
    intro: '',
    sections: [] as Section[],
  },

  onLoad(query: Record<string, string>) {
    const type: LegalType = query.type === 'privacy' ? 'privacy' : 'agreement';
    const c = CONTENT[type];
    this.setData({ title: c.title, intro: c.intro, sections: c.sections });
  },

  onBack() {
    wx.navigateBack();
  },
});
