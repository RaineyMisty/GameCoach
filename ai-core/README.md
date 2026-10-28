# ai-core

当前网页只加载通用 `backend.js` 适配器，模型 HTTP / DNS、凭证、历史和 training memory 选择在 Python 后端。通用表单支持五家厂商；Local database 的 Default / Import 与厂商无关。安全配置及团队部署见 [DEPLOYMENT.md](../DEPLOYMENT.md)。下文 Gemini 直连 / SSE 说明属于保留的独立模块，当前网页不加载该模块。

通用模型调用层，不读取阵容、用户文件或页面 DOM。Skill 传入普通文本或消息列表；Quick / Coach 是独立执行选项。

`GameCoachAI.call(input, { mode: 'quick', signal, onDelta })` 返回 content、mode、provider、model、isDemo、reasoningEffort、finishReason 和 timings。`registerProvider(name, { isDemo, generate })` 注册适配器；generate 接收 input、model、reasoningEffort、maxOutputTokens、timeoutMs、instructions、signal、onDelta，返回 `{ content, finishReason? }`。最终文本必须和已发送片段一致。

默认 provider 为 demo。gemini.js 注册 Gemini provider；`GameCoachGemini.activate(key)` 启用，`disconnect()` 清除当前页面 Key 并恢复 demo，`isConfigured()` 返回是否已填入 Key。输入校验接受新版 AQ. auth key、旧版 AIza key 及其可打印 ASCII 内容，不限定固定前缀；仅检查基本长度、引号、空白和控制字符，真实性交给官方接口。没有密钥 getter；Key 不进入本地用户、导出文件、URL 或浏览器应用存储。

| 模式 | 模型 | 思考档 | 生成额度 | 超时 |
| --- | --- | --- | --- | --- |
| Quick | gemini-3.5-flash-lite | MINIMAL | 512 | 10 秒 |
| Coach | gemini-3.8-flash | MEDIUM | 4096 | 60 秒 |

模型定义在 gemini.js 的 models 中，实际执行参数在 activate 中。MINIMAL 是最低思考档，并不承诺零思考；includeThoughts=false 只控制输出，不负责减少思考。两档切换改变真实模型及 thinkingLevel，表达要求另外作为 systemInstruction 传入。生成额度也包含思考消耗。

使用 Google 官方固定 HTTPS 地址，通过 x-goog-api-key 请求头认证，不在 URL 查询参数里带 Key，不携带 cookies，不跟随重定向。调用 `models/<model>:streamGenerateContent?alt=sse`，不创建远端会话；上下文每次由调用者提供。

输入支持字符串或 system / developer / user / assistant 消息；系统内容合并为 systemInstruction，assistant 转为 model，连续同角色消息合并。内容片段支持 text、input_text、Gemini 原生 inlineData / fileData 和 image_url 的 base64 图片。当前网页仍只有文字输入。未知片段明确报错，不静默丢弃。

SSE 处理任意字节分片、UTF-8、CRLF / LF / CR、注释、多行 data。只输出非 thought 文本，依靠 Gemini 的 STOP / MAX_TOKENS 判断结束，不要求 OpenAI 的 [DONE]。MAX_TOKENS 映射为 finishReason=length；缺少结束状态、被拦截、异常停止、空回答均报错，不把不完整内容标为成功。取消和超时由核心传递至 fetch。

临时错误最多尝试 3 次：网络错误、408、429、500/502/503/504，以及未产生正文的空回答或中断。指数退避加少量抖动，等待不短于 Retry-After；所有尝试共用原始总超时。密钥/权限/参数错误、取消、内容拦截不重试；已发出正文不自动重生成，避免拼接不同答案。回调 `onRetry({ attempt, maxAttempts, delayMs })` 提供进度；结果或异常附实际 `attempts`。不回退其他平台、不自动开通付费。

调用选项 `webSearch: true` 添加 `tools: [{ googleSearch: {} }]`；默认 false。是否允许检索由上层决定，不在核心识别游戏意图。返回 `sources`、`searchSuggestions`、`searched`，以及接口提供时的 `usage`。searched 只在接口返回实际搜索查询或检索片段时为 true，允许工具不等于使用工具。资料来源只接受 HTTP(S) 地址。页面负责展示来源与 Google 返回的搜索建议；实际费用、额度和可用性由 Google 与账号决定。

`GameCoachGemini.testConnection()` 通过两个 GET models/<model> 检查密钥与模型元信息，核实 generateContent 能力；不生成内容，不能证明生成配额或计费状态正常。须发送一条消息验证真实回答。`models` 是只读公开配置，不含凭证。

API Key / HTTP 错误不回显原始服务器文本，避免上游信息包含 Key。浏览器直连 Gemini 的凭证仅用于用户自己的页面。刷新恢复 demo；用户资料和聊天保留。测试模拟官方响应，不声称无 Key 时完成真实推理验证。

`backend.js` provider 调用固定后端的 `/api`，服务端密钥只由 Python 读取。在它之前加载的 `frontend/config.js` 设置公开 `apiBaseUrl`：留空使用同源；Pages 使用明确的 HTTPS origin，不含路径、查询参数或凭证。不从页面 URL 参数读取服务器地址，拒绝跟随重定向；远程请求省略 Cookie，后端需配置 CORS。调用选项 `conversation: { id, userId, user: { name, profile } }` 仅供适配器定位本地用户和对话，服务端身份始终来自 Bearer 令牌。Skill 只准备本轮消息，历史由 SQLite 提供。后端模式使用 JSON 完整回复，不启用流式和联网搜索；返回实际服务端模型名。安装及接口见 [back-end/README.md](../back-end/README.md)。

浏览器会话存储键包含后端 origin；旧同源会话只在同源模式迁移，不自动带到远程后端。私有恢复文件 version 2 记录实际 API origin，可以在指向同一后端的不同页面中手动恢复；version 1 只在原同源网站接受。更换后端地址需要单独处理身份迁移，不能将恢复文件中的地址改成任意新站来转发凭证。

`GameCoachBackend.testConnection(provider)` 和 `activate(provider)` 接受 `gemini` / `deepseek` / `openai` / `grok` / `claude`，省略时使用服务端默认。聊天始终调用 `/api/chat`；统一输出正文、结束原因、用量和模型名，`upstreamProvider` 标识服务端选择的模型厂商，随前端历史保存。各厂商的协议映射集中在 `back-end/providers.py`，不会把服务端 Key 放进前端。

参考：[Gemini REST](https://ai.google.dev/api/generate-content)、[模型](https://ai.google.dev/gemini-api/docs/models)、[思考档](https://ai.google.dev/gemini-api/docs/thinking)。
