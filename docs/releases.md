# 发布

1. 修改 `package.json` 中的版本号，采用 `主版本.次版本.修订号`。
2. 运行 `npm test`、`npm run check`，再用 `npm run build` 构建本地完整程序。
3. 在适用版本的网易云中核对播放、切歌、桌面歌词、迷你窗口、主题和 PNG 导出。
4. 审核随包素材的使用条件，安装 Inno Setup 6.5+，运行 `npm run build:installer` 生成 EXE 安装程序。核对安装、快捷方式和卸载入口。
5. 创建同名 Git tag，例如 `v1.0.1`，在 GitHub Releases 发布对应版本与更新说明。

自动更新读取本仓库最新的正式 Release。标签格式为 `v主.次.修订`，安装包命名为 `TouhouNCM-主.次.修订-Setup-x64.exe`，Windows 产品名为 `TouhouNCM`。将完整安装包附到草稿后发布。测试版在 GitHub 勾选 Pre-release。

客户端发现更高版本后会后台下载，等玩家退出网易云再安装。发布页链接供用户手动获取安装包。同版重新上传时可沿用下载链接，已经装过该版号的用户需要覆盖安装一次才会得到重发的内容。

国内备用源的根目录为 `https://www.touhou-life.top/updates/touhouncm/`。将与 GitHub 相同的安装包放入版本子目录，例如 `v1.2.1/TouhouNCM-1.2.1-Setup-x64.exe`。完整下载并核对文件后，再替换根目录的 `latest.json`。这个文件使用 GitHub 正式 Release 的 `tag_name`、`html_url`、`draft`、`prerelease` 和 `assets` 字段。安装包条目保留其 GitHub 下载地址、文件名、发布状态和字节数。JSON 支持跨域 GET 和缓存重新验证，安装包直接返回二进制内容。

网站的 TouhouNCM 介绍页提供 GitHub、国内直链和百度网盘三个下载入口。

安装程序由 `installer/TouhouNCM.iss` 构建，版本号从 `package.json` 读取。安装位置为当前用户的 `%LOCALAPPDATA%\Pachi\NcmImmersive`，与旧 ZIP 安装方式保持一致。程序更新保留客户端路径和网易云自身设置。
