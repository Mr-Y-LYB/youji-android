# 游迹

记录 Steam、Epic 等平台的游戏、游玩时长、状态和备注。Android 和 Windows 版的数据均保存在本机。

## 安装

- Android：[下载 APK](https://github.com/Mr-Y-LYB/youji-android/releases/download/v1.3.2/YouJi-v1.3.2.apk)。支持 Android 8.0 及以上，可覆盖旧版安装。应用发现新版本时会提示下载，安装仍需在系统界面确认。
- Windows：[下载安装包 ZIP](https://github.com/Mr-Y-LYB/youji-android/releases/download/v1.3.2/YouJi-Windows-v1.3.2.zip)，解压后运行 `Install.cmd`；也可下载[便携版 EXE](https://github.com/Mr-Y-LYB/youji-android/releases/download/v1.3.2/YouJi-Windows-v1.3.2.exe)直接运行。需要 Microsoft Edge。

## 使用

- 添加游戏时可输入部分名称，选择搜索结果和游戏平台。Steam 游戏可匹配商店封面。
- 打开游戏详情可查看成就并逐项标记。导入的 Steam 游戏会依次读取各自的公开成就清单；Epic 等暂未接入自动读取的平台可手动添加。旧版成就数字会保留为历史统计。
- Android 版可从小黑盒游戏墙截图识别游戏和时长。两端都支持粘贴文字、导入 JSON、CSV、TSV、Excel 文件。截图识别可能出错，导入前请核对。
- 在设置中导出 JSON 备份，换设备后再导入。成就勾选和手动封面会随备份迁移。

## 数据

Android 数据在应用私有目录；Windows 数据在 `%LOCALAPPDATA%\YouJi`。名称搜索、封面和 Steam 成就需要联网；记录和截图不上传。更新检查使用 GitHub Releases。

## 构建

Android：安装 JDK 17 和 Android SDK 35，运行 `./build.ps1`，APK 输出到 `dist`。

Windows：安装 Python 3.13、PyInstaller 和 Pillow，运行 `./build-windows.ps1`。Windows 版暂不支持直接识别截图。
