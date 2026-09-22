# CI 与线上证据

## CI

- Workflow：`.github/workflows/ci.yml`
- 本次发布 run：[#35732889517](https://github.com/RomanticD/health-assessment-funnel/actions/runs/35732889517)（commit `fcb8adc06ca403a7cb951ea954a336e3faeace99`）
- Quality job：format、lint、typecheck、unit coverage、production build
- Integration/E2E job：Supabase stack、migration、HTTP 集成和 Chromium 全流程
- GitHub Actions 页面：https://github.com/RomanticD/health-assessment-funnel/actions

每次关键代码变更都先本地运行对应门禁，再 commit/push；最终以 GitHub Actions 的绿色 run 为远端证据。

## Vercel / Supabase

- URL：https://health-assessment-funnel.vercel.app
- `/api/health` 返回 `status: "ok"`、`service: "health-assessment-funnel"`、当前 release commit
- `/api/health` 在验收时返回 `status: "ok"`；`release` 字段为当前 Vercel 部署 commit，随每次推送动态更新。
- Supabase project ref：`kfyqgzuatywmsuruwsei`
- 远端 migration：`20260922002212_initial_health_assessment_schema`、`20260922015929_expanded_funnel_answers`
- 远端业务表启用 RLS；浏览器只通过 Next server routes 访问 RPC

## 发布后 smoke

1. `GET /api/health`
2. 新 session → assessment → 15 题保存 → submit
3. 结果读取为 preview，递归确认不存在受保护字段
4. `/pay` 同 key replay，再读取为 full
5. paid fixture 只读 full；写入请求被 `demo_readonly` RPC 拒绝

当前只读 fixture：`sessionId=Cm4dsRc3ybdSeNc3CPYuHVumgLi4HLQ6lnWy_s0eOAY`，`assessmentId=2378aded-3fab-4ed5-a958-ac73d09dddad`，有效期至 `2026-10-22T11:46:35Z`。Supabase 查询确认其 `app_users.kind=demo_readonly`；线上 Playwright smoke 确认 full read 成功，create/step/submit/pay 写入均返回 `403 DEMO_SESSION_READ_ONLY`。

此前 README 使用的 7 天 `standard` fixture 已在 Supabase 撤销 session；旧凭证线上返回 `401 SESSION_EXPIRED`，不再具备读写能力。这样 Git 历史中的旧公开凭证也不会继续污染可演示数据。

若轮换 paid fixture，只更新 README/本目录的合成 session、assessment、expiry，并重新执行上述 smoke；不修改任何 secret。
