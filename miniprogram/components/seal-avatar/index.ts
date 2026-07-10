// seal-avatar：印章方形头像。
// variant='marshal' → 朱砂底 + 「势」（军师）；variant='ink' → 墨底 + 「师」。
// size 为方块边长（rpx）；字号按边长比例自动推算，可用 text 覆盖默认字。
Component({
  options: { addGlobalClass: true },
  properties: {
    variant: { type: String, value: 'marshal', observer: 'refresh' },
    size: { type: Number, value: 100, observer: 'refresh' },
    text: { type: String, value: '', observer: 'refresh' },
  },
  data: {
    displayText: '势',
    fontSize: 56,
  },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const variant = this.data.variant;
      const size = this.data.size;
      const text = this.data.text;
      const fallback = variant === 'ink' ? '师' : '势';
      this.setData({
        displayText: text || fallback,
        fontSize: Math.round(size * 0.56),
      });
    },
  },
});
