# UI 验收说明与截图索引

## 本次 P0 调整

- Header 改为全宽：logo 左、`How it works ↗` 右；底边框贯穿视口。
- `Move with intention · Build your rhythm · Feel more like yourself` 背景条全宽铺开。
- 题目选项使用统一圆形 indicator（加号/箭头/勾选同一中心），点击有下压和内阴影；单选保存立即切换到下一题，网络期间保留忙状态。
- 结果页改为 BetterMe 风格的信息叙事：BMI 横向刻度、个人画像行、能量 editorial rows、宽幅渐变面积曲线与目标标签。
- preview 结果页底部固定显示 `DEMO CHECKOUT · $0` 和解锁入口，内容内仍保留完整 paywall；modal 明确无真实扣款。
- 提供 `/demo/paywall` 固定 Mock 调试路由，无需填写 15 题即可检查 preview → modal → full 的交互。
- 曲线支持绘制动画，`prefers-reduced-motion: reduce` 时直接显示完整图形。

## 参考图（用户提供）

这些文件只作为视觉参考，不是实现指令：

- [question cards](../references/betterme-question-cards.png)
- [wellness profile](../references/betterme-profile.png)
- [plan chart](../references/betterme-plan-chart.png)
- [full-width header](../references/betterme-header.png)

## 实现与证据位置

- Landing / header / values：`src/app/page.tsx`、`src/components/site-header.tsx`、`src/app/studio.css`
- 15 题交互：`src/components/quiz/personal-quiz.tsx`
- preview/paywall/full/chart：`src/components/results/result-experience.tsx`、`src/components/results/demo-paywall-experience.tsx`、`src/components/results/upgrade-dialog.tsx`
- 浏览器验收：`tests/e2e/funnel.spec.ts`（包含固定 Mock paywall URL）

E2E 会写出 `landing-mobile.png`、`question-mobile.png`、`result-mobile.png` 到 Playwright artifact；交付目录保留参考图与验收说明，避免把带 session 的线上截图或 token 写进仓库。
