// daily-question-card：今日一问·深墨卡。
// 本期为静态占位：数据写死一条示例，show 默认 false（隐藏）；M5 接任务接口后置 show=true。
// bind:start 供页面以 prompt_seed 开场进对话（本期未接任务接口，仅透传 question）。
Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false }, // 隐藏开关，默认隐藏
    question: { type: String, value: '今天想通一件事：你最值钱的一张牌是什么？' },
    hint: { type: String, value: '聊透了，我给你写进《战略分析》。约 3 分钟。' },
    unread: { type: Boolean, value: true }, // 脉冲红点
  },
  methods: {
    onStart() {
      this.triggerEvent('start', { question: this.data.question });
    },
  },
});
