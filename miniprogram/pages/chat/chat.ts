// 军师对话页（tab 根 1）。M2：流式对话 / 历史续聊 / suggestions / reportOffer 占位。
// 性能纪律：流式渲染用独立 data 路径 'streaming.text'（不每 token setData 全量 messages），
// 60ms 节流合并；完成后再把整段落进 messages。
import {
  getMe,
  listConversations,
  createConversation,
  getMessages,
} from '../../utils/api';
import type { ChatMessage, SuggestionItem } from '../../utils/api';
import { ssePost } from '../../utils/sse';
import type { SseEvent, SseTask } from '../../utils/sse';

// 页面渲染用的消息项（role=system 承载 reportOffer 占位行）
interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

Page({
  data: {
    streakDays: 0,
    reportTotal: 0,
    messages: [] as UiMessage[],
    // 正在生成的军师气泡（独立路径更新，避免全量 messages setData）
    streaming: { active: false, text: '' },
    typing: false, // 首 token 前的三点 loading
    suggestions: [] as SuggestionItem[],
    input: '',
    sending: false,
    canRetry: false,
    scrollToId: '',
    inited: false,
  },

  // ---- 内部可变态（非渲染，不进 data）----
  _conversationId: '',
  _task: null as SseTask | null,
  _streamBuf: '', // 流式全文缓冲
  _pendingNote: '', // reportOffer 占位文案，待 done 后插入
  _flushTimer: 0, // 节流定时器句柄
  _seq: 0, // 消息 id 自增

  onShow() {
    // 同步自定义 tabBar 选中态
    const tabBar = this.getTabBar?.();
    if (tabBar) {
      tabBar.setData({ active: 'chat' });
    }
    if (!this.data.inited) {
      this._init();
    }
  },

  onUnload() {
    this._task?.abort();
    if (this._flushTimer) clearTimeout(this._flushTimer);
  },

  // 首次加载：拉用户信息 + 会话历史（老会话续聊 / 首次自动建会话取开场白）
  _init() {
    this.setData({ inited: true });

    getMe()
      .then((me) => {
        this.setData({
          streakDays: me.streakDays,
          reportTotal: me.reportStats.total,
        });
      })
      .catch(() => {
        /* 静默：问候区退默认值 */
      });

    listConversations(1)
      .then((list) => {
        if (list.length === 0) {
          // 首次进入：建会话，随后取服务端预置的军师开场白
          return createConversation().then((r) => {
            this._conversationId = r.conversationId;
            return getMessages(r.conversationId);
          });
        }
        // 选最近会话：按 lastMessageAt 降序，null（空会话）视为最早排最后（兜底不崩）
        const latest = list.slice().sort((a, b) => {
          const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : -Infinity;
          const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : -Infinity;
          return tb - ta;
        })[0];
        this._conversationId = latest.id;
        return getMessages(latest.id);
      })
      .then((msgs) => this._setHistory(msgs))
      .catch(() => {
        /* 静默：无历史即空对话 */
      });
  },

  // 历史消息 → UiMessage[]
  _setHistory(msgs: ChatMessage[]) {
    const messages: UiMessage[] = msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));
    this.setData({ messages }, () => this._scrollToBottom());
  },

  // ---- 输入 ----
  onInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ input: e.detail.value });
  },

  onSend() {
    const text = this.data.input.trim();
    if (!text || this.data.sending) return;
    // 先上屏用户气泡，再起流
    const userMsg: UiMessage = { id: `u${++this._seq}`, role: 'user', content: text };
    this.setData({ messages: this.data.messages.concat(userMsg), input: '' });
    this._startStream(text);
  },

  // 起一次流式请求（发送 / 重发共用）
  _startStream(text: string) {
    // 清理上一轮流式态
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = 0;
    }
    this._streamBuf = '';
    this._pendingNote = '';
    this.setData({
      sending: true,
      typing: true,
      canRetry: false,
      suggestions: [],
      streaming: { active: false, text: '' },
    });
    this._scrollToBottom();

    this._task = ssePost({
      url: `/conversations/${this._conversationId}/messages`,
      data: { conversationId: this._conversationId, content: text },
      onEvent: (ev) => this._onEvent(ev),
      onDone: () => this._finalizeStream(),
      onError: (err) => this._onError(err.message),
    });
  },

  // ---- SSE 事件 ----
  _onEvent(ev: SseEvent) {
    if (ev.type === 'token') {
      this._appendToken(ev.text);
    } else if (ev.type === 'suggestions') {
      // done 前必有 suggestions（可空）；暂存，done 后随 setData 展示
      this.setData({ suggestions: ev.items });
    } else if (ev.type === 'reportOffer') {
      // 占位：军师提议写报告 → 待整段回复落定后，插一条系统提示行
      this._pendingNote = `军师想把「${ev.topic}」整理成一份报告（报告生成将在 M4 上线）`;
    }
  },

  // 逐 token 追加：写内部缓冲 + 60ms 节流刷新独立路径
  _appendToken(text: string) {
    this._streamBuf += text;
    // 首 token 到达：三点 loading → 流式气泡
    if (this.data.typing) {
      this.setData({ typing: false, 'streaming.active': true });
    }
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = 0;
      this.setData({ 'streaming.text': this._streamBuf });
      this._scrollToBottom();
    }, 60) as unknown as number;
  },

  // 流结束：整段落进 messages，清空流式态，插 reportOffer 占位行
  _finalizeStream() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = 0;
    }
    const appended: UiMessage[] = [];
    if (this._streamBuf) {
      appended.push({ id: `a${++this._seq}`, role: 'assistant', content: this._streamBuf });
    }
    if (this._pendingNote) {
      appended.push({ id: `s${++this._seq}`, role: 'system', content: this._pendingNote });
    }
    this._streamBuf = '';
    this._pendingNote = '';
    this.setData(
      {
        messages: this.data.messages.concat(appended),
        streaming: { active: false, text: '' },
        typing: false,
        sending: false,
      },
      () => this._scrollToBottom()
    );
  },

  // 出错：丢弃半截流内容，显示友好错误气泡并允许重发
  _onError(_msg: string) {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = 0;
    }
    this._streamBuf = '';
    const errMsg: UiMessage = {
      id: `e${++this._seq}`,
      role: 'assistant',
      content: '（连线天机时断了一下）你再说一遍，我在。',
    };
    this.setData(
      {
        messages: this.data.messages.concat(errMsg),
        streaming: { active: false, text: '' },
        typing: false,
        sending: false,
        canRetry: true,
      },
      () => this._scrollToBottom()
    );
  },

  // 重发：移除末尾错误气泡后，用上一条用户内容重起流
  onRetry() {
    if (this.data.sending) return;
    const messages = this.data.messages.slice();
    const last = messages[messages.length - 1];
    if (last && last.id.charAt(0) === 'e') messages.pop();
    // 找最近一条用户消息作为重发内容
    let text = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        text = messages[i].content;
        break;
      }
    }
    if (!text) return;
    this.setData({ messages, canRetry: false });
    this._startStream(text);
  },

  // ---- suggestions 点击 ----
  onSuggestionSelect(e: WechatMiniprogram.CustomEvent<{ item: SuggestionItem }>) {
    const item = e.detail.item;
    if (item.action === 'generateReport') {
      // 本期占位
      wx.showToast({ title: '报告生成将在 M4 上线', icon: 'none' });
      return;
    }
    // chat 或缺省：作为用户输入直接发送
    const userMsg: UiMessage = { id: `u${++this._seq}`, role: 'user', content: item.text };
    this.setData({ messages: this.data.messages.concat(userMsg), suggestions: [] });
    this._startStream(item.text);
  },

  // ---- 今日一问 CTA（本期卡片默认隐藏；触发则以问题开场）----
  onDailyStart(e: WechatMiniprogram.CustomEvent<{ question: string }>) {
    const q = e.detail.question;
    const userMsg: UiMessage = { id: `u${++this._seq}`, role: 'user', content: q };
    this.setData({ messages: this.data.messages.concat(userMsg) });
    this._startStream(q);
  },

  // 滚动到底部锚点：置空再赋值以强制触发 scroll-into-view
  _scrollToBottom() {
    this.setData({ scrollToId: '' }, () => {
      this.setData({ scrollToId: 'bottomAnchor' });
    });
  },
});
