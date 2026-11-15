# 发布

1. 修改 `package.json` 中的版本号，采用 `主版本.次版本.修订号`。
2. 运行 `npm test`、`npm run check`，再用 `npm run build` 构建本地完整程序。
3. 在适用版本的网易云中核对播放、切歌、桌面歌词、迷你窗口、主题和 PNG 导出。
4. 审核随包素材的使用条件，安装 Inno Setup 6.5+，运行 `npm run build:installer` 生成 EXE 安装程序。核对安装、快捷方式和卸载入口。
5. 创建同名 Git tag，例如 `v1.0.1`，在 GitHub Releases 发布对应版本与更新说明。

自动更新查询仓库的最新正式 Release。正式版本使用 `v1.0.1` 这类三段版本号；测试版本使用 GitHub 的 Pre-release 标记。源码结构变化时同步修改构建脚本和文档。

用户网站可链接到 GitHub Releases，并保留安装说明和项目介绍。

安装程序由 `installer/TouhouNCM.iss` 构建，版本号从 `package.json` 读取。安装位置为当前用户的 `%LOCALAPPDATA%\Pachi\NcmImmersive`，与旧 ZIP 安装方式保持一致。程序更新保留客户端路径和网易云自身设置。
