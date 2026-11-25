# 纪念站 · F3 基础布局决定

PR #32，审查版本 `9f665933a2833a7407020825f1d530ffd5460bf3`，派发基线 `2ea692d83d2ee6948a0e1512337fac909c660bfc`。

| 决定与理由 | 回退方式 |
| --- | --- |
| 当测试 Preview 或本地开发的匿名批准投影为空时，首页显示样片，时间线显示样片与虚构日记，让空站可以验收版式。已有批准条目时，时间线仅显示公开投影。生产在投影为空时显示「暂无公开内容。」 | 移除首页的样片分支和时间线的样本分支，让时间线直接调用 `readPublishedTimeline()`，再删除 `src/features/public/sample-content.ts` 和 `src/features/public/sample-photo.tsx`。 |
| 样片通过 `/timeline/sample-photo/[photo]` 提供。路由按固定名称读取本地文件，在 `diagnosticsEnabled()` 为假或名称未知时返回 404，所有响应均带 `Cache-Control: private, no-store`。这样可以直接验收图片加载，并限制样片字节的公开访问与缓存。 | 移除样片引用后，删除 `src/app/timeline/sample-photo/[photo]/route.ts`。 |
| 选用三张由拍摄者在 Wikimedia Commons 以 CC0 1.0 发布的猫照。缩放并转为 WebP，移除原始元数据，以降低页面传输量并避免携带原始拍摄信息。来源见 `src/features/public/photos/README.md`。 | 移除样片引用和路由后，删除 `src/features/public/photos/` 中的 WebP 和来源说明。 |
| 登录后的 `/maintain` 在测试 Preview 和本地开发显示「投稿待办」，即使 `intake.json` 的交付标志为 `false`，也能从维护首页进入现有样本流程。生产根据既有交付标志显示入口。 | 从 `src/app/maintain/page.tsx` 的导航筛选移除 `diagnostics && path === "/maintain/intake"` 分支，恢复只按 `flag.delivered` 筛选。 |

如完整撤掉样本展示，同步移除本次新增的样本专用断言，并保留既有匿名投影、登录与交付验收。
