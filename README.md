# GameCoach

HTML + CSS + JavaScript 的《英雄联盟手游》本地教练演示。无需 Node.js、npm 或构建。

## 目录

```text
GameCoach/
├── frontend/        # 全部页面、样式、脚本与头像
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

## 本地用户文件夹

默认保存在浏览器，不上传账号、档案或对话。用户系统是本机配置，未实现在线身份验证和云端账号。

在用户面板中点击“连接本地用户文件夹”，选择项目里的 users 目录。支持 File System Access API 的浏览器（推荐 Chrome / Edge）会请求目录读写权限。GitHub Pages 的 HTTPS 地址可使用此功能；不支持的浏览器仍可使用浏览器存储和导入 / 导出。

连接后，每个用户保存为 `<用户ID>.json`，目录中还有 gamecoach-index.json 索引。打开已保存的目录会合并本地用户：同 ID 使用更新时间较新的数据。刷新后需重新点击连接；浏览器不会无提示访问本机路径。导入 JSON 备份始终创建独立用户，不覆盖已有用户。

users 目录已在 .gitignore 中整体排除。本地目录是空目录时 Git 不会上传或创建它；换电脑请自己建一个 users 目录并连接，或导入备份。不要手动把个人 JSON 放进 frontend。

旧版同一网站地址的浏览器档案会自动迁移为默认本地用户，旧存储保留。不同浏览器、设备或 file:// 地址的存储可能不同，建议先导出备份。

## 演示边界

AI 回复仍为固定示例，不会实际分析英雄或玩家问题。完整阵容固定为 50 分，不完整不评分。英雄头像和数据为 12 个演示占位数据。真实 AI 后续需另建后端保存密钥。

许可证见 LICENSE。
