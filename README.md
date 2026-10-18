# GameCoach

HTML + CSS + JavaScript 的《英雄联盟手游》教练原型。支持本地演示和 Groq 真实问答；打开网页无需 Node.js、npm 或构建。

## 目录

```text
GameCoach/
├── frontend/        # 全部页面、样式、脚本与头像
├── Skill/           # 占位 Skill：请求和流式回复原样转交
├── AI-Core/         # 通用模型调用、执行模式、取消和超时
├── Back-End/        # 仅目录说明，本阶段不实现后端
├── tests/           # 模块边界、流式回复和存储兼容性测试
├── users/           # 本地用户文件，整个目录由 Git 忽略
├── index.html       # GitHub Pages 的轻量跳转入口
├── .gitignore
├── .nojekyll
├── README.md
└── LICENSE
```

GitHub Pages 保持 **Deploy from a branch → main → /(root)**。根目录的 index.html 只负责跳转到 frontend，不需要重新配置部署。自己提交并推送更改即可。

本地查看时双击 frontend/index.html。

## 使用

- 顶部选择 Quick 或 Coach；中间输入问题，Enter 发送，Shift+Enter 换行。
- 右上角 BP 打开选人面板。阵容会随每条消息保存，不会因后来修改而改变旧消息。
- 点击头像创建或切换本地用户。每个用户有独立玩家资料、阵容和最近 30 个对话，每个对话最多 100 条消息。
- 左上角打开历史或开始新对话。

## 接入 Groq（本地开发）

1. 打开 https://console.groq.com/keys ，注册 / 登录并创建自己的 API Key。个人试用可保持 Free Plan，不需要升级为付费计划。
2. 在本机双击根目录 index.html（或 frontend/index.html）。推荐使用 Chrome / Edge。
3. 点击输入框下方“连接 AI”，或点击头像找到“AI 连接”。将密钥粘贴到密码输入框，点击“启用 Groq”。密钥只保留在当前页面内存中，提交后输入框会清空。
4. 可点击“测试连接”验证密钥和模型列表，此操作不生成聊天回复。关闭面板，输入“你好，请用一句话回答”，发送后应看到“AI 回复”，不再是“演示回复”。
5. Quick 使用 qwen/qwen3.8-27b、reasoning_effort=none、最多 256 生成 token；Coach 使用同一模型、reasoning_effort=medium、最多 4096 生成 token。两档均流式显示。生成 token 预算也要给推理留空间，Coach 不应照搬 Quick 的小额度。
6. 切换模式会停止正在生成的回复，下一次发送使用新模式；同一聊天保留上下文。点击发送按钮变成的停止按钮，也可以停止生成。
7. 刷新 / 关闭网页会清除内存中的密钥，需重新填写；“断开并清除密钥”可立即切回演示。浏览器自己的密码管理行为不由应用控制。

这一步只验证真实模型调用，Skill 仍占位：BP 和玩家资料尚未自动发送给模型。需要询问阵容时，先把阵容写进问题。最近 20 条有效历史消息随下一次请求发送，聊天备份仍保存在本机。

常见问题：

- 401：Key 无效或被撤销，重新填写。
- 403：账号、地区或模型访问权限受限，检查 Groq 控制台。
- 404：预览模型可能被替换，检查 AI-Core/groq.js 中的 model。
- 429：触及免费额度或请求限流，等待控制台额度恢复；应用不会自动重试或切换到付费模型。
- 网络 / 跨域问题：检查网络。若浏览器阻止 file:// 请求，可用编辑器的本地网页预览，或自己上传后通过 HTTPS 打开。不需要修改系统环境变量。
- 回复达到生成上限：页面会提示继续追问；若 Coach 思考预算用尽而没有答案，改用 Quick 或缩短问题。

模型目前为预览型号，实际权限和免费额度以账号控制台为准。参数依据：https://console.groq.com/docs/api-reference 和 https://console.groq.com/docs/model/qwen/qwen3.8-27b 。

**这是一种使用自己密钥的浏览器开发模式，不是共享密钥的公开服务。** 密钥不写进代码、localStorage、用户 JSON 或导出文件。不要把自己的 Key 嵌入 GitHub Pages；公开产品若要使用你的统一密钥，需要以后实现 Back-End 代理。启用后，选作上下文的问题和历史会发送到 Groq；“保存在本地”不表示模型也在本地运行。

## 本地用户文件夹

默认保存在浏览器，不上传账号、档案或对话。用户系统是本机配置，未实现在线身份验证和云端账号。

在用户面板中点击“连接本地用户文件夹”，选择项目里的 users 目录。支持 File System Access API 的浏览器（推荐 Chrome / Edge）会请求目录读写权限。GitHub Pages 的 HTTPS 地址可使用此功能；不支持的浏览器仍可使用浏览器存储和导入 / 导出。

连接后，每个用户保存为 `<用户ID>.json`，目录中还有 gamecoach-index.json 索引。打开已保存的目录会合并本地用户：同 ID 使用更新时间较新的数据。刷新后需重新点击连接；浏览器不会无提示访问本机路径。导入 JSON 备份始终创建独立用户，不覆盖已有用户。

users 目录已在 .gitignore 中整体排除。本地目录是空目录时 Git 不会上传或创建它；换电脑请自己建一个 users 目录并连接，或导入备份。不要手动把个人 JSON 放进 frontend。

旧版同一网站地址的浏览器档案会自动迁移为默认本地用户，旧存储保留。不同浏览器、设备或 file:// 地址的存储可能不同，建议先导出备份。

## 演示边界

未启用 Groq 时，AI-Core 默认使用本地 demo provider，不联网、不调用真实模型；启用后会调用 Groq，实际费用与额度由你选择的账号计划决定。前端只显示 Skill 返回的内容，没有固定建议或 50 分评分。英雄头像和数据仍为 12 个演示占位数据。

调用链为 Front-End → Skill → AI-Core → Skill → Front-End。Skill 暂时原样透传，预留补充资料和整理回复的位置；阵容和用户资料只传给 Skill 的 context，占位版暂不使用。AI-Core 接受通用文本或消息列表，不要求游戏专用字段。

Quick / Coach 硬切换 AI-Core 的调用配置：demo-instant / none / 128 输出额度，以及 demo-reasoning / medium / 1024 输出额度。并非仅在提示词中要求简短或详细。演示 provider 不模拟真实推理或 token 计费，也不能用它衡量真实模型延迟。接真实 provider 时需根据模型实际支持的参数映射执行配置。

回复支持逐段显示和停止。生成时切换模式、用户、对话会取消原请求；切换模式保留同一对话，下一条请求使用新配置。历史保存在本机，每次调用带最近 20 条有效历史消息。失败或停止的 AI 回复不会作为后续 AI 历史发送。

Groq 通过 AI-Core/groq.js 的 provider 适配器接入；公开共享服务后续需要后端保管密钥。当前代码不包含真实 API 密钥。接口详见 AI-Core/README.md 与 Skill/README.md。

开发验证（仅测试需要 Node.js，打开网页不需要）：`node --test tests/*.test.cjs`。

许可证见 LICENSE。
