// 米诺对话页（tab 根 1）。M2：流式对话 / 历史续聊 / suggestions / reportOffer 占位。
// 性能纪律：流式渲染用独立 data 路径 'streaming.text'（不每 token setData 全量 messages），
// 60ms 节流合并；完成后再把整段落进 messages。
import {
  getMe,
  listConversations,
  createConversation,
  getMessages,
  generateReport,
  commitAppend,
  getReport,
  getReportStats,
  getTodayTask,
  startTask,
} from '../../utils/api';
import type { ChatMessage, SuggestionItem, ReportType, ApiError } from '../../utils/api';
import { ssePost } from '../../utils/sse';
import type { SseEvent, SseTask } from '../../utils/sse';

// 米诺收回消息后的占位文案
const RETRACT_TEXT = '（这段话米诺收回了）';
import { STORAGE_KEYS } from '../../utils/config';
import { requestSubscribe } from '../../utils/subscribe';

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
    // 今日一问卡（GET /tasks/today 填充；show 由 status 控制）
    daily: {
      show: false,
      question: '',
      hint: '',
      estMinutes: 0,
      unread: true, // pending 时脉冲红点
      started: false, // started 时 CTA 变「继续聊 →」
    },
    messages: [] as UiMessage[],
    // 正在生成的米诺气泡（独立路径更新，避免全量 messages setData）
    streaming: { active: false, text: '' },
    typing: false, // 首 token 前的三点 loading
    suggestions: [] as SuggestionItem[],
    input: '',
    sending: false,
    canRetry: false,
    scrollToId: '',
    inited: false,
    // 报告生成弹层
    modalVisible: false,
    modalPhase: 'generating', // 'generating' | 'success'
    modalTopic: '',
    modalType: 'strategy' as ReportType,
  },

  // ---- 内部可变态（非渲染，不进 data）----
  _conversationId: '',
  _task: null as SseTask | null,
  _streamBuf: '', // 流式全文缓冲
  _pendingNote: '', // reportOffer 占位文案，待 done 后插入
  _flushTimer: 0, // 节流定时器句柄
  _seq: 0, // 消息 id 自增
  _lastTopic: '刚才聊的', // 最近一次 reportOffer 话题（供生成弹层文案）
  _genReportId: '', // 正在生成/轮询的报告 id
  _genType: 'strategy' as ReportType,
  _pollTimer: 0, // 轮询定时器句柄
  _pollDeadline: 0, // 轮询截止时刻（60s）
  _dailyTaskId: '', // 今日一问任务 id（供「开始聊」调 start）
  _streakTimer: 0, // 发消息后 streak 延迟刷新定时器句柄
  _lastSent: '', // 最近一次发送内容（米诺拒收 400 时恢复输入供修改）
  _retracted: false, // 当前流式回复是否已被米诺收回（收回后停止追加）

  onShow() {
    // 同步自定义 tabBar 选中态
    const tabBar = this.getTabBar?.() as
      | (WechatMiniprogram.Component.TrivialInstance & { refreshBadge?: () => void })
      | undefined;
    if (tabBar) {
      tabBar.setData({ active: 'chat' });
      tabBar.refreshBadge?.();
    }
    // 今日一问：每次 onShow 拉一次，按 status 决定卡片显隐/文案
    this._refreshDailyTask();

    // 报告详情「跟米诺聊/补充」回流：续该会话
    const pending = wx.getStorageSync(STORAGE_KEYS.pendingConversationId) as string;
    if (pending) {
      wx.removeStorageSync(STORAGE_KEYS.pendingConversationId);
      this._applyConversation(pending);
    } else if (!this.data.inited) {
      this._init();
    } else {
      // 常规返回：刷新报告计数（可能刚生成了新报告）
      this._refreshReportTotal();
    }
  },

  onHide() {
    this._clearPoll();
    if (this._streakTimer) {
      clearTimeout(this._streakTimer);
      this._streakTimer = 0;
    }
  },

  onUnload() {
    this._task?.abort();
    if (this._flushTimer) clearTimeout(this._flushTimer);
    if (this._streakTimer) clearTimeout(this._streakTimer);
    this._clearPoll();
  },

  // 切换到指定会话（报告回流）：清空当前对话态，拉该会话历史
  _applyConversation(convId: string) {
    if (this._conversationId === convId && this.data.inited) return;
    this._task?.abort();
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = 0;
    }
    this._conversationId = convId;
    this.setData({
      inited: true,
      messages: [],
      suggestions: [],
      streaming: { active: false, text: '' },
      typing: false,
      sending: false,
      canRetry: false,
    });
    getMessages(convId)
      .then((msgs) => this._setHistory(msgs))
      .catch(() => {
        /* 静默：无历史即空对话 */
      });
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
          // 首次进入：建会话，随后取服务端预置的米诺开场白
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

  // 今日一问：GET /tasks/today。pending/started 显示卡片，其余（null/done/expired）隐藏。
  _refreshDailyTask() {
    getTodayTask()
      .then((task) => {
        if (task && (task.status === 'pending' || task.status === 'started')) {
          this._dailyTaskId = task.id;
          this.setData({
            daily: {
              show: true,
              question: task.question,
              hint: task.hint,
              estMinutes: task.estMinutes,
              unread: task.status === 'pending', // 脉冲红点仅 pending
              started: task.status === 'started', // CTA「继续聊 →」
            },
          });
        } else {
          this._dailyTaskId = '';
          this.setData({ 'daily.show': false });
        }
      })
      .catch(() => {
        /* 静默：拉取失败即不显示卡片 */
      });
  },

  // 发消息结算后延迟刷新 streak（服务端异步旁路，800ms 后取 /me 内嵌 streakDays）
  _scheduleStreakRefresh() {
    if (this._streakTimer) clearTimeout(this._streakTimer);
    this._streakTimer = setTimeout(() => {
      this._streakTimer = 0;
      getMe()
        .then((me) => this.setData({ streakDays: me.streakDays }))
        .catch(() => {
          /* 静默 */
        });
    }, 800) as unknown as number;
  },

  // 刷新问候区报告计数（接 /reports/stats total）
  _refreshReportTotal() {
    getReportStats()
      .then((s) => this.setData({ reportTotal: s.total }))
      .catch(() => {
        /* 静默 */
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
    this._lastSent = text;
    this._retracted = false;
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
      onDone: (done) => this._finalizeStream(done.messageId),
      onError: (err) => this._onError(err),
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
      this._lastTopic = ev.topic || this._lastTopic;
      if (ev.reportId) {
        // 米诺已主动开写：直接弹层轮询该报告（跳过 generate）
        this._openModalWithId(ev.reportId, ev.reportType, ev.topic);
      } else {
        // 仅提议：待整段回复落定后，插一条系统提示行
        this._pendingNote = `米诺想把「${ev.topic}」整理成一份报告`;
      }
    } else if (ev.type === 'retract') {
      this._onRetract(ev.messageId);
    }
  },

  // 米诺收回某条消息：已落地按 messageId 替换内容；正在流式的那条停止追加并替换
  _onRetract(messageId: string) {
    // 1) 已落地的历史消息：按 id 命中替换
    const idx = this.data.messages.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      this.setData({ [`messages[${idx}].content`]: RETRACT_TEXT });
      return;
    }
    // 2) 正在流式的那条：停止追加，用收回占位替换流式内容
    if (this.data.streaming.active || this.data.typing) {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = 0;
      }
      this._retracted = true; // 后续 token 一律丢弃
      this._streamBuf = RETRACT_TEXT; // finalize 时落此文案
      this.setData({ typing: false, streaming: { active: true, text: RETRACT_TEXT } });
    }
  },

  // 逐 token 追加：写内部缓冲 + 60ms 节流刷新独立路径
  _appendToken(text: string) {
    if (this._retracted) return; // 已被收回：忽略残余 token
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
  // messageId：服务端返回的消息 id，作为 assistant 气泡 id（供后续 retract 精确命中）
  _finalizeStream(messageId?: string) {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = 0;
    }
    const appended: UiMessage[] = [];
    if (this._streamBuf) {
      appended.push({
        id: messageId || `a${++this._seq}`,
        role: 'assistant',
        content: this._streamBuf,
      });
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
    // 发消息 done 后延迟刷新 streak（服务端异步结算）
    this._scheduleStreakRefresh();
  },

  // 出错：丢弃半截流内容。区分米诺拒收（400）与网络/服务异常。
  _onError(err: ApiError) {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = 0;
    }
    this._streamBuf = '';

    // 400「这段话我不能收」：移除刚发出的用户气泡，恢复输入供修改，以米诺气泡展示提示
    if (String(err.code) === '400') {
      const messages = this.data.messages.slice();
      if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
      // 米诺气泡样式展示拒收提示（role=assistant → 墨底左气泡）
      messages.push({
        id: `a${++this._seq}`,
        role: 'assistant',
        content: err.message || '这段话我不能收，换个说法',
      });
      this.setData(
        {
          messages,
          input: this._lastSent, // 恢复原文供修改
          streaming: { active: false, text: '' },
          typing: false,
          sending: false,
          canRetry: false,
        },
        () => this._scrollToBottom()
      );
      return;
    }

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
      // 触发报告生成弹层
      this._startGenerate(item.reportType || 'strategy');
      return;
    }
    if (item.action === 'appendCommit') {
      // 续写会话专属：把补充织进原报告（与 generateReport 互斥，不走生成动线）
      this._startCommitAppend(item.reportId || '', item.reportType || 'resume');
      return;
    }
    // chat 或缺省：作为用户输入直接发送
    const userMsg: UiMessage = { id: `u${++this._seq}`, role: 'user', content: item.text };
    this.setData({ messages: this.data.messages.concat(userMsg), suggestions: [] });
    this._startStream(item.text);
  },

  // ---- 今日一问 CTA（开始聊 / 继续聊）----
  // POST /tasks/:id/start（幂等）→ 切换到返回会话（拉历史，米诺开场提问已在首条）→ 卡片收起。
  onDailyStart() {
    const id = this._dailyTaskId;
    if (!id) return;
    // R4 时机 a：高意愿点，请求订阅消息授权（拒绝静默不阻塞）
    requestSubscribe('dailyStart');
    startTask(id)
      .then((r) => {
        this._applyConversation(r.conversationId);
        this.setData({ 'daily.show': false }); // 卡片收起
        this._dailyTaskId = '';
      })
      .catch(() => {
        /* request 层已 toast */
      });
  },

  // ---- 报告生成弹层 ----

  // 用户点「写报告」suggestion：POST /generate → 弹层 + 轮询
  _startGenerate(type: ReportType) {
    if (!this._conversationId) return;
    // R4 时机 b：生成报告是高意愿点，触发 generate 前请求订阅消息授权
    requestSubscribe('generateReport');
    this.setData({
      modalVisible: true,
      modalPhase: 'generating',
      modalTopic: this._lastTopic,
      modalType: type,
    });
    generateReport(this._conversationId, type)
      .then((r) => {
        this._genReportId = r.reportId;
        this._genType = type;
        this._startPolling();
      })
      .catch(() => this.setData({ modalVisible: false })); // request 层已 toast
  },

  // 用户点「织进报告」suggestion（续写会话）：POST /append/commit → 复用生成弹层轮询该报告
  _startCommitAppend(reportId: string, type: ReportType) {
    if (!reportId || !this._conversationId) return;
    // R4 时机 b：织入产出报告同属高意愿点，触发前请求订阅消息授权
    requestSubscribe('generateReport');
    // 清续写会话的气泡，避免重复点击
    this.setData({
      suggestions: [],
      modalVisible: true,
      modalPhase: 'generating',
      modalTopic: this._lastTopic,
      modalType: type,
    });
    commitAppend(reportId, this._conversationId)
      .then((r) => {
        // 织入后 reportId 即原报告；轮询其详情等 ready（正文/来源已更新）
        this._genReportId = r.reportId;
        this._genType = type;
        this._startPolling();
      })
      .catch(() => this.setData({ modalVisible: false })); // request 层已 toast
  },

  // 米诺已开写（offer 带 reportId）：跳过 generate，直接弹层轮询
  _openModalWithId(reportId: string, type: ReportType, topic: string) {
    this._genReportId = reportId;
    this._genType = type;
    this.setData({
      modalVisible: true,
      modalPhase: 'generating',
      modalTopic: topic || this._lastTopic,
      modalType: type,
    });
    this._startPolling();
  },

  // 每 2s 轮询 GET /reports/:id；ready→成功态；60s 未完→收起并 toast
  _startPolling() {
    this._pollDeadline = Date.now() + 60000;
    this._poll();
  },
  _poll() {
    this._pollTimer = setTimeout(() => {
      this._pollTimer = 0;
      getReport(this._genReportId)
        .then((r) => {
          if (r.status === 'ready') {
            this.setData({ modalPhase: 'success' });
            this._refreshReportTotal();
          } else if (Date.now() >= this._pollDeadline) {
            this._timeoutModal();
          } else {
            this._poll();
          }
        })
        .catch(() => {
          if (Date.now() >= this._pollDeadline) this._timeoutModal();
          else this._poll();
        });
    }, 2000) as unknown as number;
  },
  _timeoutModal() {
    this._clearPoll();
    this.setData({ modalVisible: false });
    wx.showToast({ title: '米诺还在写，稍后去报告库看', icon: 'none' });
  },
  _clearPoll() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = 0;
    }
  },

  // 弹层收起（蒙层/关闭/继续聊）：停轮询，后台继续生成
  onModalClose() {
    this._clearPoll();
    this.setData({ modalVisible: false });
  },
  // 查看报告：跳详情
  onModalView() {
    const id = this._genReportId;
    const type = this._genType;
    this._clearPoll();
    this.setData({ modalVisible: false });
    wx.navigateTo({ url: `/pages/reports/detail?id=${id}&type=${type}` });
  },

  // 默认转发文案（右上菜单/长按转发）
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '我在米诺战略参谋部跟米诺聊生意，越聊他越懂我。',
      path: '/pages/chat/chat',
    };
  },

  // 滚动到底部锚点：置空再赋值以强制触发 scroll-into-view
  _scrollToBottom() {
    this.setData({ scrollToId: '' }, () => {
      this.setData({ scrollToId: 'bottomAnchor' });
    });
  },
});
