#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WELearn Helper Desktop Launcher
--------------------------------
Starts the bundled Web console with PHP's built-in server on 127.0.0.1
and opens the default browser.

The Web files live either in ../Web (GitHub layout) or ../welearn-helper
(existing server/deployment layout).
"""
from __future__ import annotations

import glob
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_NAME = "WELearn Helper"
APP_VERSION = "v2.4.3"
DEFAULT_PORT = 5566

ROOT = Path(__file__).resolve().parent.parent
WEB_CANDIDATES = [ROOT / "Web", ROOT / "welearn-helper"]


def find_web() -> Path | None:
    for path in WEB_CANDIDATES:
        if (path / "index.php").is_file():
            return path
    return None


def find_php() -> Path | None:
    candidates: list[Path] = []
    env = os.environ.get("PHP_EXE", "").strip()
    if env:
        candidates.append(Path(env))
    found = shutil.which("php")
    if found:
        candidates.append(Path(found))
    candidates += [
        ROOT / "Desktop" / "php" / "php.exe",
        ROOT / "php" / "php.exe",
        Path(r"C:\php\php.exe"),
        Path(r"C:\xampp\php\php.exe"),
        Path(r"C:\wamp64\bin\php\php.exe"),
        Path(r"C:\laragon\bin\php\php.exe"),
        Path("/usr/bin/php"),
        Path("/usr/local/bin/php"),
    ]
    for path in candidates:
        if path.is_file():
            return path
    # Laragon keeps PHP under a versioned directory.
    for pattern in (r"C:\laragon\bin\php\php-*\php.exe", r"C:\wamp64\bin\php\php*\php.exe"):
        matches = sorted(Path(p) for p in glob.glob(pattern))
        if matches:
            return matches[-1]
    return None


def free_port(start: int = DEFAULT_PORT) -> int:
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("没有可用的本地端口")


def open_browser(url: str) -> None:
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


class Server:
    def __init__(self, php: Path, web: Path, port: int, log_cb=None):
        self.php = php
        self.web = web
        self.port = port
        self.log_cb = log_cb or (lambda line: None)
        self.proc: subprocess.Popen | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/"

    def start(self) -> None:
        (self.web / 'data').mkdir(exist_ok=True)
        if self.proc and self.proc.poll() is None:
            return
        env = os.environ.copy()
        env.setdefault("PHP_CLI_SERVER_WORKERS", "4")
        flags = 0
        if os.name == "nt":
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cmd = [str(self.php), "-S", f"127.0.0.1:{self.port}", "-t", str(self.web)]
        self.log_cb("$ " + " ".join(cmd))
        self.proc = subprocess.Popen(
            cmd,
            cwd=str(self.web),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=flags,
        )
        threading.Thread(target=self._read_log, daemon=True).start()

    def _read_log(self) -> None:
        assert self.proc and self.proc.stdout
        for line in self.proc.stdout:
            self.log_cb(line.rstrip())

    def wait_ready(self, timeout: float = 8.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc and self.proc.poll() is not None:
                return False
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.5):
                    return True
            except OSError:
                time.sleep(0.15)
        return False

    def stop(self) -> None:
        if not self.proc:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None


def run_headless() -> int:
    php = find_php()
    web = find_web()
    if not php:
        print("未找到 PHP。请安装 PHP 7.4+，或设置环境变量 PHP_EXE。")
        return 2
    if not web:
        print("未找到 Web/index.php 或 welearn-helper/index.php。")
        return 2
    port = free_port()
    server = Server(php, web, port, print)
    server.start()
    if not server.wait_ready():
        print("本地服务启动失败。")
        server.stop()
        return 1
    print(f"{APP_NAME} {APP_VERSION} -> {server.url}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
    return 0


def run_gui() -> int:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk, scrolledtext

    php = find_php()
    web = find_web()
    port = free_port()
    server = Server(php, web, port) if php and web else None
    auto_opened = False

    root = tk.Tk()
    root.title(f"{APP_NAME} {APP_VERSION}")
    root.geometry("680x480")
    root.minsize(560, 380)
    root.configure(bg="#0f172a")

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("TFrame", background="#0f172a")
    style.configure("TLabel", background="#0f172a", foreground="#dbeafe", font=("Microsoft YaHei UI", 10))
    style.configure("Title.TLabel", font=("Microsoft YaHei UI", 18, "bold"), foreground="#ffffff")
    style.configure("Sub.TLabel", foreground="#7dd3fc", font=("Microsoft YaHei UI", 9))
    style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=(12, 7))

    header = ttk.Frame(root)
    header.pack(fill="x", padx=18, pady=(16, 6))
    ttk.Label(header, text=APP_NAME, style="Title.TLabel").pack(anchor="w")
    ttk.Label(header, text=f"{APP_VERSION}  ·  本地 Web 控制台启动器", style="Sub.TLabel").pack(anchor="w", pady=(2, 0))

    info = ttk.Frame(root)
    info.pack(fill="x", padx=18, pady=(4, 4))
    status_var = tk.StringVar(value="准备启动…")
    url_var = tk.StringVar(value="")
    ttk.Label(info, textvariable=status_var).pack(anchor="w")
    ttk.Label(info, textvariable=url_var, foreground="#38bdf8").pack(anchor="w", pady=(2, 0))
    web_var = tk.StringVar(value=f"Web 目录：{web or '未找到'}")
    ttk.Label(info, textvariable=web_var, foreground="#94a3b8", font=("Consolas", 9)).pack(anchor="w", pady=(2, 0))
    php_var = tk.StringVar(value=f"PHP：{php or '未找到'}")
    ttk.Label(info, textvariable=php_var, foreground="#94a3b8", font=("Consolas", 9)).pack(anchor="w", pady=(2, 0))

    buttons = ttk.Frame(root)
    buttons.pack(fill="x", padx=18, pady=(8, 6))
    start_btn = ttk.Button(buttons, text="启动并打开")
    stop_btn = ttk.Button(buttons, text="停止服务", state="disabled")
    open_btn = ttk.Button(buttons, text="打开网页", state="disabled")
    choose_btn = ttk.Button(buttons, text="选择 php.exe")
    start_btn.pack(side="left", padx=(0, 8))
    stop_btn.pack(side="left", padx=(0, 8))
    open_btn.pack(side="left", padx=(0, 8))
    choose_btn.pack(side="left")

    log = scrolledtext.ScrolledText(
        root, height=12, bg="#020617", fg="#cbd5e1", insertbackground="#38bdf8",
        relief="flat", font=("Consolas", 9), padx=8, pady=8,
    )
    log.pack(fill="both", expand=True, padx=18, pady=(4, 16))
    log.configure(state="disabled")

    def add_log(line: str) -> None:
        log.configure(state="normal")
        log.insert("end", line.rstrip() + "\n")
        log.see("end")
        log.configure(state="disabled")

    def set_controls(running: bool) -> None:
        start_btn.configure(state="disabled" if running else "normal")
        stop_btn.configure(state="normal" if running else "disabled")
        open_btn.configure(state="normal" if running else "disabled")

    def start() -> None:
        nonlocal server, php
        if server and server.proc and server.proc.poll() is None:
            return
        php = find_php()
        web = find_web()
        if not php:
            messagebox.showerror(APP_NAME, "未找到 PHP。\n请安装 PHP 7.4+，或选择 php.exe。")
            status_var.set("未找到 PHP，无法启动")
            return
        if not web:
            messagebox.showerror(APP_NAME, "未找到 Web 目录（Web/index.php 或 welearn-helper/index.php）。")
            status_var.set("未找到 Web 目录")
            return
        p = free_port()
        server = Server(php, web, p, add_log)
        php_var.set(f"PHP：{php}")
        web_var.set(f"Web 目录：{web}")
        status_var.set("正在启动 PHP 本地服务…")
        set_controls(True)
        try:
            server.start()
            if not server.wait_ready():
                status_var.set("启动失败，请查看下方日志")
                set_controls(False)
                server.stop()
                return
            status_var.set("运行中")
            url_var.set(f"本机地址：{server.url}")
            add_log(f"READY {server.url}")
            open_browser(server.url)
        except Exception as exc:
            status_var.set(f"启动失败：{exc}")
            add_log(f"ERROR {exc}")
            set_controls(False)

    def stop() -> None:
        if server:
            server.stop()
        status_var.set("已停止")
        set_controls(False)
        root.after(200, lambda: start_btn.configure(state="normal"))

    def open_page() -> None:
        if server and server.proc:
            open_browser(server.url)

    def choose_php() -> None:
        nonlocal php
        path = filedialog.askopenfilename(title="选择 php.exe", filetypes=[("PHP", "php.exe;php"), ("All", "*.*")])
        if not path:
            return
        php = Path(path)
        php_var.set(f"PHP：{php}")
        add_log(f"PHP set to {php}")

    start_btn.configure(command=start)
    stop_btn.configure(command=stop)
    open_btn.configure(command=open_page)
    choose_btn.configure(command=choose_php)

    def on_close() -> None:
        stop()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.after(350, start)
    root.mainloop()
    return 0


def main() -> int:
    if "--no-gui" in sys.argv:
        return run_headless()
    return run_gui()


if __name__ == "__main__":
    raise SystemExit(main())
