# AI 协作与否决记录

完整复盘见 [docs/ai-retrospective.md](../../docs/ai-retrospective.md)。本次 P0 复审额外由独立产品 agent 对付费入口、summary 信息架构、URL 边界、选项按压反馈和交付证据做专项审查，结果记录在 [plan/16-p0-product-review.md](../../plan/16-p0-product-review.md)。

关键否决：不接受“先查询完整结果、再在 TypeScript 里删除会员字段”的方案，因为新增嵌套字段、日志或 cache 时容易泄漏；最终使用 preview/full allowlist 和结果 details 分表，并用递归保护字段测试证明非会员拿不到曲线。算法 golden case 也由人工复算后才进入测试。
