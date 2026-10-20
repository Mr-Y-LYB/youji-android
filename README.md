# 游迹 · 本地游戏档案

游迹是一款 Android 应用，用来记录 Steam、Epic 等平台的游戏。它可以记录游戏平台、游玩状态、总时长、近期时长、成就、评分、价格、日期，你也可以进行任意备注。个人记录保存在本地目录中，不需要服务器或账号。

## 安装

将 `dist/游迹-v1.3.2.apk` 传到 Android 手机，打开文件安装。已安装旧版的手机可直接覆盖更新，原有记录会保留。首次安装时，手机可能要求允许当前文件管理器安装应用。支持 Android 8.0 及以上。

Windows：从 v1.3.2 的 GitHub Release 下载 `YouJi-Windows-v1.3.2.zip`，完整解压后双击 `Install.cmd`。安装后从开始菜单打开「游迹」。也可下载 `YouJi-Windows-v1.3.2.exe` 直接运行。无需安装 Python，需要 Microsoft Edge。Windows 数据保存在 `%LOCALAPPDATA%\YouJi`，可用 JSON 备份与 Android 版迁移。截图直接识别目前仅在 Android 版提供。

## 使用

- 在「添加」中输入部分游戏名，例如“荒野”，可选择内置的“荒野大镖客：救赎2 / Red Dead Redemption 2”。联网时还会查询 Steam 商店名称；英文名可以手动修改。
- 加入游戏后会按名称匹配 Steam 商店预览图，并保存到设备本地；编辑记录的「更多数据」中也可手动选择图片。手动图片会随 JSON 备份迁移。
- 点击游戏进入详情。导入的每款 Steam 游戏都会排队从 Steam 官方公开页面读取各自的成就名称与说明，例如《荒野大镖客：救赎2》共 51 项；打开某款详情时优先读取它。读取后清单保存在本机，可逐项勾选或取消，也可在详情中刷新。Epic 等当前未接入自动读取的平台可手动添加成就。旧版数字保留在详情中的「旧版统计」，不会自动对应具体条目。
- 在「导入」中选择小黑盒游戏墙截图，手机本地识别名称、总时长和近期时长。若截图有旧版成就数字，会保存为历史统计。导入前会显示逐条核对页面。也可以粘贴复制的文字，或选择 JSON、CSV、TSV、Excel `.xlsx` 文件。
- 在「设置」中导出 JSON 备份。换手机后安装游迹，再导入此备份。建议在卸载或换机前先导出；卸载应用会清除手机内的记录。
- 新版本首次打开会显示「更新说明」，之后可在「设置」里再次查看。
- 应用打开时会检查 GitHub Releases；发现新版本会询问是否下载。用户确认后，应用下载并校验 APK，再打开 Android 系统安装界面。设置里也有「检查更新」。

## 重新打包

用 Android Studio 打开本目录，安装 Android SDK 35，选择 **Build > Build APK(s)**。也可以在 PowerShell 中运行 `./build.ps1`，脚本会优先使用项目内已有的构建工具，并将 APK 复制到 `dist`。其他电脑上可运行 `gradlew.bat assembleDebug`。项目使用 JDK 17、Gradle 8.13、Android Gradle Plugin 8.13.0。

Windows 版使用 Python 3.13 和 PyInstaller。在 Windows 上运行 `python -m pip install pyinstaller pillow`，然后运行 `./build-windows.ps1`，可生成 `dist/YouJi-Windows-v1.3.2.zip`。

## 数据和识别说明

联网搜索与封面匹配会向 Steam 商店查询游戏名称；读取 Steam 成就时，会向 Steam 社区请求对应游戏的公开页面。个人勾选状态、记录和截图不会上传。成就清单与下载的封面保存在应用私有目录。内置的中文文字识别模型可离线处理截图。Steam 商店的搜索结果受服务可用性和检索排序影响；找不到的游戏可手动输入。Steam 成就页面格式或网络访问发生变化时，可在详情中手动添加。截图导入可能识别错文字，请自行核对结果。


## 发布更新

应用打开时先检查 GitHub Release；接口不可用时会尝试仓库中的 `update.json` 静态版本信息及其 CDN 镜像。当前版本为 v1.3.2。后续版本须上传与 Release 标签版本一致的 APK，并同步更新 `update.json` 中的 SHA-256 digest。所有后续 APK 必须使用原签名，且 Android `versionCode` 必须递增。
