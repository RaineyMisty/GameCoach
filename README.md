# GameCoach

纯 HTML、CSS 和 JavaScript 的《英雄联盟手游》阵容教练演示网页。无需 Node.js、npm、数据库或构建步骤。

## 本地查看

直接双击项目根目录的 `index.html`。请保持 `app.js`、`data.js`、`styles.css` 和 `assets` 文件夹的相对位置。

## 在已有 GitHub 仓库发布

自己提交并推送本项目文件到已有仓库，然后在 GitHub 仓库中设置：

1. Settings → Pages。
2. Source 选择 **Deploy from a branch**。
3. Branch 选择 **main**，Folder 选择 **/(root)**。
4. 点击 Save，等待部署完成，打开 Pages 显示的网站链接。

不用创建新仓库，不用上传压缩包，不用编写自定义 GitHub Actions 工作流。

## 功能

- 12 个占位英雄，双方各 5 人，支持搜索、重复检测、移除和清空。
- Quick / Coach 模式，中文问题输入和 Explain Why。
- 玩家档案与最近 100 条分析记录保存在浏览器，可导出或删除。
- AI 回复与评分都是演示：完整阵容固定为 50 分，阵容未满不评分，不代表真实阵容强度或胜率。

浏览器数据不会自动同步到其他设备。清除网站数据会删除保存的档案与记录。直接双击打开时，存储行为取决于浏览器；部署后使用更稳定。

页面不包含 API 密钥，也不请求 AI 服务。接入真实 AI 时需另设后端处理密钥。

许可证见 LICENSE。
