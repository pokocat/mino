// 分享图导出（方案 §11 决策 5：canvas 宣纸风长图）—— canvas 绘制与编排。
// 布局计算（纯函数，可 Node 自测）见 utils/share-card-layout.ts。
// 高度按内容动态累计，宽 750 逻辑像素，导出 scale 2。标识符英文、注释中文。

import type { ExportData, ReportType } from './api';
import { THEME, typeColor } from './theme';
import {
  planCard,
  ordinal,
  CardPlan,
  MeasureFn,
  METRICS,
  SEAL,
  TITLE_SIZE,
  HEADING_SIZE,
  TEXT_SIZE,
  ANNO_SIZE,
  CONTENT_W,
} from './share-card-layout';

const SERIF = "'Noto Serif SC','Songti SC','STSong',serif";
const SANS = "-apple-system,'PingFang SC',sans-serif";

const { PAD_X, TITLE_LH, TEXT_LH, ITEM_INDENT, ANNO_LH, ANNO_PAD } = METRICS;

// canvas 2d 上下文最小接口（小程序 lib 无 DOM CanvasRenderingContext2D 类型）
interface Ctx2D {
  fillStyle: string;
  font: string;
  textAlign: 'left' | 'center' | 'right';
  textBaseline: 'top' | 'middle' | 'alphabetic';
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  fill(): void;
  measureText(text: string): { width: number };
  scale(x: number, y: number): void;
}

// 由 canvas 上下文构造 measure（每次量前设置对应字体）
function makeMeasure(ctx: Ctx2D): MeasureFn {
  return (text, fontSize, opts) => {
    const weight = opts?.weight === 'bold' ? '700' : '400';
    const family = opts?.serif ? SERIF : SANS;
    ctx.font = `${weight} ${fontSize}px ${family}`;
    return ctx.measureText(text).width;
  };
}

// 绘制整张卡（在已按 dpr scale 的上下文上，使用逻辑坐标）
function drawCard(ctx: Ctx2D, plan: CardPlan, data: ExportData): void {
  const c = ctx;
  const color = typeColor(data.type as ReportType); // 报告类型 → 章色

  // 纸底
  c.fillStyle = THEME.paper;
  c.fillRect(0, 0, plan.width, plan.height);

  for (const b of plan.blocks) {
    switch (b.kind) {
      case 'brand': {
        // 朱砂印章方块「势」
        c.fillStyle = THEME.vermilion;
        roundRect(c, PAD_X, b.y, SEAL, SEAL, 8);
        c.fill();
        c.fillStyle = THEME.goldText;
        c.font = `700 40px ${SERIF}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('势', PAD_X + SEAL / 2, b.y + SEAL / 2 + 2);
        // 名号
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.fillStyle = THEME.ink;
        c.font = `700 30px ${SERIF}`;
        c.fillText(data.brand.name, PAD_X + SEAL + 22, b.y + 46);
        break;
      }
      case 'typeLabel': {
        c.fillStyle = color;
        c.font = `700 24px ${SANS}`;
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.fillText(b.label, PAD_X, b.y + 28);
        break;
      }
      case 'title': {
        c.fillStyle = THEME.ink;
        c.font = `700 ${TITLE_SIZE}px ${SERIF}`;
        c.textAlign = 'left';
        b.lines.forEach((ln, i) => {
          c.fillText(ln, PAD_X, b.y + TITLE_SIZE + i * TITLE_LH);
        });
        break;
      }
      case 'meta': {
        c.fillStyle = THEME.inkTertiary;
        c.font = `400 24px ${SANS}`;
        c.fillText(b.text, PAD_X, b.y + 24);
        break;
      }
      case 'heading': {
        // 4px 竖色条 + 衬线小节标题
        c.fillStyle = color;
        c.fillRect(PAD_X, b.y + 6, 8, HEADING_SIZE + 4);
        c.fillStyle = THEME.ink;
        c.font = `700 ${HEADING_SIZE}px ${SERIF}`;
        c.fillText(b.text, PAD_X + 24, b.y + HEADING_SIZE + 4);
        break;
      }
      case 'item': {
        // 壹贰叁序号 + 正文
        c.fillStyle = THEME.vermilion;
        c.font = `700 ${TEXT_SIZE}px ${SERIF}`;
        c.fillText(ordinal(b.index), PAD_X, b.y + TEXT_SIZE);
        c.fillStyle = THEME.ink;
        c.font = `400 ${TEXT_SIZE}px ${SANS}`;
        b.lines.forEach((ln, i) => {
          c.fillText(ln, PAD_X + ITEM_INDENT, b.y + TEXT_SIZE + i * TEXT_LH);
        });
        break;
      }
      case 'text': {
        c.fillStyle = THEME.inkSecondary;
        c.font = `400 ${TEXT_SIZE}px ${SANS}`;
        b.lines.forEach((ln, i) => {
          c.fillText(ln, PAD_X, b.y + TEXT_SIZE + i * TEXT_LH);
        });
        break;
      }
      case 'more': {
        c.fillStyle = THEME.inkFaint;
        c.font = `400 ${TEXT_SIZE}px ${SANS}`;
        c.fillText('……完整报告见小程序', PAD_X, b.y + TEXT_SIZE);
        break;
      }
      case 'annotation': {
        // 卡面底 + 左描金竖线
        c.fillStyle = THEME.card;
        roundRect(c, PAD_X, b.y, CONTENT_W, b.height, 12);
        c.fill();
        c.fillStyle = THEME.gold;
        c.fillRect(PAD_X, b.y, 6, b.height);
        c.fillStyle = THEME.ink;
        c.font = `400 ${ANNO_SIZE}px ${SERIF}`;
        b.lines.forEach((ln, i) => {
          c.fillText(ln, PAD_X + ANNO_PAD, b.y + ANNO_PAD + ANNO_SIZE + i * ANNO_LH);
        });
        break;
      }
      case 'footer': {
        c.fillStyle = THEME.gold;
        c.font = `400 24px ${SERIF}`;
        c.fillText(b.slogan, PAD_X, b.y + 24);
        c.fillStyle = THEME.inkFaint;
        c.font = `400 22px ${SANS}`;
        c.fillText(`${b.brand} · ${b.date}`, PAD_X, b.y + 58);
        break;
      }
      default:
        break;
    }
  }
}

// 圆角矩形路径
function roundRect(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 编排：取隐藏 canvas 节点 → 绘制 → 导出临时文件路径。
// selector 为详情页隐藏 canvas 的 id（如 '#shareCanvas'）。
export function renderShareCard(
  component: WechatMiniprogram.Page.TrivialInstance,
  selector: string,
  data: ExportData
): Promise<string> {
  return new Promise((resolve, reject) => {
    component
      .createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && (res[0].node as WechatMiniprogram.Canvas | undefined);
        if (!node) {
          reject(new Error('canvas 节点未找到'));
          return;
        }
        const canvas = node as unknown as {
          width: number;
          height: number;
          getContext(t: '2d'): Ctx2D;
        };
        const ctx = canvas.getContext('2d');
        const measure = makeMeasure(ctx);
        const plan = planCard(data, measure);
        const dpr = 2; // 导出 scale 2
        canvas.width = plan.width * dpr;
        canvas.height = plan.height * dpr;
        ctx.scale(dpr, dpr);
        drawCard(ctx, plan, data);
        wx.canvasToTempFilePath({
          canvas: node,
          x: 0,
          y: 0,
          width: plan.width,
          height: plan.height,
          destWidth: plan.width * dpr,
          destHeight: plan.height * dpr,
          success: (r) => resolve(r.tempFilePath),
          fail: (e) => reject(new Error(e.errMsg || '导出失败')),
        });
      });
  });
}
