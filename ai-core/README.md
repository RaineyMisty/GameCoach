# ai-core

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

SSE 处理任意字节分片、UTF-8、CRLF / LF / CR、注释、多行 data。只输出非 thought 文本，依靠 Gemini 的 STOP / MAX_TOKENS 判断结束，不要求 OpenAI 的 [DONE]。MAX_TOKENS 映射为 finishReason=length；缺少结束状态、被拦截、异常停止、空回答均报错，不把不完整内容标为成功。取消和超时由核心传递至 fetch；没有自动重试或其他平台回退。

`GameCoachGemini.testConnection()` 通过两个 GET models/<model> 检查密钥与模型元信息，核实 generateContent 能力；不生成内容，不能证明生成配额或计费状态正常。须发送一条消息验证真实回答。`models` 是只读公开配置，不含凭证。

API Key / HTTP 错误不回显原始服务器文本，避免上游信息包含 Key。所有凭证仅用于用户自己的浏览器页面，不实现共享服务密钥或 Backend。刷新恢复 demo；用户资料和聊天保留。测试模拟官方响应，不声称无 Key 时完成真实推理验证。

参考：[Gemini REST](https://ai.google.dev/api/generate-content)、[模型](https://ai.google.dev/gemini-api/docs/models)、[思考档](https://ai.google.dev/gemini-api/docs/thinking)。
