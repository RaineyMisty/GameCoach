# GameCoach 团队测试部署

更新日期：2026-10-27。本文覆盖当前小范围团队测试的配置、两种服务器入口、数据保护与运行维护；它不代表已经完成树莓派实机部署、五家真实模型调用或生产安全审计。

## 当前部署路径与完成状态

| 路径 | 当前状态 | 需要什么 |
| --- | --- | --- |
| 本机 Python 同时提供页面和 API | 已有代码，可进行本机验证 | Python 环境、可访问厂商的网络、有效 Key |
| 树莓派 + 临时 HTTPS 隧道，同时提供页面和 API | 本文提供测试步骤，实机待验证 | 64 位系统、Python、cloudflared；无需购买域名 |
| Linux / 树莓派 + Docker Compose + Caddy | 已有配置，镜像构建与实机待验证 | Docker Compose、可用域名、公网入口与证书条件 |
| GitHub Pages 页面 + 树莓派远程 API | 已实现连接适配，实际地址与实机验证待完成 | `frontend/config.js` 后端地址与服务器 CORS 配置；见 3B / 3C |
| 树莓派 + Tailscale Funnel | 本文提供推荐测试流程，实机待验证 | Tailscale 账户与 `*.ts.net` 入口；无需自有域名 |

**只有 `github.io` 地址也能测试，不需要先买域名。** 先从树莓派 HTTPS 入口验证后端，再配置 Pages 的远程连接。Pages 本身不能运行 Python 或 SQLite。不要把 `raineymisty.github.io` 填成树莓派的服务器域名，也不能为它配置自己的 DNS 记录。[GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

### 哪些东西部署到哪里

```text
用户电脑 / 浏览器
  frontend/ + ai-core/ + skill/ + memory/ + resources/
  页面交互、公开资料、用户本地缓存、导入 / 导出
                     │ HTTPS /api/（同源或配置的树莓派地址）
                     ▼
家中树莓派 / Linux 服务器
  HTTPS 入口：临时隧道，或有域名时使用 Caddy
                     │ 私有本机 / 容器网络
  back-end/main.py → providers.py → 模型厂商 HTTPS API
          │              └── 厂商 DNS 和 HTTP 都在服务器处理
          ├── training_memory.py：选择用户相关记忆
          ├── SQLite：历史、资料、加密 Key、memory 快照
          └── secure_config.py：私有配置与字段加密

管理者单独保管
  server.json / 主密钥 / 数据库备份 / 私有恢复文件
  不放 GitHub Pages、Git、公开资源目录或共享代码包
```

Python 当前只映射上述公开目录为静态资源，不提供整个仓库下载。Docker 部署时 SQLite 在 `gamecoach_data` 卷；直接 Python 启动默认在 `back-end/data/gamecoach.sqlite3`。二者不是自动共用的数据目录，切换运行方式前需要安排数据迁移和相同主密钥。

## 页面与数据

- **Local database / Default**：使用默认本地用户；浏览器保留一份缓存和待同步修改。
- **Local database / Import**：导入现有 GameCoach 用户 JSON，包含资料、历史和 training memory，不含 API Key；保留“导出当前用户”和文件夹备份。
- **API 连接**：选择 Gemini、DeepSeek、OpenAI、Grok 或 Claude，输入自己的 Key，或者留空使用当前用户已保存的 Key / 服务器默认 Key。团队部署需填写管理员提供的访问码。
- 模型 HTTP 请求、厂商域名解析、密钥使用和 training memory 选择都在 Python 后端。页面只向固定后端地址的 `/api/` 请求；不从网页直连厂商。Python 提供页面时 CSP 限制同源连接；Pages 不自动继承 Python 的安全响应头。
- 同一用户的聊天和 memory 不按厂商分库。切换 API 仍读同一 SQLite 历史和记忆。training memory 是按需加入上下文的经验，不是模型微调。
- 首次连接会将当前浏览器用户同步到后端，并导入完成的真实问答；演示、失败和停止的回复不会作为已完成历史导入。之后原有对话不会被快照同步重复覆盖。

## 本机继续使用

在项目根目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r back-end/requirements.txt
.venv/Scripts/python.exe -m uvicorn main:app --app-dir back-end --host 127.0.0.1 --port 8000
```

停止旧服务、重启，再打开 <http://127.0.0.1:8000>。直接在网页的通用 API Key 表单连接即可；本地访问码可留空。Key 会保存到当前服务器用户的加密记录中，表单提交后立即清空。密钥与普通用户备份、浏览器应用存储分开。

已有 `.venv` 时跳过创建步骤。本地开发配置不用于公开访问；不要把未配置生产保护的 8000 端口直接映射到公网。

本地首次运行自动建立 `back-end/.secrets/storage.key`，用于加密数据库中的用户 Key、姓名、资料、聊天正文、上下文、回复元数据和用户快照（包括 memory）。已有用户的旧明文记录在其下一次认证访问时迁移；旧备份与旧磁盘页仍可能保留原数据，不应当公开分发。数据库 ID、角色和时间等结构信息仍可见，不是全磁盘加密。

**加密主密钥需要单独备份。** 只有数据库而丢失主密钥，无法解密；拿到数据库和主密钥的人也可能解密。主密钥不会从 API 返回。

## 1. 生成可以分享的代码包

```powershell
.venv/Scripts/python.exe scripts/package_deploy.py
```

生成 `dist/gamecoach-deploy.zip`。这个文件可以传给负责部署的队友或上传到私有服务器，它只包含代码、公开静态资源、部署说明和空配置模板。打包使用明确允许的文件列表，排除真实配置、`.env`、`.secrets`、SQLite、用户 JSON、会话和恢复文件。

**仅将这个代码包或不含秘密的源码放进 Git。不要把真实配置混进包里。** `.gitignore` 和 `.dockerignore` 也已排除秘密及用户数据，但不能替代人工检查曾经提交过的文件。

## 2. 将当前 provider / API Key 写入私有配置

以下命令在你自己的电脑上运行。将域名替换成实际域名：

```powershell
.venv/Scripts/python.exe back-end/manage_config.py --provider deepseek --domain coach.your-domain.com
```

如果当前 PowerShell 已设置对应厂商 Key 环境变量，工具会直接使用；否则会隐藏输入让你填写。**不要把 Key 写在命令参数里或贴到聊天里。** 工具只输出文件位置，不打印 Key。

生成 `back-end/.secrets/server.json`，包含：

- 默认 provider 与其 API Key；可以在这个私有文件中按需添加 `OPENAI_API_KEY`、`XAI_API_KEY`、`ANTHROPIC_API_KEY` 或 `GEMINI_API_KEY`。
- 随机的加密主密钥和团队访问码。
- 生产环境标志、允许的域名和全站每分钟请求限制。

这是**真实秘密文件，不是可公开上传的“安全附件”**。只通过 SSH/SFTP 等加密管理连接传到你控制的服务器，或者把各字段写入托管平台的 Secret 管理器。它不能放在网页目录、Git、公开文件分享或 Docker 镜像中。

当前正在另一个进程里使用的 Key 不会被工具提取；请在原本设置 Key 的终端运行工具，或者在隐藏输入提示中重新填写。工具不会覆盖已存在的配置文件。

环境变量优先于配置文件；如果使用 Secret 管理器，直接设置同名变量即可。配置文件路径通过 `GAMECOACH_CONFIG_FILE` 指定；程序不会自动读取任意 `.env`。

## 3. 在校外 Linux 服务器启动

本节是**有自有域名、公网入口的 Compose + Caddy 路径**；只有 `github.io` 时先使用下面的 3A 节。准备一台能访问所选模型厂商、安装了 Docker Compose、带持久磁盘的服务器，以及指向它的域名。后端必须位于能访问厂商的网络：**在校园电脑本地转发请求，不会改变这台电脑的网络限制。**

树莓派 5 建议使用 64 位 Raspberry Pi OS / Debian，`uname -m` 应为 `aarch64`。8GB 内存足以作为小范围 API 转发与 SQLite 服务的起点，实际并发需测试；此路径不使用 AI HAT，也不在本机运行大模型。Docker 安装按系统版本使用 [Docker Debian 官方指南](https://docs.docker.com/engine/install/debian/)，先确认 `docker compose version` 可用。

在家中用 Caddy 直接提供公网入口，域名 A / AAAA 记录、路由器转发、防火墙和公网可达性必须正确；运营商 CGNAT 可能使 IPv4 入站转发不可行。不要发布不可达的 AAAA 记录。Caddy 的 80/443 端口需要满足证书签发与访问条件；隧道测试不需要这些入站设置。

1. 解压代码包到服务器工作目录。
2. 单独把私有 `server.json` 放到该目录的 `back-end/.secrets/server.json`。
3. 将配置文件所有权设为容器用户 10001，仅允许该用户读取。在服务器上运行：

```sh
sudo chown 10001:10001 back-end/.secrets/server.json
sudo chmod 400 back-end/.secrets/server.json
```

4. 将 `.env.example` 复制为 `.env`，只填写公开域名 `GAMECOACH_DOMAIN=coach.your-domain.com`。它需要与私有配置的 `GAMECOACH_ALLOWED_HOSTS` 一致。
5. 允许服务器入站 80/443，启动：

```sh
docker compose up -d --build
```

Caddy 提供 HTTPS，Python 服务不直接发布端口。真实 Key 通过 Compose secret 文件挂载进后端，不在构建阶段复制。数据库放在持久卷 `gamecoach_data`；不要删除该卷。后端以非 root 用户、只读根文件系统运行。

如果改用托管平台，需要提供同等配置：HTTPS 域名、只给 Python 的 Secrets、SQLite 持久磁盘、正确的反向代理信任范围。当前单进程 SQLite 版本适合小范围队友测试，不是多副本服务。

## 3A. 树莓派无自有域名：临时 HTTPS 测试

以下命令在树莓派的 Linux 终端执行。它们使用当前代码包，不会从尚未提交改动的 GitHub 仓库自动获得新代码。

### A. 安装依赖并解压代码

先在 Windows 按第 1 节生成最新代码包，通过 USB、SCP 或 SFTP 放到树莓派的 `~/gamecoach-deploy.zip`。不要将 Windows `.venv` 一起复制。

```sh
uname -m
sudo apt update
sudo apt install -y python3-venv unzip curl
mkdir -p ~/GameCoach
unzip ~/gamecoach-deploy.zip -d ~/GameCoach
cd ~/GameCoach
python3 -m venv .venv
.venv/bin/python -m pip install -r back-end/requirements.txt
```

首次测试使用新目录；如果已有运行服务，先按后面的“更新与回退”备份，再覆盖代码。建议使用稳定供电、散热与可靠磁盘，避免在写入中断电。

### B. 获取临时 HTTPS 地址

在树莓派第二个终端下载官方 ARM64 程序并启动。以下下载适用于上一步确认的 `aarch64` 系统。

```sh
cd ~
curl -fL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
./cloudflared tunnel --url http://127.0.0.1:8000
```

保留终端，记录输出的 `https://某个随机名字.trycloudflare.com`。在下一步服务启动前，请求可能暂时得到 502；这时不要先暴露一个没有生产保护的开发服务。

[Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 无需账户或自有域名，用于开发测试；进程停止后地址失效，重新创建时主机名会改变，没有可用性保证，也不支持 SSE。当前聊天一次返回完整回复，不依赖 SSE。它不是长期部署地址；稳定运行需要另外确定长期 HTTPS 入口。

### C. 在树莓派生成私有配置并启动

回到第一个终端，将占位主机名替换为 B 步输出的真实主机名，**不带 `https://` 和路径**：

```sh
cd ~/GameCoach
.venv/bin/python back-end/manage_config.py --provider deepseek --domain YOUR-RANDOM-HOST.trycloudflare.com
chmod 600 back-end/.secrets/server.json
```

按隐藏提示输入实际 DeepSeek API Key；已有对应 Key 环境变量时工具会使用它。不要将 Key 放在命令参数里。生成配置只进行一次；如果已经存在 `server.json`，工具会拒绝覆盖。

仅在自己的终端查看团队访问码：

```sh
.venv/bin/python -c "import json; print(json.load(open('back-end/.secrets/server.json'))['GAMECOACH_ACCESS_CODE'])"
```

随后启动服务：

```sh
export GAMECOACH_CONFIG_FILE="$PWD/back-end/.secrets/server.json"
.venv/bin/python -m uvicorn main:app --app-dir back-end --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

必须保持 Uvicorn 与 cloudflared 两个进程运行。仅信任本机隧道传来的代理头，不在这一路径使用 `--forwarded-allow-ips '*'`。生产配置依赖代理正确传递 HTTPS scheme 和原请求 Host；不匹配时先修正代理或配置，不关闭 HTTPS / Host 校验。

现在从自己的电脑打开 B 步的 HTTPS 地址，选择 DeepSeek、Key 留空、填写访问码，然后连接和发送一条问题。其他厂商只有配置了对应服务器 Key 或该用户保存的 Key 才能切换测试。

隧道重建后，应在服务器本地编辑已有私有配置中的 `GAMECOACH_ALLOWED_HOSTS` 为新主机名，再重启 Python 进程；**保留原主密钥和其他配置，不要通过删除配置重新生成来换域名**。配置读取有缓存，修改文件后需要重启进程。

临时后端地址变化后，新版私有恢复文件也会因为后端地址不匹配而拒绝导入，浏览器不会自动转移凭证。旧服务器数据仍在数据库中；更换入口前导出普通用户备份，并优先在确定的稳定入口进行长期测试。普通 JSON 导入会创建独立用户，不能找回旧身份或旧 Key。Pages 使用同一个稳定后端、仅页面来源变化时，可以通过新版恢复文件手动恢复。

这套手动步骤没有自动开机启动；关闭终端、SSH 断开或树莓派重启可能使服务停止。首次验证完成后，再为 Python 和选定的长期隧道配置服务管理与自动启动；不要把临时 URL 当成永久团队入口。

## 3B. GitHub Pages 连接远程 API

当前代码已支持以下配置，但没有预填一个不存在的公网地址。取得树莓派 HTTPS 地址后，在准备发布到 Pages 的源码中修改 `frontend/config.js`：

```js
window.GameCoachConfig = Object.freeze({ apiBaseUrl: 'https://YOUR-PI.YOUR-TAILNET.ts.net' });
```

将占位地址换成真实地址，不加 `/api`、`/frontend`、查询参数、用户名或密钥。该文件是公开配置，只能写服务器地址；页面加载后固定使用该地址，不从 URL 参数或用户输入动态选择服务器。HTTPS 页面不允许连接 HTTP 后端。未填写地址的 Pages 页面仍可 demo，但连接 API 会提示先配置。

服务器私有配置加入字符串字段 `GAMECOACH_CORS_ORIGINS`，值为 `https://raineymisty.github.io`，不带 `/GameCoach/` 或末尾 `/`。新建配置可通过 `manage_config.py --frontend-origin` 填写；已有配置在树莓派本地编辑此字段，保留原主密钥和 Key，然后重启 Python。

允许多个页面来源时用逗号分隔完整 origin，不使用 `*` 或通配子域名。后端仅放行 GET / POST / PUT / DELETE，以及 Authorization、Content-Type、X-GameCoach-Access 请求头。请求不携带 Cookie，依然要求 Bearer 会话和相应访问码；**CORS 不能替代身份认证**。配置依据 [FastAPI CORS 官方说明](https://fastapi.tiangolo.com/tutorial/cors/)。

用户会话按后端地址隔离，切换服务器不会自动发送旧令牌。新版私有恢复文件为 version 2，记录后端 origin；同一后端可以在 Pi 页面和 Pages 页面之间手动导入恢复。旧版 version 1 文件只接受原来的同源网站，请先在原网站使用新版页面重新导出，再迁移至 Pages。

`apiBaseUrl: ''` 保留同源模式，适用于从 Python 网站直接打开。Python 的 CSP 仍为同源连接；不要在本机 Python 网站上配置另一个远程地址来代替 Pages 验证。Pages 不自动得到 Python 的 CSP / HSTS 响应头，前端连接代码仍验证固定 HTTPS 目标并拒绝跟随重定向。

将前端修改提交并发布到 Pages 后，再进行第 5 节验收。Key、主密钥和数据库始终不进入 Pages。代码完成不等于网站已经发布或真实问答已经验证。

## 3C. 推荐：Tailscale Funnel + GitHub Pages（无需自有域名）

这一路径使用 Python 直接运行，不需要同时启动 Compose / Caddy。它提供 `*.ts.net` HTTPS 地址，外部队友不需要安装 Tailscale。Funnel 目前为 Beta，有带宽限制，不能当作已验证的高可用生产服务。设备名 / tailnet 域名保持一致有助于保持入口地址；更名或移除设备可能改变入口。[Funnel 官方说明](https://tailscale.com/docs/features/tailscale-funnel)

### 1. 安装 Tailscale 并登录

先按 3A 的 A 步准备最新代码包和 Python 环境，确保本机 8000 没有旧的未保护开发服务。以下命令在树莓派运行；已安装 Tailscale 时跳过安装。

```sh
curl -fsSL https://tailscale.com/install.sh -o ~/tailscale-install.sh
sudo sh ~/tailscale-install.sh
sudo systemctl enable --now tailscaled
sudo tailscale up
```

根据终端显示的登录链接在浏览器完成授权。安装来源为 [Tailscale Linux 官方下载页](https://tailscale.com/download/linux)。不要将设备登录链接或认证 Key 发给队友。

### 2. 创建 HTTPS 入口

```sh
sudo tailscale funnel --bg --https=443 http://127.0.0.1:8000
sudo tailscale funnel status
```

如提示开启 MagicDNS、HTTPS 或 Funnel 权限，按官方页面提示完成账户授权，再运行命令。需要 tailnet 管理者有权限启用相关设置；不要用只允许 tailnet 内访问的 Serve 代替公网 Funnel。

记录输出的真实地址，例如 `https://gamecoach-pi.your-tailnet.ts.net`。此时 Python 尚未启动，入口暂时无法返回应用是正常的。`--bg` 使 Funnel 后台配置持久化，但它不负责启动 Python；Python 仍需下一步启动，后续可配置 systemd。[Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)

### 3. 配置服务器与 Pages 来源

在树莓派终端将变量替换为刚刚获得的主机名：

```sh
cd ~/GameCoach
PI_API_HOST=gamecoach-pi.your-tailnet.ts.net
.venv/bin/python back-end/manage_config.py --provider deepseek --domain "$PI_API_HOST" --frontend-origin https://raineymisty.github.io
chmod 600 back-end/.secrets/server.json
```

`deepseek` 是示例，可改为 `gemini`、`openai`、`grok`、`claude`。Key 在树莓派隐藏输入。已有 `server.json` 时不要删除重建；用本地编辑器只更新 `GAMECOACH_ALLOWED_HOSTS`（实际 Pi 主机名）和 `GAMECOACH_CORS_ORIGINS`（Pages origin）两个字段，保留所有原 Key 和加密主密钥。直接 Python 部署的文件归当前服务用户所有，不使用 Compose 里的 UID 10001 所有权步骤。

### 4. 启动并检查后端

```sh
mkdir -p back-end/data
export GAMECOACH_CONFIG_FILE="$PWD/back-end/.secrets/server.json"
.venv/bin/python -m uvicorn main:app --app-dir back-end --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

保持终端运行，在另一终端检查（重新设置同一个 `PI_API_HOST` 变量）：

```sh
PI_API_HOST=gamecoach-pi.your-tailnet.ts.net
curl -f "https://$PI_API_HOST/api/health"
curl -i -X OPTIONS "https://$PI_API_HOST/api/sessions" \
  -H 'Origin: https://raineymisty.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,x-gamecoach-access'
```

健康接口应返回 JSON；预检应返回 200 和 `access-control-allow-origin: https://raineymisty.github.io`。健康检查不调用模型。首次 HTTPS 证书 / DNS 就绪可能需要时间；若返回 `HTTPS_REQUIRED`，核对 Tailscale 版本和代理头，不关闭生产 HTTPS 校验。

先从 Pi 的 HTTPS 网站使用访问码连接模型并完成一轮真实问答。确认后按 3B 修改电脑源码中的 `frontend/config.js` 并发布到原 Pages 地址；从 Pages 再测连接、历史、memory 和恢复。访问码仅在树莓派私有配置中查看，不提交到 Git。

### 5. 验证后配置 Python 开机运行

仓库和部署包包含 `deploy/gamecoach.service.example`。在树莓派复制模板，替换其中所有 `YOUR_PI_USER` 和项目绝对路径为实际值；服务用户应为拥有配置及数据的普通用户，不能保留占位符。先确保 `back-end/data` 存在，并确认模板中的 Python 路径、配置路径与数据目录正确。

```sh
cp deploy/gamecoach.service.example ~/gamecoach.service
nano ~/gamecoach.service
sudo install -m 644 ~/gamecoach.service /etc/systemd/system/gamecoach.service
sudo systemctl daemon-reload
```

停止第 4 步手动启动的 Uvicorn，再启用服务，避免两个进程争用端口：

```sh
sudo systemctl enable --now gamecoach
sudo systemctl status gamecoach --no-pager
sudo journalctl -u gamecoach -n 50 --no-pager
```

该模板限制文件系统写入，仅允许项目的 `back-end/data`；若另设数据库位置，需同时调整 `ReadWritePaths` 与配置。更改私有配置后运行 `sudo systemctl restart gamecoach`。重启树莓派后从另一设备验证 Pages、Funnel 和历史持久化。

关闭此 Funnel 可使用 `sudo tailscale funnel --https=443 off`，仅在确实要停止公开访问时执行。不要同时让 Cloudflare 和 Funnel 共用不一致的 Host 配置；若改用 3A 的临时 Cloudflare 地址，应同步更新前端 origin、后端允许主机名，并处理旧身份的地址绑定。

## 4. 给队友什么

给队友 **HTTPS 网站地址 + 团队访问码**，不要给他们真实 `server.json` 或你的 Key。

队友创建各自的本地用户后，填访问码，API Key 可以留空以使用服务器默认凭证；也可以填自己的 Key，后端会按用户隔离加密保存。默认凭证只用于后端调用，不会发给队友。切换厂商需要该厂商已有自己的 Key 或服务器默认 Key。

服务器默认全站每分钟最多 30 次生成请求、每轮输出预算按 Quick/Coach 限制，超限不生成。仍应在模型厂商控制台设置适合团队测试的消费预算；持有有效访问码的人可以使用服务器默认额度。撤销访问码会阻止新会话，但不会自动撤销已签发的用户会话；收回现有访问需管理员撤销 sessions 表中的相应记录。

当前会话有效期为 7 天，认证访问会续期。访问码用于创建 / 恢复会话，不是每个聊天请求都重新验证；私有恢复能力仍然需要保护。没有密码登录、成员管理界面或管理员一键禁用功能。不要给不受邀的人分享访问码，也不要给队友同一份私有恢复文件来共用身份。

## 5. 部署验收

不要只以首页能打开或健康接口成功判断真实模型可用。

| 检查 | 预期结果 |
| --- | --- |
| 打开公开 HTTPS 页面 | 证书正常，页面与公开资源可加载 |
| `GET https://你的主机名/api/health` | 返回服务状态；这一步不代表 Key 或生成可用 |
| 使用访问码连接厂商 | 能读取模型元信息；错误显示固定错误码 |
| 发送一条真实问题 | 返回真实模型正文并保存；在厂商控制台核对用量 |
| 配置另一家厂商后切换 | 相同用户、相同对话历史和 memory 继续可用 |
| 两名队友各建用户 | 看不到对方的历史、memory 与凭证 |
| 刷新 / 重连 | 已保存问答还在；已完成但未送达的回复可补回 |
| 导出普通用户 JSON | 含用户数据，不含厂商 Key、会话和恢复凭证 |
| 同一稳定地址导入私有恢复文件 | 恢复原服务器用户，仍需正确访问码 |
| 重启服务 / 容器 | 保留原数据与主密钥，原有加密资料仍可读 |
| 在隔离环境恢复备份 | 数据库可读、用户可恢复，未使用新主密钥替换旧主密钥 |

前后端测试在开发源码目录运行：

```powershell
.venv/Scripts/python.exe -m unittest discover -s back-end -p 'test_*.py' -v
node --test tests/*.test.cjs
```

代码部署包刻意不包含全部测试，不能在只有该包的服务器上照搬测试命令。自动测试使用模拟模型，不消耗真实额度；实机验收还需有效 Key。

## 6. 运行、更新与回退

Compose 路径常用操作（在部署目录）：

```sh
docker compose ps
docker compose logs --tail 100 app caddy
docker compose restart app
```

配置内容改变后需要重启 app；只读配置路径或挂载配置改变时需要重新创建容器。代码更新后执行 `docker compose up -d --build`，仅 restart 不会构建新镜像。日志按私人运维资料管理，排查问题时先检查并遮盖个人信息，不公开发送完整配置或认证请求头。

当前 Dockerfile 的 `--forwarded-allow-ips '*'` 仅建立在 app 不发布端口、只由可信 Caddy 经内部网络访问的前提上；不要直接对外映射 app:8000，或把不可信容器加入相同网络。直接运行的隧道方案使用前面限定 loopback 的命令。

更新前保存一套相互匹配的旧代码 / 镜像、SQLite 备份与原主密钥；停止生成或安排短暂停机，保持私有配置和数据卷不被源码覆盖。当前没有完整数据库迁移与降级框架；新版本若改变结构，先在备份副本验证，回退时恢复对应版本的代码与数据。不要一边新写数据一边直接覆盖回旧数据库。

`docker compose down` 会停止并删除容器 / 网络，但默认保留命名卷；**不要运行 `docker compose down -v`，它会删除包括数据库在内的持久卷**。当前命名卷随 Compose 项目名关联，移动部署目录或改变项目名后若看到空数据，应先核对旧卷，不要立即创建新用户或重建配置。

直接 Python 路径更新时，先停止服务、备份，再覆盖公开代码和 Python 源码；保留 `.secrets/` 与 `data/`，按新 requirements 安装依赖，最后在设置 `GAMECOACH_CONFIG_FILE` 的终端重新启动。服务重启不是浏览器刷新。

常见现象与处理：

| 现象 | 应核对的内容 |
| --- | --- |
| 隧道返回 502 | Python 是否运行、隧道目标是否为本机 8000、启动是否报错 |
| `HTTPS_REQUIRED` / Host 被拒绝 | 代理 HTTPS 转发头、可信代理范围、配置允许的主机名 |
| `STORAGE_KEY_ERROR` | 当前主密钥是否与数据库原来使用的相同；不要删除数据或换新密钥 |
| 厂商 DNS / TLS / 网络错误 | 树莓派到该厂商的网络、系统时间与证书；不要关闭证书校验 |
| 429 / 限流 | 生成频率或厂商额度；当前应用限流按进程计数，不是分布式限流 |
| 401 / 会话失效 | 重新连接或使用同地址的私有恢复文件；上游 Key 错误另有固定错误码 |
| 409 / 同步冲突 | 导出并核对本地数据与其他设备的修改，再同步；不要强行覆盖 |
| 重启后看不到历史 | 网站地址是否变化、是否恢复原身份、数据库路径 / 卷是否改变 |

当前没有自动告警、自动备份或自动更新；管理员需检查磁盘空间、供电、服务状态与模型费用。主机系统、Python 依赖、Docker / Caddy / cloudflared 的更新也需要安排维护与回归验证。

## 恢复、备份与网络中断

- 普通用户 JSON：历史、资料、阵容和 memory 的可读备份，不含厂商 Key 和账号访问凭证，应按个人数据保管。
- **私有恢复文件**：在页面“备份与恢复”中导出。它不含厂商 Key，但能恢复同一服务器用户，进而使用其已保存的 Key，因此等同账号访问凭证，不能发给其他队友或放进代码包。丢失浏览器会话后，在同一个网站导入恢复文件即可读取原有服务器数据。恢复后若尚未连 API，再选择厂商连接。
- 数据库及主密钥：管理员需要分别做受保护的备份；备份 SQLite 时使用 SQLite backup API 或先停止服务，不能在写入中仅复制主文件忽略 WAL。
- 本机修改先保留在浏览器，服务端一次事务保存完整问答；网络失败不会清除旧记录。同步冲突会报错并保留本机副本，不自动覆盖另一处修改。网络恢复后重新连接/导出备份核对数据。
- 如果生成完成并已保存，但浏览器丢失了 HTTP 回复，重新连接会按回复 ID 补回服务器中完成的答案，不重新生成该答案；较新的本地记忆修改会保留。
- 停止网页等待不保证撤销已发出的服务器生成；生成完成但浏览器没收到时，答案仍可能已在服务端历史中。客户端并非任意网络故障下都能保证“恰好一次”生成；不要把反复点击重试当成无费用操作。

管理员备份至少包括：SQLite 一致性副本、原加密主密钥、所用代码版本、必要的私有配置；密钥备份与数据库副本分开保护。Docker 卷数据不能通过只复制工作目录来备份。恢复时先停止写入，将对应数据库和主密钥放回正确位置，设置 app 用户读写数据、只读秘密的权限，再启动并用原身份核对历史。

从本地模式迁到生产配置时，本地数据库原来由 `back-end/.secrets/storage.key` 加密；管理工具生成的是另一把主密钥。要保留原数据，需在受保护的管理环境安排匹配原主密钥的配置或进行明确的数据迁移，不能直接把旧数据库与新生成密钥配对。

`manage_config.py` 是首次配置生成器，不是密钥轮换工具。当前没有自动重加密 / 主密钥轮换命令，不能只改 `GAMECOACH_ENCRYPTION_KEY` 来轮换。厂商 Key 泄漏时在厂商控制台撤销并更新对应凭证；访问码或会话泄漏时还需处理现有会话，不能仅修改访问码就假定所有访问已失效。

## 安全边界

HTTPS 保护传输，Fernet 保护上述存储字段；应用不回显厂商原始错误、密钥或含输入值的校验异常。浏览器仍需展示用户数据，也保留默认本地缓存，所以共享电脑上应妥善管理浏览器及备份。

服务器转发让浏览器只连接你的网站，校园 DNS 不再需要解析模型厂商域名。**这不保证校园网无法观察或阻止你的网站，也不能保证受到管理的设备、TLS 检查代理或被攻破的服务器永远无法读取数据。** 如果学校限制目标网站，应使用允许的网络或由网络管理员处理。不要关闭证书校验来解决连接问题。

参考：[FastAPI HTTPS](https://fastapi.tiangolo.com/deployment/https/)、[Fernet](https://cryptography.io/en/latest/fernet/)、[Docker Compose Secrets](https://docs.docker.com/compose/how-tos/use-secrets/)。
