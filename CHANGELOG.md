# Changelog

## 0.1.0

- 首个版本：输入框停顿后由当前会话的模型续写半句，灰色显示，`Tab` 收下。
- 宿主侧 `POST /api/ghost-input/complete`，通过 `ctx.llm` 走会话模型，45 秒 LRU 缓存与单在途请求。
- 浏览器侧监听停顿、`Tab`、`Esc`、输入法组合事件与焦点变化；`/`、`@` 开头不触发。
