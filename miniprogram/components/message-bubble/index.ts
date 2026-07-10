// message-bubble：消息气泡。role 切换配色 / 圆角 / 对齐。
// 军师(assistant)=纸面左侧带印章头像；用户(user)=朱砂右侧白字。
// loading=true 时显示三点跳动气泡（军师侧打字中）。content 支持流式追加。
Component({
  options: { addGlobalClass: true },
  properties: {
    role: { type: String, value: 'assistant' }, // 'assistant' | 'user'
    content: { type: String, value: '' },
    loading: { type: Boolean, value: false }, // 打字中三点动画
  },
});
