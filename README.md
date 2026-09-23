# dsh-jev-decide

[![npm version](https://img.shields.io/npm/v/dsh-jev-decide.svg)](https://www.npmjs.com/package/dsh-jev-decide)
[![license](https://img.shields.io/npm/l/dsh-jev-decide.svg)](./LICENSE)
[![DSH 插件市场](https://img.shields.io/badge/DSH-插件市场-blue)](https://awesome-dsh-plugin.com/)

把 [TypeSafe Jev](https://docs.typesafe.ai/)（"System One" 决策模型）接入 DSH：注册一个 agent 工具 **`jev_decide`**，让 agent 在需要"快而准的判断"时调用 Jev，而不是让对话模型凭感觉猜。

## 为什么不是"再加一个对话模型"

Jev 不生成文本。它对输入 `state` 回答类型化问题并返回**校准过的概率**：

| type | 问法 | 返回 |
| --- | --- | --- |
| `noul` | 是/否问题 | `answer` = 是的概率 0..1 |
| `choice` | 从选项里挑一个（需 `options` ≥2） | `answer` = 选中项 + `probabilities` 全分布 + `confidence` |
| `score` | 按有序等级打分（需 `levels` ≥2） | `answer` = 概率加权分值 + 分布 + `confidence` |

适合：消息紧急度分级、意图路由、guardrail 检查、二选一决策、按 rubric 打分。不适合：写代码、写文案、任何需要生成文本的活。

## 工具签名

```
jev_decide({
  state: string,            // 必填，要评估的内容（纯文本）
  question: string,         // 必填，要做的判断
  type?: 'noul' | 'choice' | 'score',   // 默认 noul
  options?: string[],       // type=choice 时必填（≥2）
  levels?: string[],        // type=score 时必填（≥2，从低到高）
  model?: string,           // 默认 jev-latest（当前 jev-1.13.0）
}) → { model, type, answer, confidence?, probabilities?, usage }
```

## 凭证解析顺序

1. 插件配置的 `apiKey`（cordis patch config 或数据目录 config.json）
2. 环境变量 `TYPESAFE_API_KEY`
3. `~/.dsh/.credentials.yaml` 的 `refs.TYPESAFE_AI_API_KEY`（与 DSH 凭证缝同源——本机已配置，无需重复）

## 配置

数据目录 `$DSH_HOME/plugins/dsh-jev-decide/config.json`（或 cordis patch 的 `config:`）：

```json
{ "model": "jev-latest", "timeoutMs": 15000, "baseUrl": "https://api.typesafe.ai/v1" }
```

## 安装 / 接线

**方式一：npm（已上架，[包页](https://www.npmjs.com/package/dsh-jev-decide)）**：

```sh
dsh plugin --profile web add dsh-jev-decide
# 或纯 npm 侧安装（npm ≥7 / pnpm auto-install-peers 会自动装 @deepseek-ai/dsh-tools peer）
npm install dsh-jev-decide
```

v0.1.2 起包内自带 `dsh.bundle`（根目录 `cordis.patch.yml`）：`dsh plugin add` 会自动把插件装配进 profile，无需手写任何接线；纯 `npm install` 仍只装包不装配。

> **v0.1.1 手动接线用户升级注意**：已按方式三手写 insert 的 profile，不要再对它跑 `dsh plugin add`——两处注册同一 id 会报 `duplicate loader entry id`，整份 profile 无法启动；先注释/删除手动条目，再交给 bundle 自动装配。

> peer 解析注意：宿主**不会**把捆绑的 `@deepseek-ai/dsh-tools` 注入插件的模块解析链。经 npm/pnpm 安装时 peer 会被自动物化；若以 `link:`/本地路径方式接入插件源码目录，需在插件目录内先跑一次 `npm install` 把 peer 物化（`>=0.1.0-rc.6` 的 semver 预发布匹配只会选到 0.1.0-rc.x 元组，属预期——插件只消费 `defineTool` 一个纯函数，跨宿主版本已实测兼容）。

发版即自动发布：`git tag vX.Y.Z && git push --tags` → GitHub Actions 以 OIDC 免 token 发布（带 [provenance 签名](https://search.sigstore.dev/?logIndex=2890905882)），无需任何长期 npm 凭据。

**方式二：插件市场**（收录 PR [#5428](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5428) 合并后自动出现在 `awesome-dsh-plugin.com` 与 DSH 内置市场）。

**方式三：手动接线**：

1. 源码：`~/dsh/plugins/dsh-jev-decide/`
2. `~/.dsh/profiles/web/package.json` 依赖：`"dsh-jev-decide": "link:~/dsh/plugins/dsh-jev-decide"`
3. `~/.dsh/profiles/web/cordis.patch.yml` 加一条 insert（内容同仓库根目录 `cordis.patch.yml`）：`- insert: [- id: dsh-jev-decide, name: dsh-jev-decide]`
4. 因无 shell 无法建 pnpm symlink，`profiles/web/node_modules/dsh-jev-decide/` 放的是实体副本；下次 `pnpm install` 会把它规范成 link，无副作用。
5. **生效需重启 DSH**（host 插件在进程启动时装配）。

## 生态扫描：同类项目（2026-09-19）

Jev 发布三天内 GitHub 上已出现多个 DSH 接入实现，各有侧重：

| 项目 | 特点 |
| --- | --- |
| [noetion/dsh-jev](https://github.com/noetion/dsh-jev) | `jev_ask` 工具，**一次 state 可混搭多问题**；bundle + 内置 skill；配套 mock 传输测试，工程最完整 |
| [kaijia323/dsh-plugin-jev](https://github.com/kaijia323/dsh-plugin-jev) | 同名 `jev_decide`；**双传输**（官方 API + Vercel AI Gateway）；指数退避重试、state/问题数上限守卫、置信度阈值路由示例 |
| [buberlo/dsh-jev](https://github.com/buberlo/dsh-jev) | 决策层封装 |
| [zhangxaochen/dsh-jev](https://github.com/zhangxaochen/dsh-jev) | 插件套件 |

本插件的差异点：

- **单文件、零构建**（纯 ESM JS），copy 即用，没有 TypeScript 工具链依赖
- **凭证零配置**：直接复用 DSH 凭证缝（`~/.dsh/.credentials.yaml` 的 `TYPESAFE_AI_API_KEY`），不要求 env 也不在 patch 里落明文
- 内建 429/529 官方建议的短退避重试
- 只做一件事：把 `jev_decide` 注册进工具集；多问题、双网关等进阶需求请用上面的项目

## 定价参考

Jev 1.13：$0.042/百万输入 token，输出免费；官方限流 250k tok/s、1200 req/min（[模型页](https://docs.typesafe.ai/models)）。
