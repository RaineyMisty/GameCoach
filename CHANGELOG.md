# GameCoach 变更记录与项目结构

更新日期：2026-10-27。本文记录本轮 FastAPI + SQLite、多厂商 API、数据同步、安全与部署改动，并提供可用于后续提交的 commit 标题。

**v0.0.1 发布范围：** 在 `fdd01c1` 基线上加入 Pages / 远程后端适配、精确 CORS、按后端隔离的恢复能力，以及树莓派服务模板。实际公网地址未填，树莓派端到端部署仍待验证。接口适配测试通过不代表五家厂商均已完成真实付费问答测试。

## v0.0.1：远程后端连接

- `Feat(connection): configure a fixed HTTPS backend for GitHub Pages`：新增 `frontend/config.js`，在 `frontend/index.html` 加载；`ai-core/backend.js` 使用固定后端 origin，拒绝不安全地址、凭证 URL 和重定向，Pages 未配置时给出明确提示。
- `Feat(cors): allow explicitly configured frontend origins`：`back-end/main.py`、`secure_config.py`、`manage_config.py` 增加精确 CORS 来源及 `--frontend-origin` 参数，支持 Authorization / 访问码预检，不使用 Cookie 或通配来源。
- `Fix(recovery): bind sessions and recovery files to the API origin`：会话按后端分区，保留原同源会话迁移，version 2 恢复文件可在指向同一后端的不同页面恢复；不向新后端自动发送旧身份。
- `Feat(deployment): add a systemd template for the Raspberry Pi backend`：新增 `deploy/gamecoach.service.example` 并纳入部署包；仅监听本机，模板需替换实际用户与路径后安装。
- `Doc(deployment): document Funnel setup and Pages connection`：更新部署步骤、README 与本文；树莓派尚未生成公网地址，配置与端到端验证需继续完成。
- 新增 `back-end/test_cors.py`，扩充 `tests/backend.test.cjs`、`back-end/test_deployment.py`；前者覆盖预检、认证错误、来源拒绝，后者验证跨站请求、凭证隔离及恢复兼容。

## 1. Commit 命名约定

统一使用 `类型(模块名称): 具体改动`，冒号使用英文半角。

| 类型 | 使用场景 | 示例 |
| --- | --- | --- |
| `Feat` | 新增能力、接口或模块 | `Feat(backend): 新增 FastAPI 会话与 SQLite 聊天接口` |
| `Fix` | 修复现有代码的问题或错误行为 | `Fix(storage): 修复切换厂商后历史不共用的问题` |
| `Doc` | 新增、修订说明文档 | `Doc(deployment): 补充树莓派无域名测试步骤` |

“改代码”按目的区分：新增功能用 `Feat`；修正原有行为用 `Fix`；仅修改文档用 `Doc`。同一个提交尽量处理一个完整问题，相关验证可以随代码一起提交。历史提交保留原名，不为统一格式改写既有 Git 历史。

## 2. 上一阶段功能记录（已提交）

下面按功能整理上一阶段改动；标题用于说明范围，不表示与实际 Git 提交一一对应。实际提交记录以 `git log` 为准。

### Feat(backend): 新增 FastAPI 会话校验与 SQLite 聊天存储

- 新增 `back-end/main.py`、`back-end/requirements.txt`，提供会话、对话、消息与健康检查接口。
- 服务端校验 Bearer 会话和对话归属，读取最近 10 个完整问答轮次，再调用模型。
- 模型成功后在同一事务保存用户资料、用户消息和模型回复；调用失败不保存半轮问答。
- 请求 ID 与请求内容匹配时返回已保存结果；同 ID 内容变更、对话并发修改会报冲突。
- 对应验证：`back-end/test_api.py`。

### Feat(providers): 统一 Gemini、DeepSeek、OpenAI、Grok 和 Claude 接口

- 新增 `back-end/providers.py`，将五家厂商协议转换为统一聊天结果。
- Gemini 使用 generateContent；DeepSeek 使用 Chat Completions；OpenAI / xAI 使用 Responses；Claude 使用 Messages。
- 统一正文、模型、实际厂商、结束原因、Token 用量与错误码；Quick / Coach 映射为各厂商执行参数。
- 厂商地址固定为官方 HTTPS 地址，前端不能传入任意上游地址；不自动切换厂商或重试生成。
- 模型 HTTP、DNS、TLS 与 Key 使用均由 Python 服务处理。
- 对应验证：`back-end/test_providers.py`；真实可用模型仍取决于账号权限、额度和服务器网络。

### Fix(frontend): 恢复 Local database 选择并分离通用 API 连接

- `frontend/index.html` 恢复 Local database 的 Default / Import，仅管理用户数据。
- 原 Connect Gemini 改为通用 API 连接，列出支持厂商，并提供团队访问码输入。
- `frontend/ai-settings.js` 支持输入 Key，或留空使用当前用户已保存 / 服务器默认 Key；提交后清空敏感输入。
- 新增 `ai-core/backend.js`，主页面通过同源 `/api/` 连接后端，停止加载浏览器直连 Gemini 适配器。
- `ai-core/index.js`、`skill/index.js` 传递服务器对话信息，接收统一结果与实际使用的记忆。
- `frontend/translations.js` 补充新控件与错误状态的翻译。
- 对应验证：`tests/api-settings.test.cjs`、`tests/backend.test.cjs`。

### Feat(storage): 同一用户跨厂商共用历史、资料和 training memory

- SQLite 用户身份与模型厂商分离，切换厂商继续使用同一用户和服务器对话。
- `GET / PUT /api/user-state` 同步资料、阵容、历史与 memory；版本校验避免静默覆盖。
- 首次同步导入已完成的真实问答，排除 demo、失败和已停止记录；后续不重复覆盖已有主历史。
- 新增 `back-end/training_memory.py`，从服务器用户快照按相关性和预算选取记忆；暂停的记忆不参与。
- `frontend/storage.js`、`frontend/app.js` 保留本地缓存、普通 JSON 导入导出与文件夹备份。
- training memory 是检索后加入上下文的经验，不是模型训练；浏览器和服务器各自承担管理与检索职责。
- 对应验证：`back-end/test_training_memory.py`、前后端同步测试。

### Feat(security): 加密用户密钥与敏感数据并加入私有身份恢复

- 新增 `back-end/secure_config.py`，支持环境变量和私有 JSON 配置，环境变量优先。
- 使用 Fernet 加密各用户各厂商 Key、用户姓名与资料、聊天正文与上下文、元数据和用户快照。
- 会话令牌和恢复凭证在数据库中保存哈希；会话按认证访问续期，当前有效期为 7 天。
- API 不返回厂商 Key；普通用户 JSON 不包含 Key、会话或恢复凭证。另设私有恢复文件以找回服务器身份。
- 生产环境要求固定主密钥、足够长的访问码、Host 白名单和 HTTPS；加入请求大小与生成频率限制。
- 固定错误码避免回显上游错误中的密钥、输入或敏感 URL；静态路由不暴露后端、配置或数据库目录。
- 对应验证：`back-end/test_security.py`。字段加密不等于全磁盘加密，也不替代主密钥和备份管理。

### Fix(sync): 恢复已保存但未送达浏览器的回复并保留本地修改

- 使用客户端回复 ID 将服务器已完成答案补回对应的本地消息。
- 重新连接时恢复已保存回复，保留较新的本地 memory 修改；同步失败仍保留本地副本。
- 会话失效时可用私有恢复凭证找回原用户，避免把同一个人重新建成新服务器用户。
- 停止浏览器等待不保证取消上游生成，失败后也不承诺任意情况下恰好调用一次模型。
- 对应文件：`ai-core/backend.js`、`frontend/app.js`、`frontend/storage.js`、`back-end/main.py`。

### Feat(deployment): 增加私有配置工具、代码部署包与容器部署文件

- 新增 `back-end/manage_config.py`，隐藏输入 Key，生成主密钥、访问码和生产配置，拒绝覆盖已有配置。
- 新增 `scripts/package_deploy.py`，按允许列表生成 `dist/gamecoach-deploy.zip`，排除秘密和用户数据。
- 新增 `Dockerfile`、`compose.yaml`、`Caddyfile`，提供 Python 非 root 服务、SQLite 持久卷与 Caddy HTTPS 入口。
- 新增 `.dockerignore`、`.env.example`，扩充 `.gitignore`；`.env.example` 只放公开域名模板。
- 对应验证：`back-end/test_deployment.py`。当前 Windows 环境没有完成 Docker / 树莓派实机部署验证。

### Doc(project): 更新架构、变更记录、目录归属与部署说明

- 新增本文，记录待提交改动、真实 Git 历史与详细项目结构。
- 更新 `README.md`、`README_zh.md`、`ai-core/README.md`、`back-end/README.md` 中的连接与安全说明。
- 扩充 `DEPLOYMENT.md`：无自有域名的树莓派测试、GitHub Pages 限制、运行维护、备份恢复与验收。

## 3. 详细项目结构

标记：`[浏览器]` 在用户网页运行；`[服务器]` 在树莓派 / Python 服务运行；`[开发]` 用于构建、维护、验证；`[私有]` 不能公开发布；`[文档]` 为说明文件。

`新增` / `修改` 指本轮主要变更。树中的运行数据目录可能尚未创建，不是应提交的源码。`ai-core/`、`skill/`、`memory/` 都包含浏览器代码，不能仅凭名字把它们当作 Python 后端。

```text
GameCoach/
├── frontend/                           # [浏览器] 页面、交互与本地缓存
│   ├── index.html                      # 修改：Default / Import、通用 API 表单、恢复入口
│   ├── config.js                       # 本次新增：公开 HTTPS 后端 origin，不能写密钥
│   ├── styles.css                      # 页面与弹窗样式
│   ├── app.js                          # 修改：聊天交互、数据切换、回复恢复与备份操作
│   ├── ai-settings.js                  # 修改：厂商选择、Key 提交、连接状态与错误展示
│   ├── storage.js                      # 修改：本地用户、快照恢复、同步通知、普通 JSON
│   ├── translations.js                 # 修改：新 API / 数据控件与提示语翻译
│   ├── i18n.js / i18n.md                # 语言加载与说明
│   ├── conversation.js                 # 聊天消息与历史处理
│   ├── draft.js / draft-ui.js           # 阵容、位置与 BP 交互
│   ├── memory-ui.js                     # memory 新增、编辑、暂停、删除与导出
│   ├── markdown.js / message-sources.js # Markdown 安全渲染与资料来源展示
│   ├── data.js                         # 游戏数据入口
│   └── vendor/                         # 固定版本 Markdown / HTML 清理库及许可
├── ai-core/                            # [浏览器] 模型执行调度与后端客户端
│   ├── index.js                        # 修改：模式、超时、取消、统一结果与对话传递
│   ├── backend.js                      # 固定后端 /api/、按后端隔离会话、同步、恢复与聊天
│   ├── gemini.js                       # 旧版浏览器直连适配；主页面不再加载
│   └── README.md                       # 模块边界与使用说明
├── skill/                              # [浏览器] 游戏问题与提示词组装
│   ├── index.js                        # 修改：调用后端、传递当前问题和上下文
│   ├── rules.js                        # 分析规则与指令
│   ├── input/
│   │   ├── prepare.js                  # 输入组装
│   │   ├── game.js                     # 阵容与游戏上下文
│   │   ├── history.js                  # 历史整理
│   │   └── knowledge.js                # 本地参考资料筛选
│   ├── output/index.js                 # 回复转交与后续输出处理入口
│   └── README.md
├── memory/                             # [浏览器] 可公开的记忆管理代码与默认经验
│   ├── index.js / commands.js           # 模块入口、显式记住 / 忘记命令
│   ├── retrieve.js                     # 浏览器侧记忆筛选；后端模式由 Python 选择
│   ├── defaults.js / locales.js         # 默认经验及多语言内容，不是私人用户数据库
│   ├── analysis-preferences.md          # 默认经验说明
│   └── readme.md
├── back-end/                           # [服务器] Python API 与 SQLite；不发布到静态站
│   ├── main.py                         # 新增：认证、权限、会话、历史、同步、聊天、静态服务
│   ├── providers.py                    # 新增：五家厂商适配、联网与统一错误处理
│   ├── training_memory.py              # 新增：服务器按用户选取相关 memory
│   ├── secure_config.py                # 新增：私有配置读取、字段加密 / 解密
│   ├── manage_config.py                # 新增：[管理] 生成私有生产配置，不是公开 API
│   ├── requirements.txt                # 新增：FastAPI、Uvicorn、httpx、cryptography
│   ├── README.md                       # 接口契约、配置变量与测试说明
│   ├── test_api.py                     # 新增：[开发] 认证、历史、事务与并发
│   ├── test_providers.py               # 新增：[开发] 厂商协议和错误映射
│   ├── test_security.py                # 新增：[开发] 隔离、加密、恢复和传输约束
│   ├── test_training_memory.py         # 新增：[开发] 服务器记忆选择
│   ├── test_deployment.py              # 新增：[开发] 配置与打包秘密排除
│   ├── test_cors.py                    # 本次新增：[开发] 精确来源、预检与认证响应
│   ├── data/                           # [服务器][私有] 运行时生成，Git 忽略
│   │   └── gamecoach.sqlite3            # 用户、会话、对话、消息、凭证与 memory 快照
│   │                                   # 运行时还可能存在 -wal / -shm 文件
│   └── .secrets/                       # [服务器 / 管理][私有] Git 忽略
│       ├── storage.key                 # 本地模式首次启动生成的加密主密钥
│       └── server.json                 # 管理工具生成的生产配置、Key、主密钥、访问码
├── resources/                          # [浏览器] 可公开的游戏资料快照与头像
│   ├── lol/                            # 端游英雄、英文信息、技能与 champion-icons/
│   ├── lolm/                           # 手游英雄、技能与 champion-icons/
│   ├── update-knowledge.cjs            # [开发] 更新快照工具，不在网页执行
│   └── README.md                       # 版本、来源与维护说明
├── tests/                              # [开发] 浏览器 / Node.js 验证
│   ├── api-settings.test.cjs            # 新增：通用 API 表单与敏感输入处理
│   ├── backend.test.cjs                 # 新增：后端客户端、会话与跨厂商数据复用
│   ├── i18n.test.cjs                    # 修改：多语言与用户导出兼容性验证
│   ├── *.test.cjs                      # 既有阵容、Skill、记忆、Markdown 等验证
│   └── *.html / *.browser.js            # 浏览器可打开的渲染与来源验证页
├── scripts/                            # [开发 / 管理]
│   └── package_deploy.py               # 新增：生成不含秘密 / 数据的代码部署包
├── deploy/                             # [服务器 / 管理] 安装前需配置的运维模板
│   └── gamecoach.service.example        # 本次新增：Python 后端 systemd 模板
├── users/                              # [用户电脑][私有] 可自行创建的本地 JSON 备份目录
├── dist/                               # [开发] 生成物，Git 忽略
│   └── gamecoach-deploy.zip             # 可分享代码包，不包含数据库和私有配置
├── .venv/                              # [开发 / 服务器] 本机 Python 环境，不提交、不跨平台复制
├── Dockerfile                          # 新增：[服务器] Python 容器构建与启动
├── compose.yaml                        # 新增：[服务器] app + Caddy + secret + 持久卷
├── Caddyfile                           # 新增：[服务器] HTTPS 与 app:8000 反向代理
├── .env.example                        # 新增：公开域名模板，不含 Key
├── .env                                # [管理][私有] Compose 读取的本机配置，Git 忽略
├── .dockerignore                       # 新增：排除秘密、个人数据与构建无关文件
├── .gitignore                          # 修改：排除密钥、数据库、用户 JSON 与生成物
├── index.html                          # GitHub Pages 根入口，跳转 frontend/index.html
├── .nojekyll                           # 静态发布标记
├── CHANGELOG.md                        # 新增：[文档] 本文：变更、提交记录、完整目录
├── DEPLOYMENT.md                       # 新增：[文档] 安全部署、树莓派测试与运行维护
├── README.md / README_zh.md             # 修改：[文档] 英文 / 中文项目入口
├── readme-vision.md                     # [文档] 长期愿景与尚未实现的目标
└── LICENSE
```

### 服务器数据与浏览器数据的区别

| 内容 | 位置与职责 | 是否公开 |
| --- | --- | --- |
| 页面、脚本、默认经验、游戏快照 | `frontend/`、`ai-core/`、`skill/`、`memory/`、`resources/` | 可以，但不能往这些目录塞个人数据或 Key |
| 用户缓存、待同步修改 | 用户浏览器存储 | 私人数据；静态源码不包含这些运行数据 |
| 会话及恢复能力 | 浏览器 sessionStorage；服务器仅存凭证哈希 | 私有，不能截图分享或混入普通导出 |
| 用户资料、消息、memory 快照 | 服务器 SQLite；敏感字段加密 | 私有；不是 `memory/defaults.js` |
| 各用户各厂商 Key | SQLite `credentials`，按用户和厂商隔离加密 | 私有，API 不返回原值 |
| 服务器默认 Key、主密钥、访问码 | 私有 `server.json` 或服务器环境变量 | 私有，不进入 Git / 镜像 / 代码包 |
| 普通用户 JSON / 私有恢复文件 | 用户主动导出；可以存放在电脑选定位置 | 均需保护；恢复文件尤其等同账号凭证 |
| Compose 持久数据 | `gamecoach_data` 存 SQLite；`caddy_data` / `caddy_config` 存代理运行数据 | 私有；不是仓库内的普通源文件 |

### 当前实际调用路径

```text
浏览器（用户电脑）
  frontend → skill（组装问题、阵容与本地资料）→ ai-core/backend.js
                                      │ 配置的 HTTPS 后端 /api/
                                      ▼
服务器（家中树莓派或其他主机）
  HTTPS 入口 → FastAPI 会话与归属校验
                     │
                     ├── SQLite：读取该用户历史、资料与 memory 快照
                     ├── training_memory.py：选择相关经验
                     └── providers.py：服务器 DNS / HTTPS → 所选模型厂商
                                                                  │
                        浏览器显示 ← 统一结果 ← SQLite 事务保存 ← 完整回复
```

当前为完整回复保存后一次返回，未实现后端流式 SSE。静态 demo 模式不经过真实模型。Pages 分离部署的代码已加入，需填写实际后端地址、配置 CORS、发布并完成实机验证。

## 4. 真实 Git 提交历史

以下保留第一次整理时截至 `696bf40` 的历史快照与原始标题。此后上一阶段功能已提交，目前基线为 `fdd01c1`；完整最新历史请查看 `git log`。

| 日期 | Commit | 原始标题 |
| --- | --- | --- |
| 2026-10-26 | `696bf40` | Improve clarity in README content |
| 2026-10-26 | `f899499` | Feat: add error detect |
| 2026-10-26 | `2b0b076` | Docs: add en readme |
| 2026-10-19 | `dd8c58a` | Fix(skill): coach mode to many token |
| 2026-10-19 | `607bc95` | Feat(language): add english version |
| 2026-10-19 | `b43a97d` | Feat(skill): add and update memory |
| 2026-10-18 | `61dc934` | Docs: i wish we can make it in the future))) |
| 2026-10-18 | `79ea568` | Refactor: change dir name |
| 2026-10-18 | `960ecb6` | Refactor: change dir name |
| 2026-10-18 | `ba9c866` | Feat(resources): add icons |
| 2026-10-18 | `9e5647b` | Feat(ui): add game change |
| 2026-10-18 | `b5e0201` | Feat(ui): add ban-pick mode |
| 2026-10-18 | `47be596` | Feat(ui): optimize ban-pick window |
| 2026-10-18 | `263aff2` | Feat(ui): optimize ui art |
| 2026-10-18 | `e5ca4e6` | Feat(ai core): use gemini api |
| 2026-10-18 | `7787d3b` | Feat(ai core): add ai api |
| 2026-10-14 | `4a74e13` | Feat(page): update new page art |
| 2026-10-14 | `84e4b72` | Feat(page): create web page |
| 2026-10-14 | `e8928e4` | Add license |
| 2026-10-14 | `331395b` | Initial commit |

v0.0.1 的远程连接改动列在本文开头，具体提交 hash 以版本标签与 `git log` 为准。

## 5. 验证与待完成事项

- 代码阶段已有后端单元测试与 Node.js 测试验证；厂商回复使用模拟数据，不能代替真实 Key 的端到端测试。
- 本轮文档更新核对了实际目录、代码配置和 Git 历史，不宣称树莓派 / Docker 已经上线成功。
- DeepSeek 此前的无 Key 网络请求收到 HTTP 401，只证明当时能够访问服务；未证明真实问答或额度可用。
- 仍需在家中树莓派完成：真实生成、刷新与恢复、跨厂商历史与 memory、重启后数据库可读、备份恢复演练。
- GitHub Pages 连接远程 API 的代码已实现，但实际地址、Funnel 开通、源码发布和端到端测试仍待完成；未配置时保留静态 / demo。
- 没有密码登录、管理后台、自动备份、自动更新或数据库版本迁移框架；当前方案面向小范围受邀测试，未完成负载与高可用验证。

部署步骤、边界和验收以 [DEPLOYMENT.md](./DEPLOYMENT.md) 为操作入口。
