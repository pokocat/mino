import { Module } from '@nestjs/common';
import { WxModule } from '../wx/wx.module';
import { WxSecService } from './wx-sec.service';

/**
 * 内容安全模块（M6 · R7）：微信 msgSecCheck 文本审核（用户输入 + LLM 输出 + 报告正文）。
 * WxSecService 供 ChatModule（发消息入口审输入、流后审 assistant 全文）与
 * QueueModule（报告 ready 前审 bodyMd）注入；access_token 复用 WxModule 共享服务。
 */
@Module({
  imports: [WxModule],
  providers: [WxSecService],
  exports: [WxSecService],
})
export class SafetyModule {}
