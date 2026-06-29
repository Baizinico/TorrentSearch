# Contributing to TorrentSearch Web

感谢你愿意为 TorrentSearch Web 贡献力量！❤️

欢迎以下任意形式的贡献：

- ⭐ Star 项目
- 🐛 报告 Bug / 提交 Issue
- 💡 提议新功能或改进
- 🔧 提交 Pull Request（修复 bug / 新增 provider / 优化 UI / 完善文档）

## 设置开发环境

### 前置要求

- **Node.js 20+**：推荐使用 LTS 版本
- **npm 10+**：随 Node 安装
- **Git**
- （可选）**Docker**：用于验证容器化部署

### 步骤

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/<your-username>/TorrentSearch.git
cd TorrentSearch
git checkout web-version

# 2. 进入 webapp 目录安装依赖
cd webapp
npm install

# 3. 启动开发服务器（前后端并发）
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- Vite 自动代理 `/api` 到后端，HMR 已开启

### 验证构建

提交前请确保以下命令均通过：

```bash
# TypeScript 类型检查
npx tsc --noEmit -p web/tsconfig.json
npx tsc --noEmit -p server/tsconfig.json

# 生产构建
npm run build

# 启动生产模式验证（应能单端口访问 http://localhost:3000）
npm start
```

## 项目约定

### 代码风格

- TypeScript 严格模式
- 使用 Prettier（配置见 `webapp/.prettierrc`）
- 函数 / 变量命名：camelCase
- 类型 / 接口命名：PascalCase
- 常量：UPPER_SNAKE_CASE

### Provider 实现

新增内置 provider 时，请参考 `webapp/server/src/providers/` 中的现有实现，需要：

1. 继承 `SearchProvider` 基类（或同时实现 `TorrentDetailsProvider` / `LatestTorrentsProvider` / `TopTorrentsProvider`）
2. 在 `registry.ts` 中注册
3. 在 `webapp/web/src/types.ts` 的类别列表中确认类别映射
4. 如受 Cloudflare 保护，在 provider 元数据中标记 `cloudflareProtected: true`，并提供 FlareSolverr 适配路径

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <subject>

feat(search): add new provider for X
fix(ui): resolve filter sheet animation glitch
docs(readme): update deployment guide
refactor(gateway): simplify async generator
```

常见 type：`feat` / `fix` / `docs` / `refactor` / `chore` / `style` / `test`

### 分支命名

- 功能分支：`feat/<short-desc>`
- 修复分支：`fix/<short-desc>`
- 请基于 `web-version` 分支创建，不要直接基于 `main`

## 提交 Pull Request

1. 确保本地构建与类型检查通过
2. 确保提交信息遵循 Conventional Commits
3. 在 PR 描述中说明：
   - 改动内容与动机
   - 是否涉及破坏性变更
   - 关联的 Issue 编号（如有）
4. 等待 review，欢迎对反馈进行讨论

## 行为准则

请保持友善、尊重所有贡献者。任何形式的骚扰或人身攻击都将被拒绝。
