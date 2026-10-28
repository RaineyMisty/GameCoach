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
