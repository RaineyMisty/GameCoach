# GameCoach

HTML + CSS + JavaScript 的《英雄联盟手游》教练原型。支持本地演示和 Gemini 真实问答；打开网页无需 Node.js、npm 或构建。

长期愿景、Skill 输入与输出设计、视觉与实时分析规划见 [Product Vision & Skill Architecture](./readme-vision.md)。该文档明确区分当前能力与待实现目标。

## 目录

```text
GameCoach/
├── frontend/        # 全部页面、样式与前端脚本
├── skill/           # 游戏资料、阵容去重、记忆接入、输出处理入口
├── memory/          # 独立长期记忆、相关性筛选与本地管理
├── ai-core/         # 通用模型调用、执行模式、取消和超时
├── back-end/        # 仅目录说明，本阶段不实现后端
├── tests/           # 模块边界、流式回复和存储兼容性测试
├── users/           # 本地用户文件，整个目录由 Git 忽略
├── index.html       # GitHub Pages 的轻量跳转入口
├── .gitignore
├── .nojekyll
├── README.md
├── readme-vision.md  # 长期愿景、Skill 架构与分阶段验收目标
└── LICENSE
```

GitHub Pages 保持 **Deploy from a branch → main → /(root)**。根目录的 index.html 只负责跳转到 frontend，不需要重新配置部署。自己提交并推送更改即可。

本地查看时双击 frontend/index.html。

## 使用

- 顶部选择 Quick 或 Coach；中间输入问题，Enter 发送，Shift+Enter 换行。
- 屏幕右侧以蓝红圆环显示双方阵容，仅展示信息；点击顶部 BP 或输入框下的阵容按钮进入编辑。
- 点击英雄始终从最左侧空位开始，按蓝方、红方交替填充；拖动调整位置，目标已有英雄时交换。普通模式双方可选同一英雄，同队不能重复。右键已选头像或点击叉号取消选择，剩余英雄保留原位置。
- 编辑阵容标题右侧可开启 BP 模式：双方各显示五个禁用位，隐藏选人位置标签，双方选人不可重复。进入 BP 时蓝方选择优先，清除红方重复项。点击禁用位再选英雄即可禁用，点击选人位返回选人；禁用位支持拖动、右键取消和叉号。关闭 BP 保留隐藏的禁用记录，普通模式选中被禁英雄时清除其禁用记录；模式和禁用记录随本地阵容保存。分类栏右侧的“清空阵容”清除选人与禁用记录，并保留当前模式。
- 支持全部英雄、上单、打野、中单、射手、辅助筛选，以及中文名、称号、常见别称和英文名搜索。
- 阵容及位置随消息保存，旧消息不会因后来改动而变化；旧版紧凑名单按原顺序进入五个位置，可自行拖动调整。
- 点击头像创建或切换本地用户。每个用户有独立玩家资料、阵容和最近 30 个对话，每个对话最多 100 条消息。
- 左上角打开历史或开始新对话。
- 顶部导航在滚动长对话时保持可见；模式切换、BP、用户和历史入口均留在顶部。
- AI 回复支持 Markdown 标题、加粗、斜体、列表、引用、代码块、链接和表格，流式生成时同步渲染；旧聊天重新打开也会按 Markdown 显示，原始文本保留在本地备份。用户输入仍按原文显示。

## 接入 Gemini（用户自己的 Key，无 Backend）

1. 打开 [Google AI Studio](https://aistudio.google.com/)，使用 Google 账号登录，然后进入 [API Keys](https://aistudio.google.com/api-keys) 创建或复制 Gemini API Key。模型、免费额度和地区可用性以自己的项目控制台为准；不需要为了试用主动开启付费。
2. 打开 GameCoach：本地双击根目录 index.html 或 frontend/index.html；线上打开自己部署的 GitHub Pages 地址。
3. 点击输入框下方“连接 AI”，或点击头像找到“AI 连接”。粘贴 Gemini API Key，点击“启用 Gemini”。提交后输入框会清空；启用只切换配置，并不代表密钥已经验证。
4. 点击“测试连接”检查密钥能否读取 Quick、Coach 两个模型的元信息。这个检查不生成回复，也不能保证剩余额度；关闭侧栏，新建对话并发送“你好，请用一句话介绍自己”，验证实际生成。成功的回复显示“AI 回复”。
5. Quick 使用 gemini-3.5-flash-lite、thinkingLevel=MINIMAL、最多 512 个生成 token、10 秒超时；Coach 使用 gemini-3.8-flash、thinkingLevel=MEDIUM、最多 4096 个生成 token、60 秒超时。Quick 的最低思考档不等于完全关闭思考，也不能保证固定延迟；生成额度包含思考消耗。两档都流式显示答案，不显示思考内容。
6. 在同一个聊天中切换 Quick / Coach，历史继续保留；切换会停止正在生成的请求，下一条使用新配置。也可点击发送按钮变成的停止按钮。
7. Key 只保存在当前页面内存，刷新 / 关闭网页后需重新填写；“断开并清除密钥”立即恢复本地演示。Key 不写进代码、浏览器应用存储、用户 JSON 或导出文件。不要把 Key 发到聊天里或提交 GitHub。浏览器自己的密码管理行为不由应用控制。

Skill 会补充当前游戏、蓝红选人、有效 Ban、BP 规则及按需选取的长期记忆。玩家资料不再单独直接注入请求，改为个人记忆；普通“选什么”不会自动按常用位置分配本局角色，也不把英雄池当作候选白名单。同一阵容在一次请求中只展开一次，历史快照通过短标签引用。前端取最近 20 条有效历史；Coach 再按完整轮次控制在通常 8 条、5000 文本字符以内，保护最近一轮、当前问题和引用目标。受保护原文过长时允许超预算；这是文本软预算，没有精确 Token 截断或自动语义摘要。Coach 默认不附技能资料，明确问机制时才附小段相关资料；中英文规则逐条对应，每次只发送当前语言。本地保存不代表模型在本地运行，发问时相关内容仍会发送到 Google Gemini。免费档的数据处理方式见 Google 的服务条款，避免发送敏感个人信息。

常见问题：

- 密钥外观：Google AI Studio 新版密钥可以 AQ. 开头，旧版常见 AIza 开头；不要根据固定长度判断真假。使用复制按钮取得完整值，不要复制列表里的掩码、名称或项目 ID。网页只做基本输入检查，密钥有效性由 Google 接口验证。

- 400 / API Key 无效：重新从 AI Studio 复制 Gemini Key，不要使用旧的其他平台 Key；检查项目是否满足免费档或计费要求。
- 403：检查地区、项目权限及 Key 的 API / 网站来源限制。如果设置网站限制，请允许自己的 GitHub Pages 域名；file:// 没有普通网站来源，可能需要从 HTTPS 页面测试。
- 404：检查 ai-core/gemini.js 中的 models 和当前项目开放的型号。
- 429：免费额度耗尽、项目没有可用额度或调用频率过高，去 AI Studio 查看配额。临时网络/限流/服务器错误最多尝试 3 次，共用该档总超时，并尊重 Retry-After；等待超过剩余时间就直接提示。密钥、权限和参数错误不重试，已输出部分文字时保留内容并提供手动重试。
- 无法连接：检查网络；浏览器限制本地文件请求时，使用编辑器本地预览或 GitHub Pages 的 HTTPS 地址。
- 达到生成上限：页面标注截断，可继续追问；若思考消耗完额度而没有答案，缩短问题或改用 Quick。

当前只使用无服务端会话的 generateContent 流式接口，不创建 Google 服务端聊天会话、数据库或 Backend。模型和思考档位集中在 ai-core/gemini.js 中。依据：[API Key](https://ai.google.dev/gemini-api/docs/api-key)、[思考配置](https://ai.google.dev/gemini-api/docs/thinking)、[REST 接口](https://ai.google.dev/api/generate-content)、[免费档与价格](https://ai.google.dev/gemini-api/docs/pricing)。

### 游戏资料与联网

Skill 现在按问题附上相关英雄的官方技能快照：端游 Data Dragon 16.20.1，手游腾讯目录 7.3，均采集于 2026-10-18；并非实时比赛版本。回答下的“资料来源”区分本地快照与实际联网结果。资料范围与维护方法见 [resources/README.md](./resources/README.md)。

“AI 连接”里的“资料检索”有三档：默认“按需联网”，遇到版本、更新或明确查资料的请求时允许 Google Search；“允许模型联网核实”每次允许；“仅使用本地资料”关闭搜索工具。允许不代表每次一定搜索，实际检索由 Gemini 决定。搜索可能增加延迟、用量或费用，取决于账号计划；只有接口实际返回的检索来源才标为联网。Google 返回的搜索建议也会显示。依据：[Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search)。

Quick 采用自然简短的回答；Coach 默认按当前问题展开，只有明确要求全面分析才写完整报告。“深入解释”引用被点击的回答和原问题，保留其阵容快照，不更改当前编辑器。非常规选人按用户指定的英雄、位置和经济条件分析可行性与代价，不能预设辅助只能保人。闲聊和失败后的连接询问无需重新分析阵容。

## 本地用户文件夹

默认保存在浏览器，不上传账号、档案或对话。用户系统是本机配置，未实现在线身份验证和云端账号。

在用户面板中点击“连接本地用户文件夹”，选择项目里的 users 目录。支持 File System Access API 的浏览器（推荐 Chrome / Edge）会请求目录读写权限。GitHub Pages 的 HTTPS 地址可使用此功能；不支持的浏览器仍可使用浏览器存储和导入 / 导出。

连接后，每个用户保存为 `<用户ID>.json`，目录中还有 gamecoach-index.json 索引。打开已保存的目录会合并本地用户：同 ID 使用更新时间较新的数据。刷新后需重新点击连接；浏览器不会无提示访问本机路径。导入 JSON 备份始终创建独立用户，不覆盖已有用户。

users 目录已在 .gitignore 中整体排除。本地目录是空目录时 Git 不会上传或创建它；换电脑请自己建一个 users 目录并连接，或导入备份。不要手动把个人 JSON 放进 frontend。

旧版同一网站地址的浏览器档案会自动迁移为默认本地用户，旧存储保留。不同浏览器、设备或 file:// 地址的存储可能不同，建议先导出备份。

## 演示边界

未启用 Gemini 时，ai-core 默认使用本地 demo provider，不联网、不调用真实模型；启用后会调用 Gemini，实际费用与额度由你选择的账号计划决定。前端只显示 Skill 返回的内容，没有固定建议或 50 分评分。手游英雄名单来自手游官网 2026-10-18 快照，共 142 位；端游英雄名单、中文名称与共用头像来自 Riot Data Dragon 16.20.1，别称和常用位置由项目整理。位置分类不代表官方推荐、强度或当期版本结论。

调用链为 Front-End → Skill → ai-core → Skill → Front-End，独立 memory 模块向 Skill 提供按需选择的可选经验。Skill 的 input/ 整理游戏、记忆与消息，output/ 当前原样转交流式回复和最终结果，预留评分、文字整理和资料关联位置。Quick / Coach 仍通过 ai-core 执行配置切换。代码阅读入口及消息示例见 [skill/README.md](./skill/README.md)。ai-core 接受通用文本或消息列表，不要求游戏专用字段。

## 长期记忆

点击头像 →“管理记忆”，可以新增、编辑、暂停、删除，或关闭整个记忆模块。初始七条包括辅助选人、打野决策、中下双 C、阵容发展、对手应对，以及本局分工与摇摆、经验与判断。它们是可选经验，不是每轮必须执行的模板。记忆保存在每个本地用户中，连接 users 文件夹后随 JSON 同步，支持完整用户备份以及单独导出 Markdown 文档。

聊天中输入“记住：讨论辅助时，希望多探索大胆配合”可以明确保存；“忘记：记忆编号”可以删除。显示“本地记忆”的回执不会调用 API。普通战报不会静默转换成永久偏好，当前未实现 AI 自动提炼隐式记忆。

Quick 每次最多带入六条相关记忆；Coach 使用更小预算，最多三条、正文 600 字符，回答下可查看实际带入的标题；数据已提供不代表模型一定采用。当前使用字符预算控制记忆长度，仍消耗输入 Token，并非 Codex 的自动上下文压缩。详见 [memory/readme.md](./memory/readme.md)；初始经验见 [analysis-preferences.md](./memory/analysis-preferences.md)。

Quick / Coach 硬切换 ai-core 的调用配置：demo-instant / none / 128 输出额度，以及 demo-reasoning / medium / 1024 输出额度。并非仅在提示词中要求简短或详细。演示 provider 不模拟真实推理或 token 计费，也不能用它衡量真实模型延迟。接真实 provider 时需根据模型实际支持的参数映射执行配置。

回复支持逐段显示和停止。生成时切换模式、用户、对话会取消原请求；切换模式保留同一对话，下一条请求使用新配置。历史保存在本机，每次调用带最近 20 条有效历史消息。失败或停止的 AI 回复不会作为后续 AI 历史发送。

Gemini 通过 ai-core/gemini.js 的 provider 适配器接入。当前保留用户自带 Key 的纯静态方案，back-end 继续占位。当前代码不包含真实 API 密钥。接口详见 ai-core/README.md 与 skill/README.md。

Markdown 使用 frontend/vendor 内固定版本的 Marked / DOMPurify，离线可用，不请求 CDN。模型内容先经过 HTML 清理，代码片段以文字显示；表格和代码块在自身区域横向滚动。

浏览器验证：打开 tests/markdown.html 可运行 Markdown 格式、流式片段与 HTML 安全过滤检查，无需 API Key。

开发验证（仅测试需要 Node.js，打开网页不需要）：`node --test tests/*.test.cjs`。

真实模型语义验收案例见 [tests/skill-quality-cases.json](./tests/skill-quality-cases.json)。自动测试验证消息、检索、重试和历史行为；无法替代真实模型回答质量验收。

许可证见 LICENSE。

英雄数据来源：[手游官方英雄目录](https://wildrift.leagueoflegends.com/en-us/champions/)与 [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)。共用头像保存在 resources/lol/champion-icons，手游独有头像保存在 resources/lolm/champion-icons，浏览和选人无需联网；角色图像版权归 Riot Games。头像来源记录见各目录的 sources.json。

## BP 自动填充规则

开启 BP 模式后，标题旁会显示规则下拉框。三种流程各有蓝方先选、红方先选两个版本，共六个选项。以下数量均指每一方：

| 流程 | 禁用与选人阶段 |
| --- | --- |
| 五禁后选五 | 每方禁 5 个，再选 5 个 |
| 分段禁选 | 每方禁 3 个 → 选 3 个 → 禁 2 个 → 选 2 个 |
| 三禁后选五 | 每方禁 3 个，再选 5 个 |

以 A 为先选方、B 为后选方，分段流程依次为：禁用 ABABAB，选人 ABBAAB，禁用 BABA，选人 BAAB。五禁与三禁模板的禁用阶段按 AB 交替录入，选人顺序为 ABBAABBAAB，即 1–2–2–2–2–1 分组。它们是顺序录入模板，不模拟排位客户端的同时禁用与倒计时。

点击英雄会自动填写当前阶段、当前队伍的下一个空位。已有选择会跳过，删除后优先补回规则中最早的空位。手动点击禁用位可修改该位，填一次后恢复自动流程。BP 模式下，选人位和禁用位支持互相拖动，也可跨蓝红方；拖到空位时移动，拖到已有英雄的位置时交换两位英雄。拖动英雄列表里已经选中或禁用的英雄，也会移动或交换其现有位置，之后恢复自动流程。

切换规则保留已有选择与禁用记录。三禁模板暂时隐藏第 4、5 个禁用位，这些隐藏记录不参与当前禁用限制；切回五禁会恢复显示。若其英雄已被选中，对应禁用记录会清除。规则与模式一并本地保存，清空阵容保留规则选择。

分段顺序参考 [ESL Snapdragon Pro Series Wild Rift 官方赛事规则，第 6.7.3 节](https://cdn.eslgaming.com/misc/gfx/media/play/global/sps/rulebooks/wildrift.pdf)。三禁是旧版/自定义模板，可参阅 [Wild Rift 2.4 官方说明](https://wildrift.leagueoflegends.com/en-gb/news/dev/dev-patch-2-4-ranked-updates/)。蓝红方与先后选分离可参阅 [Riot 2026 First Selection 说明](https://lolesports.com/en-AU/news/season-start-2026-lol-esports)；本工具用先选方 A、后选方 B 镜像流程，未实现系列赛无畏征召。
## 游戏与资源

主界面左上角切换“英雄联盟 / 英雄联盟手游”。两个游戏使用各自的英雄池，切换时沿用当前阵容、禁用记录、BP 模式和规则；目标游戏没有的英雄会从原位置清除，其余位置保持不变。切回时不会恢复已经清除的英雄，也不会覆盖成旧的独立阵容。刷新、导入导出保留当前选择；旧版用户数据及消息自动归入手游。聊天中每条消息的阵容带有自己的 gameId，不受之后切换游戏影响。

- resources/lol/champions.js：端游英雄数据，Riot Data Dragon 16.20.1，173 位英雄。
- resources/lolm/champions.js：手游英雄数据，2026-10-18 官方目录快照，142 位英雄。
- resources/lol/champion-icons/：两个游戏共用的头像文件目录，按统一英雄 ID 命名，例如 ahri.png。
- resources/lolm/champion-icons/：手游独有英雄头像，例如 norra.png；已有共用头像不重复保存。
- frontend/data.js：游戏目录和数据源入口，保留 GAMECOACH_DATA 兼容别名。

已从 Riot 官方 Data Dragon 16.20.1 下载 173 张 128×128 英雄方形小头像，两个游戏共用。手游独有英雄诺拉的小头像来自腾讯手游官网英雄目录的 avatar 字段，也保留官方原始 128×128 PNG，单独存放在手游目录。每张图片的源地址、尺寸与下载日期记录在对应头像目录的 sources.json。端游位置筛选参考既有分类与 Riot 类型标签，不表示当期版本的强势分路。

后续游戏可以新增 resources/<游戏 ID>/champions.js 数据源，在 index.html 中按顺序加载后由 GameCoachGames 列出；不同游戏的位置分类与 BP 规则可继续按其玩法扩展。数据源脚本保存在本地，双击 HTML 与 GitHub Pages 均不依赖跨目录 fetch。

端游名单来源：[Riot Data Dragon 英雄数据](https://ddragon.leagueoflegends.com/cdn/16.20.1/data/en_US/champion.json)。
