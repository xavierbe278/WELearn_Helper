# WELearn Helper Desktop

Windows 桌面启动器：启动本地 PHP Web 控制台，并自动打开浏览器。默认端口 5566。

## 需要

- Windows 10/11；
- Python 3.10+；
- PHP 7.4+（`php.exe` 在 PATH 中，或放在 `Desktop/php/php.exe`，或在界面里手动选择）；根目录 `启动.bat` 会在缺失时自动下载便携版。

## 启动

双击：

```text
start.bat
```

或：

```powershell
python wlearn_helper.py
```

启动器会：

1. 查找 `Web/index.php` 或 `welearn-helper/index.php`；
2. 在 `127.0.0.1` 找空闲端口；
3. 启动 PHP 内置服务器；
4. 自动打开浏览器；
5. 关闭窗口时停止服务。

## 无界面测试

```powershell
python wlearn_helper.py --no-gui
```

## 指定 PHP

```powershell
$env:PHP_EXE = "C:\php\php.exe"
python wlearn_helper.py
```

## 数据

数据写在 Web 目录下的 `data/`，与手动部署的 Web 版一致。
