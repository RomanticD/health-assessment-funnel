# Screenshot evidence

参考竞品图放在 `../references/`。本目录的验收截图由 `tests/e2e/funnel.spec.ts` 在本地 Supabase + Chromium 中生成，使用合成答案，不包含 session token 或 Cookie：

- `landing-desktop.png` / `landing-mobile.png`
- `question-mobile.png`
- `result-preview-mobile.png`
- `paywall-dialog-mobile.png`
- `paywall-test-route.png` / `paywall-test-route-desktop.png`（固定 Mock paywall 调试 URL，移动与桌面）
- `result-full-mobile.png` / `result-full-desktop.png`

同一测试也会把截图作为 GitHub Actions artifact 上传，便于复核。

评审时可直接从公网链接复现以下画面：

1. Landing：全宽 header 与 values strip。
2. Question：统一编号/indicator、按压反馈和按钮内 saving 状态。
3. Result preview：BMI scale、免费 preview、底部固定的 `DEMO CHECKOUT · $0` paywall。
4. Upgrade dialog：无卡、无扣款、无续期的模拟 checkout。
5. Full result：energy rows、渐变面积图、Goal 标签和 reduced-motion 降级。
