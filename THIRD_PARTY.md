# 第三方来源

## 设计与功能参考

- **[Apple Music](https://www.apple.com/apple-music/)**：沉浸播放页的视觉方向参考，用于封面、背景色彩与歌词呈现的设计研究。
- **[BetterNCM](https://github.com/BetterNCM)** 及其 **[插件生态](https://github.com/BetterNCM/BetterNCM-Plugins)**：功能方向参考，用于播放器扩展、歌词呈现与界面定制的功能规划。

## 接口研究参考

当前歌曲、播放状态与歌词相关接口的研究参考了 [Leafmy/BetterNCM-v3](https://github.com/Leafmy/BetterNCM-v3) 的以下内容，来源同时记录于 [bridge.js](src/renderer/bridge.js) 顶部：

- **[RefinedNowPlaying/main.js](https://github.com/Leafmy/BetterNCM-v3/blob/main/plugins/src/RefinedNowPlaying/main.js)**：用于播放页接口与选择器的研究。
- **[原生桥接文档](https://github.com/Leafmy/BetterNCM-v3/blob/main/docs/03-native-bridge.md)**：用于客户端原生桥接接口的研究。
- **[loader/selectors.json](https://github.com/Leafmy/BetterNCM-v3/blob/main/loader/selectors.json)**：用于 Orpheus 客户端元素定位与选择器的研究。

## 安装程序

EXE 安装程序使用 [Inno Setup](https://jrsoftware.org/) 构建。简体中文语言文件来自 [Inno Setup 官方仓库](https://github.com/jrsoftware/issrc/blob/main/Files/Languages/ChineseSimplified.isl)，由 Zhenghan Yang（Kira）维护。原始署名保留在语言文件中，许可见 [InnoSetup-LICENSE.txt](installer/InnoSetup-LICENSE.txt)。

## 东方角色立绘

东方角色立绘用于角色展示及听歌角色测试的 PNG 导出。

素材逐项来源见 [manifest.json](assets/characters/manifest.json)。公开仓库包含元数据，原始图片保留在本地。

- **dairi / はるか**：[作者主页](https://www.pixiv.net/users/4920496)、[立绘发布说明](https://seiga.nicovideo.jp/seiga/im3189645)。请查看发布包中的「素材利用規約」「ご一読下さい」及作者当前说明。
- **kaoru / 幻想幽玄庵**：[作者网站](https://gensoukyou.1000.tv/)、[玛○奇素材作品页](https://www.pixiv.net/artworks/28273013)。请查看作者网站利用规约。

## 资料与接口

东方原曲查询使用 [THBWiki](https://thwiki.cc/) 提供的页面与接口，结果保留来源跳转。页面内容及译文遵循各自来源的授权说明。

网易云音乐由相应权利人提供。扩展通过本地客户端接口读取播放状态和执行用户操作，音乐、封面与歌词由客户端及其内容提供方提供。
