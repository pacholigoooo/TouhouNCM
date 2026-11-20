# TouhouNCM

**为东方众设计的网易云音乐 Windows 美化包。**

TouhouNCM 在网易云桌面客户端里提供沉浸播放页、封面流动背景、逐字歌词和东方音乐工具。日常听歌、桌面歌词与迷你窗口使用同一套主题。

1.1.0 优化了内存占用。收起播放页后会释放大封面和背景图，关闭桌面歌词后会释放绘制资源。网易云最小化时会自动回收闲置缓存，桌面歌词和迷你窗口仍可正常使用。

## 功能

- **沉浸播放**：封面取色、流动背景、全屏播放、逐字高亮、译文、字体选择和弧形歌词排版。
- **桌面歌词**：原文、译文与音译，横竖排、对齐、独立字号、整体缩放、透明背景、拖动与锁定。
- **统一主题**：播放页、主界面、迷你窗口和桌面歌词配色联动，支持东方角色主题。
- **界面简化**：按需隐藏入口、通知红点与推广组件。
- **东方工具**：原曲溯源、东方找歌、版本筛选、加入播放队列。
- **听歌角色测试**：根据常听与最近曲目、歌曲标签和歌词线索匹配角色，提供说明和 PNG 导出。角色立绘由本地素材提供。
- **更新提醒**：在设置中检查 GitHub Releases，支持每 12 小时自动检查。

## 安装与使用

项目面向 **Windows 10/11 x64、网易云音乐 3.x 的 Orpheus 客户端**。已实机核对版本为 **3.1.43.205627**；其他版本的适配状态见 [兼容性说明](docs/compatibility.md)。

**下载 Windows 安装程序：[GitHub Releases](https://github.com/pacholigoooo/TouhouNCM/releases/latest) · [百度网盘](https://pan.baidu.com/s/59iNZvDIhNRovi_kg5-X7-g)**。

在 GitHub Releases 下载 `TouhouNCM-1.1.0-Setup-x64.exe`，其中包含程序和全部 162 项角色立绘资源。

1. 双击下载的 EXE，点击“安装”。
2. 安装程序自动解包，并创建桌面和开始菜单快捷方式。
3. 通过桌面上的「网易云音乐 · 沉浸听歌」快捷方式启动。原入口正在运行时，先从系统托盘退出网易云音乐。

开始菜单中的“重新选择网易云路径”可更换客户端位置。卸载时，在 Windows 的“已安装的应用”中找到 **TouhouNCM**，点击卸载。辅助程序负责加载页面扩展与原生歌词窗口，网易云安装目录由原客户端维护。

## 构建

需要 Windows x64、Node.js 20 或更新版本，以及 Windows 自带的 .NET Framework 4.x 编译器。项目使用原生 JavaScript 和 C#，运行时依赖 Windows/.NET。

```powershell
git clone https://github.com/pacholigoooo/TouhouNCM.git
cd TouhouNCM
npm test
npm run check
npm run build:code
```

`build:code` 构建完整程序逻辑，角色卡 PNG 导出需要另行准备立绘。按 [素材说明](docs/assets.md) 放入图片后，运行 `npm run build` 生成带本地立绘的程序。输出为 `dist/NcmImmersive.exe`。

安装 [Inno Setup 6.5+](https://jrsoftware.org/isdl.php) 后，运行 `npm run build:installer`，生成 `dist/TouhouNCM-1.1.0-Setup-x64.exe`。自定义编译器路径可通过环境变量 `ISCC_PATH` 指定。安装向导源码位于 `installer/`。

## 项目结构

```text
src/renderer/   播放页、主题、歌词桥接、东方工具与更新提醒
src/native/     启动器、客户端发现、桌面歌词和迷你窗口
assets/        素材清单与来源
scripts/       构建与测试入口
tests/         时钟、生命周期、查询、匹配与客户端发现回归检查
docs/          架构、兼容性、素材和发布说明
```

接口关系和模块职责见 [架构说明](docs/architecture.md)。提交改动请参考 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 反馈

在 [Issues](https://github.com/pacholigoooo/TouhouNCM/issues) 提交网易云完整版本号、Windows 版本、复现步骤和相关截图。版本号可在网易云的「关于」中查看。

## 许可证与来源

项目代码使用 [MIT License](LICENSE)。角色立绘由对应作者持有权利，其来源和使用条件见 [THIRD_PARTY.md](THIRD_PARTY.md)。东方 Project 原作版权归上海爱丽丝幻乐团等相应权利人所有。

## 致谢

- [Apple Music](https://www.apple.com/apple-music/) 为沉浸播放页提供视觉方向参考。
- [BetterNCM](https://github.com/BetterNCM) 的插件生态为功能方向提供参考。
- [Leafmy/BetterNCM-v3](https://github.com/Leafmy/BetterNCM-v3) 中的 RefinedNowPlaying、原生桥接文档与选择器资料用于客户端接口研究。
- [THBWiki](https://thwiki.cc/) 为东方原曲查询提供资料与接口。
- dairi / はるか与 kaoru 提供东方角色立绘素材。
- [Inno Setup](https://jrsoftware.org/) 用于构建 Windows 安装程序。

详细参考链接、素材来源与用途见 [THIRD_PARTY.md](THIRD_PARTY.md)。

作者：**pachi**。
