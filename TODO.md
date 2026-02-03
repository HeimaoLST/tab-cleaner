# TODO

- [ ] 对齐仓库期望的代码结构/命名（如果需要拆分目录，如 `src/`）
- [ ] 两段式决策接口：候选集（candidates）→ 决策（rules/AI stub）→ actions[]
- [ ] 安全阀完善：`maxClosePerRun`、`protectedHosts`、内部页保护、Undo（重开上一轮关闭 URL）
- [ ] 验证流程：Reload 扩展 → Preview → Apply → Undo（并确保不会一次性关太多）
