# Cezar 批次提交服务

由已配置的 Cezar 服务用户安装。先同步已合入的工作流，并在 E3 核对 `integration` 的四项必过检查和来源。

## 安装

在服务器上把 `repo` 设为 Cezar 中登记的仓库副本。用绝对路径填写环境文件，给本批次选一个新名称。

```bash
install -d -m 700 "$HOME/cezar-state" "$HOME/cezar-bin" "$HOME/.config/systemd/user"
test -f "$repo/.ai/bin/submit-modules.sh"
ln -s "$repo/.ai/bin/submit-modules.sh" "$HOME/cezar-bin/submit-modules.sh"
install -m 644 "$repo/.ai/systemd/submit-modules.service" "$HOME/.config/systemd/user/submit-modules.service"
```

`~/cezar-state/submit-modules.env` 保存以下设置，权限设为 600。

```ini
CEZAR_PROJECT_ROOT=/absolute/path/to/the/registered/checkout
CEZAR_PROJECT_NAME=project-one
CEZAR_BATCH=night-2026-11-24
CEZAR_API_URL=http://127.0.0.1:4321
```

仓库副本的私有项目配置将基线设为 `integration`，默认运行器设为 Codex。在当前服务的模型列表中选择已经验证的命名模型，放入 `namerModels.codex`。把 `branchNaming` 配成让命名器照抄任务里 `Task branch:` 后的名字。工作流在分支不匹配时会停住。

## 启动与检查

准备好批次后启用用户级服务。用户停留模式沿用 Cezar 已有的设置。

```bash
systemctl --user daemon-reload
systemctl --user enable --now submit-modules.service
journalctl --user -u submit-modules.service -f
```

每个项目同时由一个提交进程持有锁。重启沿用 `~/cezar-state/<项目>/<批次>.json`。已结束的批次用新批次名启动。不要删除未完成批次的台账来重试。

开工前保留三方对账证据。收到对账通知时，核对台账、Cezar 运行和 GitHub 草稿的编号及分支。超出 12 小时会写摘要并列出未完成的任务。报告任务失败时，仍可读 `~/cezar-state/<项目>/<批次>-summary.md`。

Telegram 转发脚本装在仓库外，以私有配置读取凭据。服务给转发脚本传入脱敏摘要，只在单独的 D3/E3 演练中发送测试消息和重启服务器。
