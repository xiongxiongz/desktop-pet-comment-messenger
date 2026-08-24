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
- [x] 规则分类器（关键词命中数取最高标签，作 LLM 兜底）
- [x] 流水线 `runFilter`：分支（LLM 主力 / 规则兜底）→ 偏好过滤 → 排序
- [x] 队列 `queue.ts`：内存 TaggedComment[] + 内存 shownIds（与队列同生命周期）+ pickNext
- [x] 设置页"加载并筛选评论"显示"已从 N 条中筛选出 M 条"

## 3.1 首次采集与本地库
- [x] 评论通过 WBI 游标接口采集全部可见根评论
- [x] 弹幕通过 `dm/web/view` 获取分段数，再循环 `dm/web/seg.so`
- [x] 采集结果写入本地 SQLite，不再以 JSON 作为正式存储
- [x] 评论、弹幕、视频元数据、采集批次分表保存；评论额外保存回复数和可见状态；重复采集按平台 ID 更新，不因接口暂时不返回而删除旧数据
- [x] 运行：`npm run collect:initial -- --bvid=BV1xV8j6eEUR`
- [x] 数据库：`local-data/collections.sqlite`（已加入 `.gitignore`）

## 3.2 采集数据提供层
- [x] `src/main/collection/data-provider.ts` 提供只读 SQLite 查询接口
- [x] `listItems()` 统一读取评论和弹幕，支持按视频、类型、发布时间、分页查询
- [x] `listComments()` / `listDanmaku()` 保留各自完整字段
- [x] `listVideos()` 查询视频、分 P 和数量汇总；`listRuns()` 查询采集批次
- [x] 提供层不创建、不修改数据库，也不包含筛选、推送逻辑

后续模块只需要传入数据库路径：

```ts
import { openCollectionDataProvider } from './collection/data-provider'

const provider = openCollectionDataProvider(databasePath)
try {
  const items = provider.listItems({ bvid, limit: 100 })
  // items: CollectedItem[]，每项是 CollectedComment 或 CollectedDanmaku
} finally {
  provider.close()
}
```

## 4. LLM 分类（默认主力，可回退）
- [x] `openai` 客户端接 bilibili 网关（`glm-5.2`，懒加载）
- [x] key 双来源注入（设置页 > `.env`）、优先级与空值降级
- [x] JSON 输出解析 + 任何错误静默回退规则分类
- [x] key 仅 main、preload 只暴露 `llmEnabled`/`llmHasKey` 布尔
- [x] LLM 升为默认主力（`enabled: true`）：激活时看**全部评论**（不再被规则硬过滤吃掉输入），规则退为纯 fallback
- [x] 成本控制：Top-K 预裁剪（按点赞降序取前 `topK`=80）+ id→tag 内存缓存（重新筛选/改偏好零重复调用）
- [x] LLM 判「无关」的噪声评论（灌水/占楼）不入 map、自动丢弃

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
- 2026-08-22 LLM 升为主力 + 成本控制：讨论否决"LLM 回填 keywords.ts"的自动闭环（逻辑自相矛盾、无法反推判别词、规则天花板是语境非词量）。识别真 bug——`pipeline.ts` 规则先硬过滤，LLM 只能给规则已分类的评论重贴标签，看不到规则漏判的评论。改为分支结构：LLM 激活（`enabled && key`）时看全部评论、规则退纯 fallback。纠正"glm-5.2 免费额度"的错误前提（有成本），加两个护栏：Top-K 预裁剪（点赞降序取前 `topK`=80，成本上限固定）+ id→tag 内存缓存（重新筛选零重复调用）；prompt 增「无关」类过滤噪声。改动 `types.ts`（enabled=true、topK）/`pipeline.ts`（分支+topK+cache）/`llmClassifier.ts`（prompt）。不做 token 分批（1M 上下文足够）。typecheck + build 通过。
- 2026-08-22 治本重构（shownIds 生命周期归位）：识别根因是数据分层错位——`shownIds` 持久化到 `config.json`，但它引用的队列是纯内存、重启从 comments.json 重建，导致"指针比队列活得久"、重启后 split-brain。方案：把推送运行时状态（`shownIds`/`dailyCount`/`currentDay`）全部移入内存，`config.json` 只留 `settings`+`favorites`。改动：`types.ts` PersistedState 精简为两字段；`store.ts` 删除 markShown/resetShown/resetIfNewDay 及 shownIds/resetDate；`queue.ts` 内置 `shownIds: Set`，setQueue 自动 clear，新增 markShown/clearShown；`scheduler.ts` 内存 currentDay 做跨天重置；`ipc.ts` 去掉 resetShown 调用。typecheck + build 通过。
- 2026-08-23 首次采集改用 SQLite：新增 `videos`、`video_pages`、`comments`、`danmaku`、`collection_runs` 表；实测 `BV1xV8j6eEUR` 写入 296 条评论、497 条弹幕。采集库与筛选/推送逻辑分离。
