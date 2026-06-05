# 分析策略 Agent 项目 PRD

> 版本: v2.0
> 日期: 2026-06-04
> 状态: 架构基准稿（基于 supply_strategy MVP 对齐）

---

## 1. 产品定位

**策略分析工作平台**：运营和数据分析师上传 Excel/CSV 文件，通过 AI Agent 进行数据分析、策略制定，实时查看分析过程和结果可视化。

核心架构原则（继承自 supply_strategy v4）：

```
用户上传文件 → workspace/state 文件系统（唯一事实源）
Agent/Skill 读写 workspace 文件
前端通过 API + SSE 观察 workspace
右侧工作区 = 纯 Renderer，不拥有业务状态
```

---

## 2. 核心功能

### 2.1 文件上传与解析
- 支持上传 Excel（.xlsx）/ CSV（.csv）
- 上传后自动解析表结构、字段、行列数
- 注册到 Run 的 input manifest（不覆盖原始文件）
- 预留 Hive 表接入接口（不含开发）

### 2.2 Run 驱动的分析流程
- 每次分析任务对应一个 **Run**（业务主体，拥有 data/artifacts/skills）
- Run 通过轻量 Workflow Stepper 引导进展
- 对话（Conversation）绑定到 Run，多轮对话共享同一 Run 的 workspace

### 2.3 对话区（中间）
- 用户与 BA Agent 对话
- 流式显示 Agent 文本（text-delta 分块）
- 显示 Thinking 过程（可折叠）
- 显示策略卡片（Strategy Card），支持采纳/拒绝/修改
- Stepper 显示 Run 当前阶段进展

### 2.4 工作区画布（右侧，纯渲染）
- 多标签页管理
- 渲染两类 Artifact：
  - **Live Artifact**：绑定 workspace data 文件，数据变化自动刷新
  - **Static Artifact**：快照/导出文件，可下载
- 支持全屏

---

## 3. 核心对象模型

### 3.1 层次结构

```
Run（业务任务主体）
├── input/               用户上传文件（只读）
│   └── manifest.json    输入文件清单
├── data/                可变业务状态
│   ├── analysis.json    当前分析结果
│   ├── cards.json       策略卡片
│   └── strategy_log.jsonl  采纳记录
├── artifact/
│   ├── live/            动态制品（renderer + data source 指针）
│   └── static/          静态制品（快照/报告）
├── logs/
│   ├── operation_log.jsonl  Agent 上下文注入
│   └── events.jsonl     前后端刷新事件
├── skill_manifest.json  本 Run 启用的 Skill 列表
└── run.json             Run 元数据 + stage

Conversation（绑定到 Run 的对话入口）
├── conversation_id
├── run_id
└── agent_session_id    BA chat-gateway session
```

**关键规则**：
- Run 在上，Conversation 在下
- 一个 Run 可有多个 Conversation（多轮）
- Conversation 不拥有数据，数据属于 Run

### 3.2 物理存储路径

平台当前仅允许单层路径写入，后端使用路径编码器：

```
逻辑路径:  runs/<run_id>/data/analysis.json
物理路径:  state/run_<run_id>__data_analysis.json

逻辑路径:  runs/<run_id>/artifact/live/current_view
物理路径:  artifacts/run_<run_id>__live_current_view__*.json
```

前端永远不直接构造物理路径。

### 3.3 Run 对象

```python
class RunManifest(BaseModel):
    run_id: str
    title: str
    stage: str = "upload_data"   # 见 Workflow Stepper
    status: Literal["active", "completed", "failed", "archived"] = "active"
    skill_id: str = "analysis"
    conversation_ids: list[str] = []
    agent_session_id: str | None = None   # ← 必须持久化到 S3，页面刷新后可续话
    created_at: str
    updated_at: str
```

**持久化要求（全面持久化原则）**：

所有业务状态必须写入 BA workspace S3，不依赖服务器内存，重启/刷新后完全可恢复：

| 状态 | 存储位置 | 说明 |
|------|---------|------|
| `agent_session_id` | `run.json` → `state/run_<id>__run.json` | 每次 chat 返回 `init` 事件后立即写回 S3 |
| 对话消息历史 | `state/run_<id>__logs_messages.jsonl` | 每条消息（用户/Agent）流结束后 append |
| 卡片状态 | `state/run_<id>__data_cards.json` | 每次 apply 后立即写 |
| analysis 数据 | `state/run_<id>__data_analysis.json` | 每次 Agent 输出后写 |
| strategy_log | `state/run_<id>__data_strategy_log.jsonl` | 每次 apply 后 append |
| operation_log | `state/run_<id>__logs_operation_log.jsonl` | 每个重要操作后 append |
| input manifest | `state/run_<id>__input_manifest.json` | 上传时写 |
| skill manifest | `state/run_<id>__skill_manifest.json` | 切换时写 |
| live artifact（4 文件） | `artifacts/run_<id>__live_*` | 上传时创建，apply 时更新 version |
| conversation binding | `state/system_conversations_<conv_id>.json` | 首次 chat 时写，后续更新 session_id |

**严禁**：任何业务状态放在服务器进程内存中作为唯一存储（进程重启即丢失）。

### 3.4 Artifact 对象（2 类）

**Live Artifact** — renderer spec + data source 指针，不存数据行

```python
class LiveArtifactManifest(BaseModel):
    artifact_id: str
    kind: Literal["live"] = "live"
    title: str
    renderer: str   # "table" | "html" | "chart" | "markdown"
    version: int = 1
    updated_at: str

class LiveArtifactSources(BaseModel):
    sources: dict[str, ResourceSource]
    refresh: dict   # {"mode": "on_event", "events": [...]}

class LiveArtifactView(BaseModel):
    layout: dict    # 列定义、排序、筛选、密度

class LiveArtifactActions(BaseModel):
    actions: dict   # 允许的写操作
```

**Static Artifact** — 快照/导出，只读可下载

```python
# 存储在 artifacts/run_<run_id>__static_<name>.<ext>
# manifest 在 state/run_<run_id>__static_artifacts_manifest.json
{
    "artifact_id": "analysis_report",
    "kind": "static",
    "name": "analysis_report.md",
    "title": "分析报告",
    "path": "runs/<run_id>/artifact/static/analysis_report.md",
    "media_type": "text/markdown",
    "downloadable": true,
    "updated_at": "..."
}
```

### 3.5 Strategy Card / Action（后端事务）

策略卡片由 Agent 在对话文本中通过 marker 输出，后端解析后推送前端：

```
[[STRATEGY id="s001" name="新增品类" action="add"
  logic="当前缺少XX品类" target="品类A"
  expected_effect="提升转化" priority="high"
  affect_items="item_001,item_002"]]
```

用户点击 **采纳/拒绝/修改** 触发后端事务（CardActionTransaction）：

```python
class CardActionTransaction(BaseModel):
    transaction_id: str
    card_id: str
    action: Literal["accept", "reject", "modify"]
    read_paths: list[str]      # 读了哪些文件
    written_paths: list[str]   # 写了哪些文件（必须落 workspace）
    events: list[str]          # 触发哪些 SSE 事件
    render_views_changed: list[str]  # 触发刷新的 artifact_id 列表
    created_at: str
```

### 3.6 Skill 对象

```python
# state/run_<run_id>__skill_manifest.json
{
    "default_skill": "analysis",
    "allowed_skills": [
        {
            "skill_id": "analysis",
            "enabled": true,
            "version": "1.0.0",
            "path": ".skills/analysis",
            "sync_status": "synced"  # synced | failed | missing | unknown
        },
        {
            "skill_id": "dashboard-gen",
            "enabled": false,
            "version": "0.9.0",
            "path": ".skills/dashboard-gen",
            "sync_status": "local_only"
        }
    ]
}
```

Skill 状态两个维度独立：
- `sync_status`：本地包与后端 workspace 的同步状态
- `enabled`：本 Run 是否启用（Agent 只执行 enabled skills）

---

## 4. BA Agent 后端通信

### 4.1 BA chat-gateway 集成

所有 Agent 调用通过内部 BA chat-gateway：

```
POST https://ba-ai.sankuai.com/fde/api/gateway/chat
Headers: X-SSO-Token: <ssoid>
Body:
{
  "prompt": "<用户输入 + 上下文注入>",
  "project_id": "<BA 项目 ID>",
  "session_id": "<agent_session_id>",   // 续话
  "provider": "claude-service",
  "skill_name": "<启用的 skill>",       // 当前 Run 的 default skill
  "command": "<system prompt>",         // workspace 工作规程
  "enable_thinking": true,
  "current_scope": "project",
  "current_scope_key": "<project_id>"
}
```

**认证**：企业内部强制 SSO，所有上传、对话、artifact 读取、state 写入均须携带有效 ssoid。

**Session 续话**：
- 首次对话不传 `session_id`，BA 返回新的 `session_id`（从 `init` 事件提取）
- 后续对话传入同一 `session_id` 实现多轮上下文
- `agent_session_id` 存入 `ConversationRunBinding`，刷新页面后可恢复

### 4.2 BA SSE 事件流（BA → 我方后端）

BA chat-gateway 返回标准 SSE 流，事件类型：

| BA 事件 | 含义 |
|---|---|
| `init` | 流开始，携带 `session_id` |
| `ping` | 心跳，丢弃 |
| `section` (thinking) | Agent 思考过程 |
| `section` (conclusion) | Agent 输出文本（含 `[[STRATEGY]]` marker）|
| `section` (process/tool_use) | Tool 调用开始 |
| `section` (process/tool_result) | Tool 执行结果（大输出自动变 artifact）|
| `resource_synced` | workspace 文件变更通知（含路径） |
| `tool_request` | User-in-the-loop 工具请求 |
| `error` | 错误 |
| `done` | 流结束，含 cost/tokens |

### 4.3 SSE 翻译层（BA → 前端）

我方后端的 `sse_translator` 将 BA 事件翻译为前端消费的 ai-sdk wire format：

```
BA event           →  前端 event (type)
─────────────────────────────────────────────────────
init               →  start, data-session
section/thinking   →  reasoning-start, reasoning-delta, reasoning-end
section/conclusion →  text-start, text-delta(×N, chunk_size=4), text-end
                       + strategy-card (剥离 [[STRATEGY]] marker)
section/tool_use   →  tool-input-start, tool-input-available
                       + data-ask-question (AskUserQuestion tool)
section/tool_result →  tool-output-available
                       + data-artifact-create (大输出自动升 artifact)
resource_synced    →  data-artifact-ref (artifacts/ 路径)
                       data.updated / artifact.updated (state/ 路径)
tool_request       →  data-tool-request
error              →  error
done               →  strategy-card (批量发) + finish
```

### 4.4 文件上传到 BA workspace

```
POST /fde/api/gateway/projects/<project_id>/files
Headers: X-SSO-Token: <ssoid>
Body: { "filename": "...", "content": "<utf-8 or base64>", "encoding": "utf-8|base64" }
```

- `.xlsx`/`.xls` 必须 base64 编码
- `.csv` 使用 UTF-8
- 文件写入 BA 平台后，Agent 在每次 chat 开始时可从 `cwd/uploads/` 访问

文件读取：
```
GET /fde/api/gateway/projects/<project_id>/files?path=<filename>
```

State 文件（`state/*.json`, `artifacts/*.json`）也通过同一接口读写。

### 4.5 Artifact 读取

Agent 生成的 artifact（HTML/Markdown/JSON/CSV 等）通过：

```
GET /fde/api/gateway/artifacts/content?path=<path>&session_id=<session_id>
```

响应：`{ "path": "...", "content": "...", "encoding": "utf-8|base64" }`

### 4.6 System Prompt 注入（Agent 工作规程）

每次对话的 `command` 字段注入以下上下文：

```
Current run_id: <run_id>
Allowed input files: [from input manifest]
Allowed skills: [from skill_manifest, enabled only]
Business data paths:
  state/run_<run_id>__data_analysis.json
  state/run_<run_id>__data_cards.json
Artifact output prefix:
  artifacts/run_<run_id>__

Rules:
- Read input files from input manifest paths only
- Do not write uploads/
- Write business state to run data paths only
- Write user-visible outputs to current run artifact prefix
- Emit [[STRATEGY ...]] markers for strategy cards
- Do not send full data tables in chat text
```

---

## 5. Workflow Stepper

每个 Run 有轻量 Stepper，状态持久化到 `run.json`。Stepper 是进度指示器，不是阻塞向导。

### 5.1 MVP Stages

| Stage | 用户标签 | 主要 UI | 后端动作 | 进入条件 |
|---|---|---|---|---|
| `upload_data` | 上传数据 | 文件上传 / 绑定 | — | Run 创建时默认 |
| `analysing` | 分析中 | 对话区流式显示 + Live Artifact 渐进 | 写 input manifest → **自动触发 Agent 分析** → 写 analysis.json + 创建 live artifact | 有输入文件后自动推进 |
| `review_strategy` | 策略调整 | 对话 + 策略卡片 + Live Artifact | 卡片 apply 事务 | Agent 首次完成分析 |
| `export` | 导出报告 | 生成报告 + 下载 | 生成 static artifact | 用户主动触发 |

**关键设计：无独立"开始分析"步骤**

与 supply_strategy 一致：**文件上传成功后后端自动触发分析流程**，不需要用户额外点击"开始分析"按钮。流程如下：

```
用户上传文件
  ↓
server.py 写 input manifest + 上传到 BA workspace
  ↓
自动构建初始 analysis.json（schema 见 §3.5）
  ↓
自动创建 current_view live artifact（artifact/sources/view/actions 4 文件）
  ↓
Run stage 推进到 analysing
  ↓
用户在对话区继续提问，Agent 读取文件做深入分析
  ↓
Agent 输出 [[STRATEGY]] markers → 渲染策略卡片
  ↓
Run stage 推进到 review_strategy
```

`start-analysis` API 端点**不再需要**。Skill 选择在 Run 创建时或上传时一次性决定，不阻塞流程。

```
顶栏: [Run: 分析任务 0604 ▼]  上传数据 →① 分析中 →② 策略调整 →③ 导出
                                           ↑ 文件上传后自动推进
```

---

## 6. 前端布局

```
┌──────────────────────────────────────────────────────────────┐
│  [Run: 任务名称 ▼]  上传数据 →① 开始分析 →② 策略调整 →③ 导出  │
├────────────────┬─────────────────────┬───────────────────────┤
│                │                     │                       │
│   左侧面板      │    中间对话区         │   右侧工作区           │
│   (20-25%)     │    (35-40%)          │   (40-45%)           │
│                │                     │                       │
│  文件树:        │  消息流              │  标签页管理            │
│  ├ 输入文件     │  + Thinking 折叠    │  ├ Live Artifact      │
│  ├ 工作数据     │  + 策略卡片          │  └ Static Artifact   │
│  ├ 工作产物     │                     │                       │
│  └ 技能        │  Stepper             │  纯渲染，不持有状态     │
│               │                     │                       │
│               │  输入框              │  [全屏] [下载]          │
│               │                     │                       │
└───────────────┴─────────────────────┴───────────────────────┘
```

### 6.1 左侧面板：文件树

```
当前任务
  输入文件
    A1.xlsx          点击 → 预览
    A2.csv           点击 → 预览
  工作数据
    analysis.json    点击 → 预览
    cards.json
    strategy_log.jsonl
  工作产物
    📊 当前分析（Live）  点击 → 右侧渲染
    📄 分析报告.md（Static）  点击 → 预览/下载
  日志（默认折叠）
    operation_log.jsonl

技能
  ✅ analysis           on  [切换]
  □ dashboard-gen      off [切换]
  [🔄 同步到后端]
```

文件节点结构：

```json
{
  "name": "analysis.json",
  "section": "data",
  "kind": "json",
  "logical_path": "runs/<run_id>/data/analysis.json",
  "physical_path": "state/run_<run_id>__data_analysis.json",
  "run_id": "<run_id>",
  "synced": true,
  "open_behavior": "preview"
}
```

### 6.2 中间对话区

消息类型：

| 类型 | 来源 | 显示 |
|---|---|---|
| 用户消息 | 前端 | 右对齐气泡 |
| Agent 文本 | `text-delta` 流 | 左对齐，流式打字 |
| Thinking | `reasoning-*` | 折叠面板，灰色 |
| Strategy Card | `strategy-card` | 卡片组件，含操作按钮 |
| Tool 状态 | `tool-input-*` | 内联状态条 |
| Ask 表单 | `data-ask-question` | 内联选项表单 |
| 错误 | `error` | 红色提示条 |

Strategy Card 示例：

```
┌── 策略建议：新增品类 ────────────────────────────── ●高优先级 ──┐
│ 动作：add（新增）                                             │
│ 逻辑：当前缺少XX品类，竞品已上线                               │
│ 目标：品类A                                                  │
│ 预期效果：提升转化 ~15%                                        │
│ 影响商品：item_001, item_002                                  │
│                                                              │
│ [✅ 采纳]  [❌ 拒绝]  [✏️ 修改]                              │
└───────────────────────────────────────────────────────────────┘
```

### 6.3 右侧工作区

右侧只渲染，不保存业务状态。

**Live Artifact 渲染**：

```
┌─ 标签页 ─────────────────────────────────────────────────────┐
│ [📊 当前分析]  [📄 报告]  [+]                               │
├─────────────────────────────────────────────────────────────┤
│  Live Artifact: 当前分析                                    │
│  ─────────────────────────────                             │
│  [表格/图表内容，从 sources.json 指向的 data 文件读取]        │
│                                                             │
│  [⟳ 手动刷新]  [📌 全屏]  [💾 下载]                        │
└─────────────────────────────────────────────────────────────┘
```

Live Artifact 渲染规则（参考 supply_strategy `create_current_pool_live_artifact`）：

1. 前端请求 `GET /api/runs/{run_id}/artifacts/current_view` 拿到 4 个文件内容
2. 读取 `sources.json` 中每个 source 的 `path`（物理路径）和 `selector`（JSONPath）
3. 调用 `GET /api/runs/{run_id}/data/content?physical_path=<path>` 读取实际数据文件
4. 用 `selector` 做 JSONPath 提取（如 `$.items` 提取数组，`$.summary` 提取摘要）
5. 按 `view.json` 的列定义渲染表格/图表

```javascript
// 前端渲染逻辑示例
async function renderLiveArtifact(artifactId, runId) {
  const artifact = await GET(`/api/runs/${runId}/artifacts/${artifactId}`);
  const { sources, view } = artifact;

  // 并行读取所有 source 文件
  const data = {};
  for (const [key, src] of Object.entries(sources.sources)) {
    const raw = await GET(`/api/runs/${runId}/data/content?physical_path=${src.path}`);
    data[key] = jsonpath.query(raw, src.selector);  // 用 selector 提取
  }

  // data.rows → 表格行，data.summary → 汇总行
  renderTable(data.rows, view.layout.columns);
}
```

刷新触发规则：
- `on_event` 模式：监听 SSE `data.updated` / `artifact.updated` 事件后自动刷新
- 手动点击刷新：重新 `GET /api/runs/{run_id}/artifacts/{artifact_id}`

---

## 7. SSE 事件规范（最小集）

### 7.1 前端消费的事件类型（共 12 种）

```
chat 流相关（BA → 翻译层 → 前端）:
  start                  流开始
  data-session           session_id 建立
  reasoning-start        Thinking 块开始
  reasoning-delta        Thinking 内容
  reasoning-end          Thinking 块结束
  text-start             Agent 文本开始
  text-delta             Agent 文本块（chunk_size=4）
  text-end               Agent 文本结束
  tool-input-start       Tool 调用开始
  tool-input-available   Tool 调用详情
  tool-output-available  Tool 结果
  data-artifact-create   大输出自动升为 artifact（内联 content）
  data-artifact-ref      workspace artifact 引用（有 path，需另拉）
  strategy-card          策略卡片（从 [[STRATEGY]] marker 解析）
  data-ask-question      AskUserQuestion 表单
  data-tool-request      User-in-the-loop 工具请求
  finish                 流结束（含 tokens / cost）
  error                  错误

workspace 状态变更（后端主动推，或从 resource_synced 翻译）:
  data.updated           run data 文件已更新（含 path）
  artifact.updated       live artifact 文件已更新（含 artifact_id）
  artifact.static.created  新静态制品生成（含 artifact_id + path）
  run.stage_changed      workflow stage 推进
```

### 7.2 前端 SSE 接入点

```
GET /api/runs/{run_id}/chat/stream    Agent 对话 SSE 流
```

（非 GET /api/runs/{run_id}/stream，对话走 POST 触发，SSE 是响应体）

实际方式：`POST /api/runs/{run_id}/chat` → 返回 `text/event-stream`

### 7.3 事件数据格式（对齐 ai-sdk wire format）

```javascript
// text-delta
data: {"type":"text-delta","id":"msg_001","delta":"分析结果"}

// strategy-card
data: {"type":"strategy-card","data":{"id":"s001","action":"add","fields":{"name":"新增品类","logic":"...","target":"...","expected_effect":"..."},"meta":{"priority":"high"},"affect_items":"item_001","state":"pending"}}

// data-artifact-ref（有 workspace path，前端再拉）
data: {"type":"data-artifact-ref","data":{"artifact_id":"current_view","kind":"live","path":"artifacts/run_x__live_current_view__artifact.json","session_id":"..."}}

// data.updated（workspace 数据文件变更，触发 live artifact 刷新）
data: {"type":"data.updated","data":{"path":"state/run_x__data_analysis.json","run_id":"run_x"}}

// artifact.updated
data: {"type":"artifact.updated","data":{"artifact_id":"current_view","run_id":"run_x"}}

// finish
data: {"type":"finish","messageMetadata":{"session_id":"...","cost_usd":0.05,"input_tokens":1200,"output_tokens":800}}
```

---

## 8. 后端 API（MVP 最小集）

### Run

```
POST   /api/runs                         创建 Run
GET    /api/runs                         列出 Run（runs_index）
GET    /api/runs/{run_id}                获取 Run 详情
PATCH  /api/runs/{run_id}                更新 Run（title / stage）
POST   /api/runs/{run_id}/activate       设为当前活跃 Run
```

### Inputs

```
POST   /api/runs/{run_id}/inputs/upload          上传新文件到 Run
POST   /api/runs/{run_id}/inputs/bind-upload     绑定已上传文件
GET    /api/runs/{run_id}/inputs                 获取 input manifest
```

### File Tree

```
GET    /api/runs/{run_id}/tree                   获取文件树（逻辑视图）
```

### Data

```
GET    /api/runs/{run_id}/data/{name}            读取 data 文件
PATCH  /api/runs/{run_id}/data/{name}            patch data 文件
```

### Artifacts

```
GET    /api/runs/{run_id}/artifacts              列出 artifacts
GET    /api/runs/{run_id}/artifacts/{artifact_id}          获取 live artifact（含 sources/view/actions）
GET    /api/runs/{run_id}/artifacts/static/{name}/download 下载 static artifact
```

### Skills

```
GET    /api/runs/{run_id}/skills                 获取 skill manifest
PATCH  /api/runs/{run_id}/skills/{skill_id}      切换 enabled 状态
POST   /api/agent/skills/sync-to-workspace       本地 Skill 同步到 BA workspace
```

### Workflow（Agent 触发）

```
POST   /api/runs/{run_id}/start-analysis         开始分析（触发 Agent）
POST   /api/runs/{run_id}/cards/{card_id}/apply  采纳/拒绝/修改策略卡片
POST   /api/runs/{run_id}/generate-report        生成静态报告
```

### Agent Chat

```
POST   /api/runs/{run_id}/chat                   发消息（返回 SSE 流）
```

---

## 9. Skill 同步机制

### 9.1 本地 Skill 目录

```
.skills/
├── _registry/
│   └── skills.json          显式注册表（事实源）
├── analysis/
│   └── SKILL.md             Skill 说明（workspace-first 协议）
└── dashboard-gen/
    └── SKILL.md
```

### 9.2 Skill 注册表

```json
{
  "skills": [
    {
      "skill_id": "analysis",
      "name": "数据分析",
      "version": "1.0.0",
      "enabled_by_default": true,
      "path": ".skills/analysis"
    }
  ]
}
```

### 9.3 同步流程

```
POST /api/agent/skills/sync-to-workspace
  ↓
后端读取 .skills/_registry/skills.json
  ↓
遍历每个 skill，读取 SKILL.md
  ↓
POST /gateway/projects/<project_id>/files
  filename: ".claude/skills/<skill_id>/SKILL.md"
  ↓
更新 run skill_manifest 的 sync_status = "synced"
  ↓
返回 { synced: ["analysis"], failed: [] }
```

### 9.4 SKILL.md 规范（workspace-first）

Skill 必须：
- 从 input manifest 路径读取输入文件
- 将分析结果写入 `state/run_<run_id>__data_analysis.json`
- 将策略卡片写入 `state/run_<run_id>__data_cards.json`
- 在 chat 文本中输出 `[[STRATEGY ...]]` marker
- 将可渲染产物写入 `artifacts/run_<run_id>__...`
- 不将完整数据表格塞进聊天文本
- 不修改 `uploads/` 下的原始文件

---

## 10. 前端状态管理

前端状态是后端 workspace 的 **UI cache**，不是事实源。

```typescript
interface UIState {
  // Run 基础
  activeRunId: string | null;
  runs: RunSummary[];                // from GET /api/runs

  // 对话
  messages: ChatMessage[];           // 当前 Run 的消息列表
  streamConnected: boolean;

  // 文件树
  fileTree: FileTreeNode[];          // from GET /api/runs/{run_id}/tree

  // Artifact（右侧面板）
  openArtifactTabs: ArtifactTab[];
  activeTabId: string | null;

  // Skills
  skillManifest: SkillManifest | null;

  // UI 状态
  sidebarCollapsed: boolean;
  focusedStage: string | null;
}

// UI state 不存 data 内容，不存 artifact content
// 刷新页面 → 从后端重新拉取 Run 状态
```

**刷新页面恢复流程**：

```
页面加载
  ↓
GET /api/runs → 获取 runs_index，恢复 activeRunId
  ↓
GET /api/runs/{run_id} → 恢复 run.json (stage/status)
  ↓
GET /api/runs/{run_id}/tree → 恢复文件树
  ↓
GET /api/runs/{run_id}/skills → 恢复 skill manifest
  ↓
GET /api/runs/{run_id}/artifacts → 恢复 artifact 列表，打开默认 tab
```

---

## 11. 后端模块结构

```
server.py                        主 FastAPI，port 8080，静态页 + API
agent/server.py                  Agent FastAPI，port 8001，SSE chat
src/agent_proxy.py               主服务 → agent/server.py 代理
src/clients/
  chat_gateway.py                BA chat-gateway HTTP client（SSE 流 + 阻塞）
  sse_translator.py              BA SSE → ai-sdk wire format 翻译
  project_files.py               BA project files CRUD（上传/读/删）
  state_files.py                 state/artifacts 文件读写封装
  sso.py                         SSO 换票
src/workspace/
  run_paths.py                   逻辑路径 ↔ 物理路径编码/解码
  run_store.py                   Run CRUD、input、data、artifact、skill 读写
  run_tree.py                    构建文件树
  contracts.py                   Pydantic 数据契约
  events.py                      events.jsonl append 工具
agent/
  prompts.py                     system prompt + skill prompt 组装
  skills/
    _registry/skills.json        Skill 注册表
    analysis/SKILL.md
    dashboard-gen/SKILL.md
  tools/
    sync_skills.py               上传 Skill 到 workspace
```

---

## 12. MVP 实现阶段

### Phase 0：路径基座
- `run_paths.py`：逻辑路径 ↔ 物理路径编解码
- `contracts.py`：Pydantic 对象定义
- 路径单测

### Phase 1：Run Core
- Run CRUD（create/list/get/activate）
- `runs_index.json` + `run.json`
- Workflow Stepper 绑定 `run.stage`
- 前端 Run 选择器 + Stepper UI

### Phase 2：Inputs + File Tree
- 文件上传（通过 BA project files API）
- 注册到 run input manifest
- 绑定已上传文件
- `GET /api/runs/{run_id}/tree`
- 左侧文件树 UI

### Phase 3：Agent Chat + Strategy Cards
- `POST /api/runs/{run_id}/chat` → SSE
- BA chat-gateway 集成（`chat_gateway.py` + `sse_translator.py`）
- system prompt 注入（run_id / input paths / skill manifest）
- 前端消费 text-delta、strategy-card、finish
- 策略卡片组件（采纳/拒绝/修改）

### Phase 4：Data + Live Artifact
- 分析结果写入 `data/analysis.json`
- 创建 `current_view` live artifact（artifact/sources/view/actions 4 个文件）
- 右侧面板渲染 live artifact
- `data.updated` / `artifact.updated` SSE 触发刷新

### Phase 5：Card Actions（后端事务）
- `POST .../cards/{card_id}/apply`
- `CardActionTransaction`：读 data + 写 data + 写 strategy_log + 发 SSE 事件
- live artifact 自动刷新

### Phase 6：Skills + Sync
- `skill_manifest.json` per-run
- Skill 启用/禁用 toggle
- `POST /api/agent/skills/sync-to-workspace` 脚本化上传
- 前端 Skill 管理 UI + sync status 徽章

### Phase 7：Static Artifacts + Export
- `POST .../generate-report` → 写 static artifact（Markdown / CSV）
- 静态制品列表 + 下载 UI

---

## 13. MVP 完成标准

```
1. 用户创建 Run，看到 Workflow Stepper
2. 上传文件，文件出现在左侧文件树输入区
3. 启用 analysis skill
4. 开始分析，对话区流式显示 Agent 文本
5. 对话区出现策略卡片，可采纳/拒绝
6. 右侧 live artifact 显示分析结果
7. 采纳卡片后 live artifact 自动刷新
8. 生成报告，下载 static artifact
9. 刷新页面，Run 状态从后端恢复
```

---

## 14. 不做的事

- 不让前端内存作为业务数据事实源
- 不让 LLM 在聊天文本中传输完整数据表格
- 不在路由处理器里堆业务算法（确定性逻辑放 `src/` 纯模块）
- 不绕过 SSO（所有 BA API 调用必须携带 ssoid）
- 不修改 `uploads/` 原始文件
- 不在 artifact 对象里直接存 HTML/数据内容（存 path + renderer spec）
- 不做 restore-replay SSE（MVP 阶段：刷新页面走 REST API 重建状态）

---

## 15. 文件架构

### 15.1 项目目录结构

```
supply_strategy_tequila/
├── server.py                        主 FastAPI，port 8080
│                                    提供静态页 + /api/* 路由 + agent proxy
├── agent/
│   ├── server.py                    Agent FastAPI，port 8001
│   │                                POST /api/agent/chat（SSE 流）
│   │                                GET  /api/agent/skills
│   ├── prompts.py                   system prompt + skill prompt 组装
│   │                                build_agent_prompt(run_id, inputs, skills, context)
│   ├── skills/
│   │   ├── _registry/
│   │   │   └── skills.json          Skill 显式注册表（唯一事实源）
│   │   ├── analysis/
│   │   │   └── SKILL.md             分析 Skill（workspace-first 协议）
│   │   └── dashboard-gen/
│   │       └── SKILL.md
│   └── tools/
│       └── sync_skills.py           批量上传 Skill 到 BA workspace
│
├── src/
│   ├── agent_proxy.py               主服务 → agent/server.py 透明代理
│   │                                透传 SSO Header，转发 SSE 流
│   ├── clients/
│   │   ├── chat_gateway.py          BA chat-gateway HTTP client
│   │   │   stream_chat()            异步 SSE 流（agent 模式）
│   │   │   call_chat_gateway()      阻塞同步（兼容模式）
│   │   │   list_artifacts()         列 BA session artifacts
│   │   │   get_artifact_content()   读 artifact 内容（bytes）
│   │   ├── sse_translator.py        BA SSE → ai-sdk wire format 翻译
│   │   │   parse_ba_sse_events()    BA raw text → event dict iter
│   │   │   translate_event()        单事件翻译（带 state 跨事件共享）
│   │   │   format_sse_line()        event dict → SSE wire 行
│   │   ├── project_files.py         BA project files CRUD
│   │   │   upload_file()            上传文件（xlsx/csv）
│   │   │   read_file()              读文件（返回 bytes）
│   │   │   delete_file()            删文件（幂等）
│   │   │   append_upload_log()      追加 operation_log
│   │   │   list_uploaded_files()    从 op log 重建文件列表
│   │   ├── state_files.py           state/artifacts 文件读写封装
│   │   │   read_state_json()        读 JSON 文件
│   │   │   write_state_json()       写 JSON 文件
│   │   │   read_text_file()         读文本文件
│   │   │   write_text_file()        写文本文件
│   │   └── sso.py                   SSO 换票（moa_local_exchange）
│   │
│   └── workspace/
│       ├── contracts.py             Pydantic 数据契约（所有对象定义）
│       ├── run_paths.py             逻辑路径 ↔ 物理路径编解码
│       │   physical_path_for_logical_path()  统一入口
│       │   physical_run_manifest()
│       │   physical_input_manifest()
│       │   physical_skill_manifest()
│       │   physical_live_artifact()
│       │   physical_static_artifact()
│       ├── run_store.py             Run CRUD + data/artifact/skill 读写
│       │   create_or_update_run()
│       │   get_run() / get_or_create_run()
│       │   bind_conversation_to_run()
│       │   register_run_input_file()
│       │   write_run_data() / read_run_data()
│       │   create_current_view_live_artifact()
│       │   write_static_artifact_text()
│       │   write_run_skill_manifest()
│       ├── run_tree.py              构建前端文件树（逻辑视图）
│       │   build_run_tree(run_id, ...)  → list[FileTreeNode]
│       └── events.py               events.jsonl append 工具
│           new_event() / event_to_jsonl() / append_system_event()
│
├── web/                             前端静态文件
│   ├── index.html                   主入口（三栏布局）
│   ├── app.js                       前端逻辑（Vanilla JS / React）
│   └── style.css
│
├── requirements.txt
├── .env                             BA_GATEWAY_URL / SUPPLY_PROJECT_ID / SSO 配置
└── restart.sh
```

### 15.2 BA Workspace 文件布局（物理路径）

平台仅允许 `state/` 和 `artifacts/` 两个单层目录写入。

```
BA Project Workspace
├── uploads/                         用户上传原始文件（只读，gateway 管理）
│   ├── A1.xlsx
│   └── A2.csv
│
├── state/                           业务状态文件（可读写）
│   ├── runs_index.json              所有 Run 的摘要索引
│   ├── system_events.jsonl          系统级事件流
│   ├── system_operation_log.jsonl   Agent 上下文操作日志
│   │
│   │   ── 每个 Run 的逻辑文件（以 run_<id>__ 为前缀）──
│   ├── run_<run_id>__run.json            Run 元数据（stage/status）
│   ├── run_<run_id>__input_manifest.json 输入文件清单
│   ├── run_<run_id>__skill_manifest.json 本 Run Skill 启用状态
│   ├── run_<run_id>__data_analysis.json  分析结果
│   ├── run_<run_id>__data_cards.json     策略卡片
│   ├── run_<run_id>__data_strategy_log.jsonl  采纳记录
│   ├── run_<run_id>__logs_operation_log.jsonl Agent 操作日志
│   ├── run_<run_id>__logs_events.jsonl        工作区事件流
│   └── system_conversations_<conv_id>.json    Conversation→Run 绑定
│
└── artifacts/                       可渲染产物（可读写）
    │   ── Live Artifact（4 个文件一组）──
    ├── run_<run_id>__live_current_view__artifact.json
    ├── run_<run_id>__live_current_view__sources.json
    ├── run_<run_id>__live_current_view__view.json
    ├── run_<run_id>__live_current_view__actions.json
    │
    │   ── Static Artifact ──
    ├── run_<run_id>__static_analysis_report.md
    └── run_<run_id>__static_artifacts_manifest.json
```

### 15.3 逻辑路径 ↔ 物理路径映射规则

```python
# 规则：runs/<run_id>/<section>/<file> → state/run_<run_id>__<section>_<file>
# 规则：runs/<run_id>/artifact/live/<id>/<file> → artifacts/run_<run_id>__live_<id>__<file>
# 规则：runs/<run_id>/artifact/static/<file> → artifacts/run_<run_id>__static_<file>

# 示例
"runs/run_001/run.json"
    → "state/run_run_001__run.json"

"runs/run_001/data/analysis.json"
    → "state/run_run_001__data_analysis.json"

"runs/run_001/artifact/live/current_view/sources.json"
    → "artifacts/run_run_001__live_current_view__sources.json"

"runs/run_001/artifact/static/report.md"
    → "artifacts/run_run_001__static_report.md"
```

路径约束：
- `run_id` 只允许小写字母、数字、`_`、`-`
- 后端统一通过 `physical_path_for_logical_path()` 转换，前端不构造物理路径
- 物理路径对前端透明，文件树只展示逻辑路径

---

## 16. 通信架构

### 16.1 整体通信拓扑

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器前端                                                   │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────────┐   │
│  │ 左侧面板  │  │ 对话区    │  │ 右侧工作区 (Renderer)    │   │
│  └──────────┘  └──────────┘  └─────────────────────────┘   │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST + SSE (HTTP/1.1)
                       │ Cookie: ssoid
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  主服务 server.py :8080                                       │
│  ├── /api/runs/*          Run / Input / Tree / Artifact API   │
│  ├── /api/runs/*/chat     → proxy → agent/server.py :8001    │
│  └── /web/*               静态文件                           │
└───────────────────────┬──────────────────────────────────────┘
                        │ HTTP proxy (透传 SSO + SSE)
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  Agent 服务 agent/server.py :8001                             │
│  ├── POST /api/agent/chat   → BA chat-gateway SSE 流         │
│  └── GET  /api/agent/skills → 本地 skill registry            │
└───────────────────────┬──────────────────────────────────────┘
                        │ HTTPS + X-SSO-Token
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  BA Platform  ba-ai.sankuai.com                               │
│  ├── POST /fde/api/gateway/chat          SSE 流式 Agent 调用  │
│  ├── GET/POST/DELETE                                          │
│  │   /fde/api/gateway/projects/<pid>/files  文件 CRUD         │
│  └── GET /fde/api/gateway/artifacts/content  Artifact 读取   │
└──────────────────────────────────────────────────────────────┘
```

### 16.2 对话请求完整链路

```
① 用户输入消息，前端 POST /api/runs/{run_id}/chat
  Body: { prompt, conversation_id, skill_name? }
  Headers: Cookie: ssoid=<token>
                    ↓
② server.py 收到请求
  - 读取 run.json（stage/status）
  - 读取 input manifest（可用文件列表）
  - 读取 skill manifest（enabled skills）
  - 读取 operation_log 末尾 N 条（注入 Agent 上下文）
  - 组装 system prompt（工作规程 + run 上下文）
  - proxy 到 agent/server.py
                    ↓
③ agent/server.py 调用 BA chat-gateway
  POST /fde/api/gateway/chat
  Headers: X-SSO-Token: <ssoid>
  Body: {
    prompt: "<注入上下文的完整 prompt>",
    session_id: "<agent_session_id or null>",
    project_id: "<BA 项目 ID>",
    skill_name: "<当前 run 的 default skill>",
    command: "<system prompt>",
    enable_thinking: true
  }
                    ↓
④ BA chat-gateway 流式返回 BA SSE 事件块
  event: init    data: {"session_id":"sess_xxx"}
  event: section data: {"usage":"thinking","content":"..."}
  event: section data: {"usage":"conclusion","content":"分析结果...[[STRATEGY ...]]"}
  event: resource_synced data: {"resources":[{"path":"artifacts/...","action":"created"}]}
  event: done    data: {"cost_usd":0.05,"input_tokens":1200}
                    ↓
⑤ sse_translator 翻译每个 BA 事件块
  BA init        → {type:"start"} + {type:"data-session", data:{session_id}}
  BA thinking    → reasoning-start/delta/end
  BA conclusion  → text-start + text-delta(×N) + text-end
                   + strategy-card(s) 从 [[STRATEGY]] 提取
  BA resource_synced artifacts/* → data-artifact-ref
  BA resource_synced state/*     → data.updated / artifact.updated
  BA done        → finish (含 tokens/cost)
                    ↓
⑥ 翻译后的 ai-sdk 事件通过 SSE 推送给浏览器
  data: {"type":"text-delta","delta":"分析结果..."}
  data: {"type":"strategy-card","data":{...}}
  data: {"type":"data-artifact-ref","data":{"artifact_id":"current_view",...}}
  data: {"type":"finish","messageMetadata":{...}}
                    ↓
⑦ 前端处理各类事件
  text-delta      → 追加到对话消息，流式打字效果
  strategy-card   → 渲染策略卡片组件（含操作按钮）
  data-artifact-ref → GET /api/runs/{run_id}/artifacts/{artifact_id}
                      → 右侧面板渲染 live artifact
  data.updated    → 重新拉取 live artifact sources，刷新视图
  finish          → 标记消息结束，保存 session_id
```

### 16.3 文件上传链路（上传即触发分析）

```
① 前端 POST /api/runs/{run_id}/inputs/upload
  multipart/form-data: file=<binary>
                    ↓
② server.py 文件处理
  - 读文件 bytes，检测 encoding（xlsx→base64，csv→utf-8）
  - POST /fde/api/gateway/projects/<pid>/files
    Body: {filename, content, encoding}
  - 解析文件结构（行数/列名/size）
  - 写入 run input manifest（state/run_<id>__input_manifest.json）
  - 追加 operation_log（供 Agent 上下文感知）
                    ↓
③ server.py 自动初始化分析数据（与 supply_strategy 一致）
  - 构建初始 analysis.json（schema 见 §3.5）
    {schema, source, items: [], summary: {}, updated_at}
  - write_run_data(name="analysis.json", data=initial_analysis)
    → 追加 events.jsonl: {type:"data.updated", path:"...analysis.json"}
  - 创建 current_view live artifact（4 个文件）：
      artifact.json  → {artifact_id, kind:"live", renderer:"table", version:1}
      sources.json   → {sources:{rows:{path, selector:"$.items"}, summary:{...}}}
      view.json      → {layout:{columns, sort, filters, density}}
      actions.json   → {actions:{row_edit, apply_strategy_card}}
  - Run stage 推进到 analysing
                    ↓
④ 返回 {file_id, filename, rows, columns, size_bytes, analysis_initialized: true}
                    ↓
⑤ 前端收到响应
  - 文件出现在左侧文件树输入区
  - Stepper 自动跳到 analysing
  - 右侧 live artifact tab 自动打开（数据初始为空，等 Agent 填充）
  - 对话区提示用户可以开始提问
```

### 16.4 策略卡片采纳链路

```
① 前端 POST /api/runs/{run_id}/cards/{card_id}/apply
  Body: { action: "accept"|"reject"|"modify", reason?, params? }
                    ↓
② server.py card apply 事务
  - 读取 data/cards.json（找到 card_id）
  - 读取 data/analysis.json（当前分析结果）
  - 根据 action + card 内容修改 analysis.json
  - 将 card 状态写回 cards.json
  - 追加 strategy_log.jsonl（时间戳 + card_id + action + reason）
  - 追加 operation_log（Agent 可感知）
  - 更新 live artifact sources 的 version（触发前端刷新）
  - 追加 events.jsonl
  - 返回 CardActionTransaction:
    {
      transaction_id, card_id, action,
      written_paths: [...],
      events: ["data.updated", "artifact.updated"],
      render_views_changed: ["current_view"]
    }
                    ↓
③ 前端收到响应
  - 更新卡片状态为 accepted/rejected/modified
  - 根据 render_views_changed 刷新对应 artifact tab
  - 触发 GET /api/runs/{run_id}/artifacts/current_view
```

### 16.5 页面刷新恢复链路（全面持久化）

**原则：所有内容均持久化到 S3，刷新页面等同于重新加载，无任何信息丢失。**

```
页面加载
  ↓
① GET /api/runs → runs_index（含 activeRunId）
  ↓
② GET /api/runs/{run_id} → run.json
    恢复: stage / status / title / agent_session_id（用于后续续话）
  ↓
③ GET /api/runs/{run_id}/conversations/{conv_id} → conversation binding
    恢复: agent_session_id（下次 chat 传入实现多轮）
  ↓
④ GET /api/runs/{run_id}/messages → logs_messages.jsonl
    恢复: 全部历史对话消息（用户消息 + Agent 回复）
    → 前端重新渲染消息列表（含策略卡片的历史状态）
  ↓
⑤ GET /api/runs/{run_id}/cards → data_cards.json
    恢复: 每张卡片的 accepted/rejected/pending 状态
    → 历史策略卡片按存储状态渲染（已采纳的禁用按钮）
  ↓
⑥ GET /api/runs/{run_id}/tree → 文件树
    恢复: inputs / data / artifacts / skills 结构
  ↓
⑦ GET /api/runs/{run_id}/skills → skill_manifest
    恢复: 技能启用状态
  ↓
⑧ GET /api/runs/{run_id}/artifacts → artifact 列表
  ↓
⑨ GET /api/runs/{run_id}/artifacts/current_view → 打开默认 tab
    恢复: live artifact（从 sources.json → data 文件重新读取数据）
  ↓
前端完成完整状态恢复（无需 restore-replay SSE）
```

**持久化时间点**：

| 操作 | 触发时机 | 写入文件 |
|------|---------|---------|
| 用户发消息 | 发送时立即 append | `logs_messages.jsonl` |
| Agent 回复完成 | SSE `finish` 事件触发 | `logs_messages.jsonl` |
| `agent_session_id` 更新 | BA SSE `init` 事件 | `run.json` + `conversation binding` |
| 策略卡片 apply | apply 事务完成 | `data_cards.json` + `data_strategy_log.jsonl` |
| analysis.json 更新 | Agent 输出后 / 文件上传后 | `data_analysis.json` |

**messages.jsonl 消息格式**：
```jsonc
// 用户消息
{"role":"user","content":"分析增长趋势","ts":"2026-06-04T10:00:00Z","conversation_id":"conv_001"}

// Agent 回复（含卡片引用）
{"role":"assistant","content":"根据数据分析...","ts":"2026-06-04T10:00:15Z",
 "session_id":"sess_abc","card_ids":["s001","s002"],"cost_usd":0.05}
```

---

## 17. API 架构

### 17.1 API 分层

```
前端调用路径             server.py 路由                   后端模块
─────────────────────────────────────────────────────────────────
/api/runs/*             runs_router.py               run_store.py
/api/runs/*/chat        → proxy → agent/server.py    chat_gateway.py
                                                     sse_translator.py
/api/agent/skills/sync  skills_router.py             sync_skills.py
```

### 17.2 完整 API 列表

#### Run 管理

| Method | Path | 说明 | 后端操作 |
|--------|------|------|---------|
| `POST` | `/api/runs` | 创建 Run | 写 `run.json` + 更新 `runs_index.json` |
| `GET` | `/api/runs` | 列出所有 Run | 读 `runs_index.json` |
| `GET` | `/api/runs/{run_id}` | 获取 Run 详情 | 读 `run.json` |
| `PATCH` | `/api/runs/{run_id}` | 更新 Run（title/stage） | 写 `run.json` |
| `POST` | `/api/runs/{run_id}/activate` | 设为活跃 Run | 更新 `runs_index.json` active 字段 |

请求/响应：

```jsonc
// POST /api/runs
Request:  { "title": "销售分析 0604" }
Response: { "run_id": "run_20260604_001", "stage": "upload_data", "status": "active" }

// PATCH /api/runs/{run_id}
Request:  { "stage": "start_analysis" }   // 仅允许后退步骤或系统推进
Response: { "run_id": "...", "stage": "start_analysis" }
```

#### 输入文件

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/runs/{run_id}/inputs/upload` | 上传新文件 |
| `POST` | `/api/runs/{run_id}/inputs/bind-upload` | 绑定已上传文件 |
| `GET` | `/api/runs/{run_id}/inputs` | 获取 input manifest |

```jsonc
// POST /api/runs/{run_id}/inputs/upload
Request:  multipart/form-data, file=<binary>
Response: {
  "file_id": "sha1_abc123",
  "filename": "A1.xlsx",
  "rows": 1200,
  "columns": ["spu_id", "name", "price"],
  "size_bytes": 153600,
  "physical_path": "uploads/A1.xlsx"
}

// POST /api/runs/{run_id}/inputs/bind-upload
Request:  { "filename": "A1.xlsx", "role": "product_list" }
Response: { "file_id": "...", "bound": true }
```

#### 文件树

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runs/{run_id}/tree` | 获取逻辑文件树 |

```jsonc
// GET /api/runs/{run_id}/tree
Response: {
  "run_id": "run_001",
  "sections": [
    {
      "section": "input",
      "label": "输入文件",
      "nodes": [
        {
          "name": "A1.xlsx",
          "kind": "xlsx",
          "logical_path": "runs/run_001/input/A1.xlsx",
          "physical_path": "uploads/A1.xlsx",
          "synced": true,
          "open_behavior": "preview"
        }
      ]
    },
    { "section": "data", "label": "工作数据", "nodes": [...] },
    { "section": "artifact", "label": "工作产物", "nodes": [...] },
    { "section": "logs", "label": "日志", "nodes": [...] },
    { "section": "skills", "label": "技能", "nodes": [...] }
  ]
}
```

#### 数据文件

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runs/{run_id}/data/{name}` | 读取 data 文件（JSON） |
| `PATCH` | `/api/runs/{run_id}/data/{name}` | patch data 文件 |
| `GET` | `/api/runs/{run_id}/data/content` | 读取任意物理路径文件内容（供 Live Artifact sources 使用） |

```jsonc
// GET /api/runs/{run_id}/data/content?physical_path=state/run_001__data_analysis.json
Response: { /* 原始 JSON 内容，前端再用 selector 提取 */ }
```

#### 消息历史

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runs/{run_id}/messages` | 读取全部消息历史（用于页面刷新恢复） |
| `GET` | `/api/runs/{run_id}/cards` | 读取全部策略卡片及其状态 |

```jsonc
// GET /api/runs/{run_id}/messages
Response: {
  "messages": [
    {"role":"user","content":"分析增长趋势","ts":"...","conversation_id":"conv_001"},
    {"role":"assistant","content":"根据数据...","ts":"...","session_id":"sess_abc",
     "card_ids":["s001"],"cost_usd":0.05}
  ]
}

// GET /api/runs/{run_id}/cards
Response: {
  "cards": [
    {"id":"s001","name":"新增品类","state":"accepted","action":"add","priority":"high",
     "logic":"...","target":"品类A","expected_effect":"提升转化","affect_items":["item_001"]},
    {"id":"s002","name":"调整价格","state":"pending","action":"modify","priority":"medium","...":...}
  ]
}
```

#### 文件预览

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runs/{run_id}/inputs/{file_id}/preview` | 预览上传文件（前 N 行） |
| `GET` | `/api/runs/{run_id}/inputs/{file_id}/download` | 下载原始上传文件 |

```jsonc
// GET /api/runs/{run_id}/inputs/{file_id}/preview?rows=50
Response: {
  "filename": "A1.xlsx",
  "total_rows": 1200,
  "preview_rows": 50,
  "columns": ["spu_id", "name", "price", "category"],
  "rows": [
    ["spu_001", "商品A", 29.9, "小吃"],
    // ...最多 50 行
  ]
}
```

#### Artifacts

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runs/{run_id}/artifacts` | 列出所有 artifacts |
| `GET` | `/api/runs/{run_id}/artifacts/{artifact_id}` | 获取 live artifact（含 sources/view/actions） |
| `GET` | `/api/runs/{run_id}/artifacts/static/{name}/download` | 下载 static artifact |

```jsonc
// GET /api/runs/{run_id}/artifacts/current_view
Response: {
  "artifact_id": "current_view",
  "kind": "live",
  "manifest": { "title": "当前分析", "renderer": "table", "version": 3 },
  "sources": {
    "rows": { "type": "run_file", "path": "runs/run_001/data/analysis.json", "selector": "$.items" },
    "summary": { "type": "run_file", "path": "runs/run_001/data/analysis.json", "selector": "$.summary" }
  },
  "view": { "layout": { "columns": [...], "sort": [], "filters": [] } },
  "actions": { "row_edit": {...}, "apply_strategy_card": {...} }
}
```

#### Skills

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runs/{run_id}/skills` | 获取 skill manifest |
| `PATCH` | `/api/runs/{run_id}/skills/{skill_id}` | 切换 enabled |
| `POST` | `/api/agent/skills/sync-to-workspace` | 同步本地 Skill 到 BA workspace |

```jsonc
// PATCH /api/runs/{run_id}/skills/analysis
Request:  { "enabled": true }
Response: { "skill_id": "analysis", "enabled": true, "sync_status": "synced" }

// POST /api/agent/skills/sync-to-workspace
Response: { "synced": ["analysis", "dashboard-gen"], "failed": [] }
```

#### Workflow（Agent 触发）

| Method | Path | 说明 | 副作用 |
|--------|------|------|--------|
| `POST` | `/api/runs/{run_id}/start-analysis` | 触发分析 | 写 data/analysis.json，创建 live artifact，推进 stage |
| `POST` | `/api/runs/{run_id}/cards/{card_id}/apply` | 采纳/拒绝/修改卡片 | 写 data + cards + strategy_log，返回 CardActionTransaction |
| `POST` | `/api/runs/{run_id}/generate-report` | 生成静态报告 | 写 static artifact，推进 stage |

```jsonc
// POST /api/runs/{run_id}/cards/{card_id}/apply
Request:  { "action": "accept", "reason": "符合策略方向" }
Response: {
  "transaction_id": "txn_20260604_001",
  "card_id": "card_s001",
  "action": "accept",
  "written_paths": [
    "runs/run_001/data/analysis.json",
    "runs/run_001/data/cards.json",
    "runs/run_001/data/strategy_log.jsonl"
  ],
  "events": ["data.updated", "artifact.updated"],
  "render_views_changed": ["current_view"],
  "created_at": "2026-06-04T10:30:00Z"
}
```

#### Agent Chat

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/runs/{run_id}/chat` | 发消息，返回 SSE 流 |

```jsonc
// POST /api/runs/{run_id}/chat
Request:  {
  "prompt": "分析增长趋势，按品类拆解",
  "conversation_id": "conv_001",
  "skill_name": "analysis"   // 可选，默认用 run default skill
}
Response: Content-Type: text/event-stream
  data: {"type":"start"}
  data: {"type":"data-session","data":{"session_id":"sess_abc"}}
  data: {"type":"text-delta","delta":"正在分析..."}
  ...
  data: [DONE]
```

### 17.3 通用约定

- 所有 API 强制 SSO：请求须携带 Cookie `ssoid` 或 Header `X-SSO-Token`
- 错误响应统一格式：`{ "error": "message", "code": "ERROR_CODE" }`
- SSE 流以 `data: [DONE]\n\n` 结束
- 所有写操作返回 `written_paths`（便于前端定向刷新）
- `run_id` 格式：`run_<YYYYMMDD>_<seq>` 或用户自定义（只允许 `[a-z0-9_-]`）

---

## 18. 核心事件架构

### 18.1 事件分层

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: BA 平台事件（BA SSE → 我方后端）               │
│  init / section / resource_synced / done / error        │
├─────────────────────────────────────────────────────────┤
│  Layer 2: ai-sdk wire format 事件（我方后端 → 前端）      │
│  start / text-delta / strategy-card / finish / ...      │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Workspace 状态事件（后端事务 → 前端）           │
│  data.updated / artifact.updated / run.stage_changed    │
└─────────────────────────────────────────────────────────┘
```

### 18.2 完整事件映射表

#### Layer 1 → Layer 2（BA SSE 翻译，由 sse_translator.py 处理）

| BA 事件 | 条件 | 翻译为前端事件 |
|---------|------|--------------|
| `init` | — | `start` + `data-session {session_id}` |
| `ping` | — | 丢弃 |
| `section` usage=`thinking` | — | `reasoning-start` + `reasoning-delta` + `reasoning-end` |
| `section` usage=`conclusion` | 含文本 | `text-start` + `text-delta`(×N, chunk=4字符) + `text-end` |
| `section` usage=`conclusion` | 含 `[[STRATEGY ...]]` | 提取后追加 `strategy-card`（在 `done` 时批量发） |
| `section` usage=`process` kind=`tool_use` | — | `tool-input-start` + `tool-input-available` |
| `section` usage=`process` kind=`tool_use` | tool=`AskUserQuestion` | 额外发 `data-ask-question` |
| `section` usage=`process` kind=`tool_result` | 非排除工具，内容>阈值 | `tool-output-available` + `data-artifact-create` |
| `section` usage=`process` kind=`tool_result` | 内容≤阈值 | 仅 `tool-output-available` |
| `resource_synced` | path 在 `artifacts/` | `data-artifact-ref {artifact_id, path, kind}` |
| `resource_synced` | path 是 run data 文件 | `data.updated {path, run_id}` |
| `resource_synced` | path 是 live artifact 文件 | `artifact.updated {artifact_id}` |
| `tool_request` | — | `data-tool-request {toolUseId, tool, input}` |
| `error` | — | `error {errorText}` |
| `done` | — | 发出累积的 `strategy-card`(s) + `finish {session_id, cost, tokens}` |

#### Layer 3：Workspace 状态事件（后端事务主动推送）

这类事件不来自 BA SSE，由我方后端在写 workspace 后追加到 `events.jsonl`，并通过已有 SSE 连接或下次轮询通知前端。

| 事件类型 | 触发场景 | 数据 |
|---------|---------|------|
| `data.updated` | `write_run_data()` 任何写操作 | `{path, run_id, name}` |
| `artifact.updated` | live artifact version 递增 | `{artifact_id, run_id}` |
| `artifact.static.created` | 新 static artifact 写入 | `{artifact_id, filename, path}` |
| `run.stage_changed` | `create_or_update_run()` stage 变化 | `{run_id, from_stage, to_stage}` |
| `input.updated` | `register_run_input_file()` | `{filename, run_id, rows}` |
| `skills.updated` | `write_run_skill_manifest()` | `{run_id, enabled_count}` |
| `card.accepted` / `card.rejected` | `apply` 事务完成 | `{card_id, action, run_id}` |

### 18.3 前端事件处理逻辑

```javascript
// SSE 消息分发器
function handleSSEEvent(event) {
  switch (event.type) {

    // ── 对话流 ──
    case "start":
      startNewMessage();
      break;

    case "data-session":
      state.agentSessionId = event.data.session_id;
      break;

    case "reasoning-delta":
      appendToThinkingBlock(event.id, event.delta);
      break;

    case "text-delta":
      appendToMessageText(event.id, event.delta);   // 流式打字
      break;

    case "strategy-card":
      renderStrategyCard(event.data);               // 渲染采纳/拒绝卡片
      break;

    case "data-artifact-create":
      // 大 tool 输出自动内联创建，直接用 content 渲染
      openArtifactTab({ ...event.data, source: "inline" });
      break;

    case "data-artifact-ref":
      // workspace artifact，需从后端拉取
      fetchAndOpenArtifact(event.data.artifact_id, event.data.run_id);
      break;

    case "data-ask-question":
      renderInlineQuestionForm(event.data.questions);
      break;

    case "finish":
      finalizeMessage(event.messageMetadata);
      break;

    case "error":
      showErrorBanner(event.errorText);
      break;

    // ── Workspace 状态变更 ──
    case "data.updated":
      // live artifact sources 依赖此文件 → 刷新对应 tab
      refreshArtifactTabsForPath(event.data.path);
      break;

    case "artifact.updated":
      // live artifact 版本递增 → 重新拉取 artifact
      refreshArtifactTab(event.data.artifact_id);
      break;

    case "artifact.static.created":
      // 新静态制品 → 更新文件树 + 弹出 toast
      refreshFileTree();
      showToast(`新报告已生成: ${event.data.filename}`);
      break;

    case "run.stage_changed":
      // Stepper 推进
      updateStepperUI(event.data.to_stage);
      break;
  }
}
```

### 18.4 策略卡片事件生命周期

```
① Agent 在 conclusion 文本中输出 marker
   [[STRATEGY id="s001" name="新增品类" action="add" logic="..."
     target="品类A" expected_effect="提升15%" priority="high"
     affect_items="item_001"]]

② sse_translator 在 done 事件时发出
   {type:"strategy-card", data:{id:"s001", action:"add", state:"pending", ...}}

③ 前端渲染卡片（state=pending），显示操作按钮

④ 用户点击 [✅ 采纳]
   → POST /api/runs/{run_id}/cards/s001/apply  {action:"accept"}
   → 后端 CardActionTransaction
   → 返回 {written_paths:[...], events:["data.updated","artifact.updated"]}

⑤ 前端处理响应
   → 更新卡片 state = "accepted"（禁用按钮）
   → 根据 render_views_changed 刷新 artifact tab
   → 右侧 live artifact 重新从 sources 读取最新 data，自动更新
```

### 18.5 Live Artifact 刷新机制

```
触发源 1：SSE data.updated 事件
  → 检查 event.data.path 是否在当前 tab 的 sources 中
  → 是 → 重新 GET /api/runs/{run_id}/artifacts/{artifact_id}
           → 用新 sources 重新读取 data 并渲染

触发源 2：CardActionTransaction 返回 render_views_changed
  → 直接刷新指定 artifact_id 的 tab

触发源 3：用户手动点击 [⟳ 刷新]
  → 同上，重新拉取 artifact

注意：Live Artifact 渲染器不缓存数据行，
每次刷新均从 sources 指向的 data 文件重新读取。
```
