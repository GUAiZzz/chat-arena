# Chat Arena

Chat Arena 是一个聊天偏好盲测与“聊灵”成长 Demo。体验者会看到同一个问题对应的两条匿名回复，在 9 次判断中选择更愿意继续聊的一方；成长反馈负责把偏好变得可见、有记忆点，但不参与投票统计。

在线体验：<https://guaizzz.github.io/chat-arena/>

## 核心体验

- 9 道匿名聊天回复判断
- A、B、都挺好、都不行四种选择
- 澄光、绒云、异星三种生命基因
- 第 3、6、9 次判断后的成长对话
- 第 9 次判断后的聊灵揭晓
- 六只等价像素伙伴：芽啵、砾尾、苔角、暖灯、卷星、夜墨
- 投票结果、题库版本和本地管理界面

## 本地运行

需要 Node.js 22.13 或更新版本。

```bash
npm ci
npm run demo
```

浏览器打开 `http://127.0.0.1:4173`。macOS 也可以双击 `启动Chat Arena.command`。

本地模式使用进程内 API，默认载入 9 道 Demo Case，并支持题库上传、检查、发布、版本切换和回滚。关闭本地服务后，进程内投票和新题库会重置。

## GitHub Pages 静态模式

GitHub Pages 只能发布静态文件，不能运行 Worker、D1 或 R2。Pages 版本通过与本地 API 相同的前端接口适配器运行：

- 使用仓库内置的 9 道 Demo Case；
- 投票、成长、揭晓和题库版本保存在当前浏览器的 `localStorage`；
- 刷新后可以继续，清除网站数据后会重置；
- 里程碑回答原文不会写入浏览器存储，只保存规则分值、安全短回应与摘要；
- 题库上传只保存在当前浏览器，不会上传原始文件到服务器；
- 不支持多人共享统计、跨设备同步、服务端模型分析、D1 持久化或 R2 文件归档。

静态构建：

```bash
npm run build
```

发布目录为 `dist/client`。所有浏览器资源都使用相对路径，可在 `/chat-arena/` 项目子路径下运行，并包含 `.nojekyll`。

## 验证

```bash
npm run check
npm test
```

GitHub Actions 会在 pull request 中执行检查与构建；合并到 `main` 后，才会把 `dist/client` 发布到 GitHub Pages。

## 目录

- `app.js`、`ui/`：对决、聊灵、结果、静态 API 和题库管理交互
- `shared/`：数据预检、A/B 换位、聊灵成长规则与投票汇总
- `fixtures/`：Pages 和本地 Demo 的 9 道样本
- `scripts/local-api.mjs`：本地 API，并为静态模式提供同构 Demo 状态机
- `worker/`、`db/`、`drizzle/`：保留的 Worker、D1 和迁移参考实现，不参与 GitHub Pages 部署
- `.github/workflows/pages.yml`：测试与 GitHub Pages 发布流程

## 隐私与安全

- 不提交 `.env`、密钥、token 或本机文件；
- 静态站点不调用第三方模型或收费 API；
- 成长对话原文只用于当次浏览器内规则分析；
- 聊灵成长和投票统计彼此隔离。

更完整的产品背景和规则见 [`docs/`](./docs/00-先看这里.md)。
