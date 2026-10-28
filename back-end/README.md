# GameCoach 后端

FastAPI + SQLite，统一接入 Gemini、DeepSeek、OpenAI（ChatGPT API）、xAI（Grok）和 Anthropic（Claude）。模型 HTTP 请求、厂商 DNS、密钥使用、历史读取和 training memory 选择都在后端；网页只连接自己的服务器。

## 启动

在项目根目录：

```powershell
.venv/Scripts/python.exe -m pip install -r back-end/requirements.txt
.venv/Scripts/python.exe -m uvicorn main:app --app-dir back-end --host 127.0.0.1 --port 8000
```

第一次可先 `python -m venv .venv`。打开 <http://127.0.0.1:8000>，在通用 API Key 表单选择厂商并连接。Default / Import 只用于用户数据库，和 API 厂商无关。

用户 Key 通过 HTTPS（本机允许 loopback HTTP）提交，按用户和厂商加密保存在 SQLite，服务器不返回 Key，也不进入普通用户备份。当前网页还会按用户和后端地址在浏览器保存手动填写的 API 配置，刷新自动恢复连接；只有手动提交更新配置。留空使用已保存 Key 或服务器默认 Key。同一用户在五家厂商之间共用历史、资料和 training memory。

**安全配置、恢复、部署包与团队测试操作见 [DEPLOYMENT.md](../DEPLOYMENT.md)。**

## GitHub Pages / 树莓派

Pages 前端在 `frontend/config.js` 设置 `apiBaseUrl: 'https://你的树莓派主机名'`。服务器设置 `GAMECOACH_CORS_ORIGINS=https://raineymisty.github.io`；origin 不带 `/GameCoach/` 路径或末尾 `/`，多个来源用逗号分隔，不允许通配符。默认留空时不开放跨域读取；开发环境可显式允许 localhost HTTP，生产仅允许 HTTPS 来源。

首次生成私有配置可增加 `--frontend-origin https://raineymisty.github.io`；已有配置只更新 CORS / Host 字段，保留原主密钥和 Key 并重启服务。CORS 不替代会话校验，浏览器仍使用 Bearer 令牌，不发送 Cookie。没有自有域名时可按部署指南使用 Tailscale Funnel；仅监听 127.0.0.1:8000 并信任本机代理。`deploy/gamecoach.service.example` 提供验证后的开机运行模板。

## 统一接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/providers` | 公开厂商目录、默认模型和是否配置服务器 Key；不返回 Key |
| GET | `/api/health?provider=deepseek` | 进程健康状态 |
| POST | `/api/sessions` | 创建用户会话；团队部署要求 `X-GameCoach-Access` 访问码 |
| POST | `/api/sessions/restore` | 使用私有恢复凭证恢复原服务器用户；团队部署仍要求访问码 |
| DELETE | `/api/sessions/current` | 撤销当前会话 |
| GET | `/api/credentials` | 当前用户各厂商的 Key 保存状态，不返回 Key |
| PUT / DELETE | `/api/credentials/{provider}` | 保存 / 删除当前用户的 Key |
| GET | `/api/connection?provider=deepseek` | 使用当前用户 Key 或服务器默认 Key 读取模型元信息，不生成回答 |
| GET / PUT | `/api/user-state` | 同步当前用户的历史、资料、阵容和 training memory；使用 version 避免覆盖冲突 |
| POST | `/api/conversations` | 新建或按 local_id 找回当前用户的服务器对话 |
| GET | `/api/conversations` | 当前用户的对话 |
| GET | `/api/conversations/{id}/messages?after=0&limit=100` | 按 ID 分页取消息 |
| POST | `/api/chat` | 读历史与记忆、调用模型、保存完整问答后返回 |

除目录、健康检查、创建/恢复会话外，接口均要求 `Authorization: Bearer <用户会话令牌>`。用户身份只从令牌取得，不信任客户端用户 ID；其他用户的对话返回 404。上游密钥错误映射为 502，不会被误认为用户会话 401。

聊天请求：

```json
{
  "conversation_id": "服务器对话 UUID",
  "request_id": "本轮 UUID",
  "provider": "deepseek",
  "message": "应该选什么辅助？",
  "context": "当前阵容和相关本地资料",
  "instructions": "Skill 规则",
  "mode": "quick",
  "user": {"name": "玩家", "profile": {}}
}
```

`provider` 可为 `gemini` / `deepseek` / `openai` / `grok` / `claude`，省略时使用 `GAMECOACH_PROVIDER`（默认 gemini）。前端不能指定任意上游 URL。统一响应包含 `content`、`model`、`upstream_provider`、`provider: "backend"`、`finishReason: "stop" / "length"`、`usedMemories`，以及可用时的 `usage: {inputTokens, outputTokens, totalTokens}`。

服务端读取最近 10 个完整问答轮次。training memory 从当前用户的后端快照按相关性选择，暂停的记忆不使用，不把玩家常用位置当作本局角色，不当作必须执行的模板；它是上下文经验，不是模型微调。Quick 最多 6 条、正文约 1400 字符；Coach 最多 3 条、正文约 600 字符。

相同 request_id 和相同请求返回已保存结果；改变内容或厂商返回 409。对话版本校验避免并发覆盖。模型失败不写入半轮，用户资料及问答一次提交或回滚。后端不自动重试和回退厂商。

## 配置与协议

| provider | Key 变量 | Quick / Coach 默认模型 | 模型变量前缀 |
| --- | --- | --- | --- |
| gemini | GEMINI_API_KEY | gemini-3.5-flash-lite / gemini-3.8-flash | GEMINI |
| deepseek | DEEPSEEK_API_KEY | deepseek-flash / deepseek-v4-pro | DEEPSEEK |
| openai | OPENAI_API_KEY | gpt-4.1-mini / gpt-4.1 | OPENAI |
| grok | XAI_API_KEY | grok-4.3 / grok-4.3 | XAI |
| claude | ANTHROPIC_API_KEY | claude-haiku-5-5 / claude-sonnet-5-5 | ANTHROPIC |

例如设置 `OPENAI_QUICK_MODEL` 可覆盖模型；模型可用性由账户决定。OpenAI 使用开发者 API Key，ChatGPT 订阅不能替代 API 凭证。

`providers.py` 适配 Gemini generateContent、DeepSeek Chat Completions、OpenAI/xAI Responses 和 Claude Messages。固定使用官方 HTTPS 地址，验证 TLS，不跟随重定向。统一模式目前是基础文字聊天，没有工具调用、联网搜索、多模态或跨轮推理状态。Quick / Coach 输出预算为 512 / 4096 token，各厂商对思考用量的计算不同；不展示厂商思考内容。模型网络操作超时 60 秒，连接超时 10 秒，网页等待 75 秒。

`secure_config.py` 从环境变量或 `GAMECOACH_CONFIG_FILE` 指定的私有 JSON 读取配置，环境变量优先；不会自动加载任意 .env。生产环境必须有固定加密主密钥、访问码和允许的域名，强制 HTTPS。SQLite 放在持久磁盘；不要把数据库和私有配置上传到静态网站或代码仓库。

错误只返回固定 code，例如 `UPSTREAM_DNS_ERROR`、`UPSTREAM_TLS_ERROR`、`UPSTREAM_KEY_INVALID`、`UPSTREAM_QUOTA_EXCEEDED`；不回显上游消息、用户 Key 或包含提交值的校验错误。详细恢复和安全边界见部署文档。

## 验证

```powershell
.venv/Scripts/python.exe -m unittest discover -s back-end -p 'test_*.py' -v
node --test tests/*.test.cjs
```

测试使用临时数据库、模拟 Key 和模拟回复，不消耗模型额度。真实厂商问答需实际 Key 和服务器网络条件。

协议来源：[OpenAI Docs](https://developers.openai.com/api/docs/guides/text)、[DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/)、[xAI](https://docs.x.ai/developers/rest-api-reference/inference/responses)、[Claude](https://platform.claude.com/docs/en/api/messages/create)、[Gemini](https://ai.google.dev/api/generate-content)。
