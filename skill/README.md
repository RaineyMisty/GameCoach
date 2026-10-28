# Skill 模块边界

`quick.js` 和 `coach.js` 是两个独立模块，通过调用共用工具工作。只拆结构，保留现有行为。

| 文件 | 负责 | 不负责 |
| --- | --- | --- |
| index.js | 根据 mode 分发，兼容页面入口 | 模式策略、资料整理、网络实现 |
| quick.js | Quick 的规则入口、历史选择、记忆和资料预算、build / prepare / run | Coach 策略、历史持久化 |
| coach.js | Coach 的规则入口、历史选择、记忆和资料预算、build / prepare / run | Quick 策略、历史持久化 |
| shared.js | 共用规则预设、阵容与资料工具、输入格式、输出透传、共用调用适配 | 选择模式、创建用户或对话、读写存储 |

## 调用

`frontend → index.run → quick.run / coach.run → shared.execute → 当前模式自己的 build → ai-core → 原后端`

两个模式不互相调用，单独加载 shared.js 和任一模式文件即可运行该模式。index.js 是页面的统一入口，不是模式模块的依赖。

各模式的 instructions 当前读取同一个规则预设；各自的 build 明确列出历史和背景选择。改 Quick 只编辑 quick.js，改 Coach 只编辑 coach.js。

两者使用同一份原始历史、用户预设、阵容和记忆，窗口及资料预算仍可各自不同。切换模式不新建用户或对话。后端地址、认证、请求字段和服务器代码均保持原样。

## 加载顺序

页面已有的游戏、记忆、ai-core 工具 → shared.js → quick.js / coach.js → index.js。经典脚本保留双击 HTML 和静态网站的使用方式。

页面继续调用 GameCoachSkill.run / prepare；直接调用可用 GameCoachSkillQuick.run / prepare 或 GameCoachSkillCoach.run / prepare。

未连接 AI 的演示仍在 ai-core/demo.js，跳过真实背景组装。

## 验证

`node --test tests/*.test.cjs`

测试使用模拟模型；真实回答质量仍需实际模型验收。

## Skill 输入调试

frontend/config.js 的 skillDebugEnabled 控制采集与头像入口。开启后，点击 AI 回复头像即可查看该次 run 收到的 input/context，以及 build 实际产生的消息、来源和记忆信息；不重新调用 prepare，不调用第二次模型。

shared.execute 通过可选 onInspect 回调提供副本，frontend/debug.js 独立保存和显示。快照只在当前标签页 sessionStorage 中保留每用户最近 20 条，刷新可查看；不进入聊天正文、模型请求或普通用户备份。以前未采集的回答不伪造快照。关闭开关后不采集、不显示入口。
