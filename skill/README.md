# Skill 最小框架

真实 AI 的 Skill 统一写在 `skill/index.js`。不引入新框架，也不增加模型调用。

## 调用链

`frontend/app.js → GameCoachSkill.run → GameCoachAI.call → backend.js → Python /api/chat`

未连接 AI 时：`run → ai-core → ai-core/demo.js`，不检索资料、不注入教练规则，不报告使用了记忆。

## 阅读和修改

先看文件顶部的 `run()`：复制本轮输入 → 判断后端能力 → 组装输入 → 调用模型 → 合并来源与记忆元信息。

文件后半按规则、阵容、历史、知识、输入组装、输出分段。已有行为原样搬入，后续逐项简化，避免一次重构同时删功能。

- 修改教练原则：搜索“教练规则”。中英文规则按同一个编号对应。
- 修改发送给模型的背景：搜索“输入组装”，从 `build()` 开始。
- 修改资料选择和预算：搜索“知识资料”。
- 修改返回信息：看顶部 `run()` 和末尾“输出”。正文保持透传。

## 稳定接口

`GameCoachSkill.prepare(input, context, { mode })`：只返回模型消息，不联网、不保存。

`GameCoachSkill.run(input, { context, mode, signal, onDelta, onRetry, conversation })`：返回现有回答及元信息。

保留 `GameCoachSkillInput`、`GameCoachSkillRules` 等辅助接口供现有测试和调用方使用，但不再需要加载多个 Skill 脚本。

## 边界

Skill 不读写 DOM、用户存储或 API Key。网络、取消、超时和重试属于 ai-core；后端模式的正式历史和长期记忆属于 Python。当前仍只向后端提交本轮背景，由后端补历史；本次未改检索策略或聊天协议。

## 验证

`node --test tests/*.test.cjs`

演示隔离测试不需要密钥；真实回答质量仍需实际模型验收。
