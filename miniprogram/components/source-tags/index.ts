// source-tags：溯源标签行。
// 「源自 XX 对话」+（多段时）「N 段织成」+（meta.kbSynced 时）「存入知识库」。
// 标识符英文、注释中文。
import type { ReportSource } from '../../utils/api';

interface Tag {
  text: string;
  gold: boolean; // 描金底（存入知识库）/ 普通弱底
}

Component({
  options: { addGlobalClass: true },
  properties: {
    sources: { type: Array, value: [] as ReportSource[], observer: 'refresh' },
    kbSynced: { type: Boolean, value: false, observer: 'refresh' },
  },
  data: { tags: [] as Tag[] },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const sources = (this.data.sources as ReportSource[]) || [];
      const tags: Tag[] = [];
      if (sources.length > 0) {
        tags.push({ text: `源自${sources[0].title}`, gold: false });
      }
      if (sources.length > 1) {
        tags.push({ text: `${sources.length} 段织成`, gold: false });
      }
      if (this.data.kbSynced) {
        tags.push({ text: '存入知识库', gold: true });
      }
      this.setData({ tags });
    },
  },
});
