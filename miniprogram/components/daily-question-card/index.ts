// daily-question-card：今日一问·深墨卡。M5 接 GET /tasks/today 数据后由页面控制 show。
// props：question / hint / estMinutes（「约 N 分钟」并入 hint 行）/ unread（脉冲红点，=pending）/
//        started（true 时 CTA 文案变「继续聊 →」，走同一 start 幂等接口续会话）。
// bind:start 供页面触发 start 动线（页面持有 taskId，此处不透传）。
Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false }, // 隐藏开关，默认隐藏
    question: { type: String, value: '' },
    hint: { type: String, value: '' },
    estMinutes: { type: Number, value: 0 }, // 预估时长，>0 时并入 hint 行显示
    unread: { type: Boolean, value: true }, // 脉冲红点（pending 时为 true）
    started: { type: Boolean, value: false }, // 已开聊：CTA 改「继续聊 →」
  },
  methods: {
    onStart() {
      this.triggerEvent('start');
    },
  },
});
