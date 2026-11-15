# 发布

1. 修改 `package.json` 中的版本号，采用 `主版本.次版本.修订号`。
2. 运行 `npm test`、`npm run check`，再用 `npm run build` 构建本地完整程序。
3. 在适用版本的网易云中核对播放、切歌、桌面歌词、迷你窗口、主题和 PNG 导出。
4. 审核随包素材的使用条件，并将安装文件与说明整理为 ZIP。
5. 创建同名 Git tag，例如 `v1.0.1`，在 GitHub Releases 发布对应版本与更新说明。

自动更新查询仓库的最新正式 Release。正式版本使用 `v1.0.1` 这类三段版本号；测试版本使用 GitHub 的 Pre-release 标记。源码结构变化时同步修改构建脚本和文档。

用户网站可链接到 GitHub Releases，并保留安装说明和项目介绍。
