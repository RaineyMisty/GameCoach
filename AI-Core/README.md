# AI-Core

通用模型调用层，不读取游戏阵容、用户文件或页面 DOM。Skill 传入普通文本或消息列表；Quick / Coach 作为独立执行选项传入，不拼进提示词。

```js
const result = await GameCoachAI.call(messages, {
  mode: 'quick',
  signal: abortController.signal,
  onDelta: text => { /* 立即显示新增文本 */ },
});
```

默认是 demo provider；groq.js 额外注册真实 Groq provider。在前端 AI 连接面板填入用户自己的密钥后，通过 GameCoachGroq.activate(key) 启用。密钥仅在 groq.js 闭包内存中，没有 getter，不进入本地用户存储或导出文件。

Groq 模式：Quick 为 qwen/qwen3.8-27b / none / 256 生成 token / 10 秒超时；Coach 为同型号 / medium / 4096 生成 token / 60 秒超时。reasoning_format=hidden 只隐藏内部推理，真正关闭推理依靠 Quick 的 reasoning_effort=none。两档有通用的输出表达要求（例如先给结论），不包含游戏专用字段，且独立于真实执行参数。

GameCoachGroq.testConnection() 通过 GET /models 检查密钥和模型权限，不生成回复。disconnect() 清除密钥并恢复 demo 配置。连接配置不随用户资料保存；刷新后回到 demo。

适配器直接 fetch Groq 官方 HTTPS 地址，拒绝重定向，不携带浏览器 cookies，不支持自定义密钥目的地址。它支持 SSE 流分段和 UTF-8 边界、隐藏 reasoning 字段、正常结束标记、生成额度截断、取消和状态码错误。没有自动重试或付费模型回退。

`registerProvider(name, { isDemo, async generate(request) })` 注册适配器。适配器接收 `input, model, reasoningEffort, maxOutputTokens, timeoutMs, instructions, signal, onDelta`，返回 `{ content, finishReason? }`，并在生成时调用 `onDelta(新增文本)`。未流式返回时核心会一次性发送最终文本。返回内容必须与已发送片段一致。

`configure({ provider, modes: { quick: {...}, coach: {...} } })` 选择 provider 并配置两档模型、推理强度、输出额度和超时。设置在每次请求开始时固定，切换模式影响下一次调用；适配器负责映射和校验供应商支持的参数、执行输出额度以及实现实际流式请求。不能假设每个模型都支持 none 或相同的预算参数。

核心支持取消、超时、输出检查和首段文本 / 总耗时记录。首段文本不等同于首个有效建议，真实模型接入后需另外评测推荐答案出现的时间。

后端尚未实现。以后接云端模型时，通过后端代理保护 API 密钥；不要把密钥写入网页或公开仓库。

目前只提供“用户自带密钥”的浏览器开发方式。已验证 Groq 的匿名 OPTIONS 预检允许 Origin: null 和 authorization/content-type 请求头，但实际连接仍受浏览器、网络及账号权限影响。没有真实密钥时，只能完成模拟接口测试，不能声称已通过真实推理测试。
