# resources

按游戏保存可追溯的资料。`lol/champion-icons/` 保存端手游共用头像；`lolm/champion-icons/` 只保存手游独有头像。`champions.js` 是选人目录，`knowledge.js` 是供 Skill 按问题选取的技能资料，两者职责分开。

## 技能资料快照

| 游戏 | 目录覆盖 | 资料版本 | 采集日期 | 来源 |
| --- | --- | --- | --- | --- |
| 英雄联盟 | 173 位 | Data Dragon 16.20.1 | 2026-10-18 | Riot Data Dragon 的逐英雄 zh_CN 数据 |
| 英雄联盟手游 | 142 位 | 腾讯英雄目录标记 7.3 | 2026-10-18 | 腾讯手游官网目录及英雄详情接口 |

每位英雄保留被动与四个技能的名称、说明和原始 URL。手游目录的版本标记不保证每个英雄详情恰好对应用户所在服务器、本场比赛的版本；端游数据同样是下载时的快照。说明可能含基础等级数值或模板占位内容，不能直接充当满级伤害计算器。没有采集装备效果、完整成长属性或赛事资料。

页面从本地普通脚本加载这些资料，双击 HTML 也可使用。Skill 只把相关英雄的节选附入请求，不发送整个资料库。不把端游技能覆盖到手游，也不把模型旧记忆当成已核实事实。

原始来源：

- [Data Dragon 版本列表](https://ddragon.leagueoflegends.com/api/versions.json)
- [端游逐英雄数据示例：库奇](https://ddragon.leagueoflegends.com/cdn/16.20.1/data/zh_CN/champion/Corki.json)
- [腾讯手游英雄目录](https://game.gtimg.cn/images/lgamem/act/lrlib/js/heroList/hero_list.js)
- [腾讯手游英雄详情示例：库奇](https://mlol.qt.qq.com/go/lgame_battle_info/hero_tech?hero_id=10060&mode=classic_model&source_game_zone=lgame&game_zone=lgame)

## 维护时更新

网页使用者无需 Node。维护资料时，如电脑安装了 Node 18 或以上，可在项目根目录运行：

```powershell
node resources/update-knowledge.cjs
node resources/update-knowledge.cjs lolm
```

第一个命令更新两个游戏，第二个只更新手游。脚本不需要 API Key，下载官方公开数据，并写入版本与当天日期。某个游戏有英雄下载失败时保留该游戏的原资料，不写入不完整快照。更新后检查差异并运行 `node --test tests/*.test.cjs`，由维护者自行上传。新英雄仍需先维护 `champions.js` 目录，本脚本不会自动扩充选人名单。
