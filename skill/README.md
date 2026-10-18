# skill

当前只保留 `run(input, options)`，原样调用 ai-core 并返回回复。`prepare` 和 `format` 是以后增加资料补充及结果整理的位置。

前端将阵容和用户资料放在 `options.context`，占位 Skill 暂不使用这些信息，也不会将其交给 ai-core。对话消息在 `input`，执行配置（mode、signal、onDelta）单独透传。

Skill 不决定使用哪个模型或推理档位，也不二次调用模型整理回复。当前 onDelta 原样透传，不等待整段回复完成。
