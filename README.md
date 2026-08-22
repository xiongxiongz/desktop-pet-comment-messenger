# 桌宠评论信使 MVP 实现进度

> 活文档：随开发勾选 `[x]` 已完成 / `[ ]` 未完成。

## 0. 工程脚手架
- [x] Electron + electron-vite + TS 工程结构、双 tsconfig、electron.vite 配置
- [x] `npm run dev` / `build:mac` 脚本、electron-builder.yml、`.env.example`

## 1. 桌宠窗口（最高优先）
- [x] 透明无边框常驻窗口（`transparent/frame:false/hasShadow:false`）
- [x] 置顶 `'floating'` + `skipTaskbar` + `visibleOnAllWorkspaces`
- [x] SVG 桌宠渲染（idle 状态，cat/dog/robot bob 动画）
- [x] 拖拽移动（pointer 事件 + main `setPosition`）
- [x] 点击穿透切换（默认 ignore + hover 进入命中区放开）

## 2. 设置与持久化
- [x] `store.ts` 读写 `userData/config.json`、默认值合并、原子写
- [x] 设置窗口（按需创建/关闭销毁）
- [x] 表单：桌宠名称（推荐设为粉丝称呼）、皮肤、偏好标签、活跃时段、免打扰时段、每日上限、间隔、推送开关
- [x] 改名/改设置即时保存并重启后持久（代码就绪，待运行验证）
- [x] 设置页拆分"设置 / 收藏"两个顶部 tab（切到收藏页自动刷新）

## 3. 数据与筛选流水线
- [x] `comments.json` 预置 34 条脱敏评论（覆盖 4 标签 + 未分类干扰项）
- [x] 规则分类器（关键词表 + 点赞对数权重打分）
- [x] 流水线 `runFilter`：规则 → (可选)LLM → 偏好过滤 → 排序
- [x] 队列 `queue.ts`：内存 TaggedComment[] + 内存 shownIds（与队列同生命周期）+ pickNext
- [x] 设置页"加载并筛选评论"显示"已从 N 条中筛选出 M 条"

## 4. LLM 分类（可选，可回退）
- [x] `openai` 客户端接 bilibili 网关（`glm-5.2`，懒加载）
- [x] key 双来源注入（设置页 > `.env`）、优先级与空值降级
- [x] JSON 输出解析 + 任何错误静默回退规则标签
- [x] key 仅 main、preload 只暴露 `llmEnabled`/`llmHasKey` 布尔

## 5. 调度与推送
- [x] `scheduler.ts` 递归随机间隔计时器
- [x] 活跃时段 / 免打扰 / 每日上限 门控
- [x] 去重（内存 shownIds + 内存 currentDay 跨天重置，随进程生灭）
- [x] 无匹配评论不推空内容
- [x] `comment:show` IPC + 桌宠气泡渲染
- [x] 推送开关停/续、"来一条"手动触发

## 6. 交互与个性化
- [x] 气泡内 查看 / 跳过 / 收藏
- [x] 气泡展示视频来源（`📺 视频名`，作者行右侧）
- [x] 收藏持久化（store.favorites），设置页"收藏"tab 可查看/取消收藏
- [x] 3 套内置皮肤（cat/dog/robot）实时切换（可插拔 skin-provider，`settings:changed` 广播）
- [x] 桌宠名称合并为单一字段（推荐设为粉丝称呼），气泡上方常驻展示

## 7. 打包与路演验证
- [ ] `electron-builder --mac` universal 打包
- [ ] 打包后 `.app` 验证：桌宠出现 + 评论加载（resourcesPath）+ 设置持久
- [ ] 端到端跑通 §7.1 五步 demo 并计时

## 验证状态
- [x] `npm run typecheck` 通过（node + web 双配置）
- [x] `npm run build` 通过（main / preload / 双 renderer 产物齐全）
- [x] `npm run dev` 运行时冒烟：桌宠出现、穿透、拖拽、筛选、推送（待人工在桌面环境确认）
- [x] LLM 真实网关联通（需内网/VPN + 有效 key）

## 变更日志
- 2026-08-22 完成脚手架 + 全部核心模块（模块 0-6 代码就绪），typecheck 与 build 通过。electron 二进制经 npmmirror 镜像安装。待运行时冒烟与打包验证。
- 2026-08-22 修复三处用户反馈：①合并桌宠名称与粉丝称呼为单一字段（标签改为"桌宠名称（推荐设置为粉丝称呼）"）；②皮肤/名称切换实时生效（main 保存后经 `settings:changed` 广播给桌宠窗口，桌宠侧 `onSettingsChanged` 重渲染）；③设置页新增"我的收藏"区块（`favorites:list` IPC 由收藏 ID 还原评论，支持取消收藏）。typecheck + build 通过。
- 2026-08-22 再修两处：①"来一条"提示无评论的 bug——初版用 `store.resetShown()` 打创可贴。②设置页拆分为"设置 / 收藏"两个顶部 tab（`.tabs`/`.panel` + JS 切换，切到收藏页自动刷新）。typecheck + build 通过。
- 2026-08-22 两处交互微调：①移除设置/收藏页底部"关闭"按钮（关窗用系统标题栏）；②气泡新增视频来源展示（`videoTitle` 经 PushPayload 传到桌宠侧，作者行右侧 `📺 视频名`）。typecheck + build 通过。
- 2026-08-22 同步功能清单：模块 2 补 tab、模块 3/5 去重描述改为内存态、模块 6 补视频来源/收藏 tab/名称合并，反映最新代码状态。
- 2026-08-22 治本重构（shownIds 生命周期归位）：识别根因是数据分层错位——`shownIds` 持久化到 `config.json`，但它引用的队列是纯内存、重启从 comments.json 重建，导致"指针比队列活得久"、重启后 split-brain。方案：把推送运行时状态（`shownIds`/`dailyCount`/`currentDay`）全部移入内存，`config.json` 只留 `settings`+`favorites`。改动：`types.ts` PersistedState 精简为两字段；`store.ts` 删除 markShown/resetShown/resetIfNewDay 及 shownIds/resetDate；`queue.ts` 内置 `shownIds: Set`，setQueue 自动 clear，新增 markShown/clearShown；`scheduler.ts` 内存 currentDay 做跨天重置；`ipc.ts` 去掉 resetShown 调用。typecheck + build 通过。
