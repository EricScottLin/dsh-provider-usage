# dsh-provider-usage（Mistral 定制版）安装说明

版本 `0.3.17-mistral.1`，基于上游 [lizhouai/dsh-provider-usage](https://github.com/lizhouai/dsh-provider-usage) v0.3.17（MIT）。

相比官方版多两样东西：

1. **Mistral 额度查询**（官方版把 Mistral 标为「不支持」）
   - 用普通推理 key 读 `GET /v1/billing/budget` + `/v1/billing/subscription`
   - 显示 API 与 Vibe 两个本月额度、重置日、套餐名
   - 不需要控制台 cookie
2. **货币额度同时显示金额与百分比**
   - 官方版所有配额行只显示百分比
   - 这版对钱计价的额度显示 `$71.43 / $150 · 52%`

---

## 安装方式 A：用打包好的 tgz（最简单，推荐）

拿到 `dsh-provider-usage-0.3.17-mistral.1.tgz` 后：

```bash
dsh plugin add /path/to/dsh-provider-usage-0.3.17-mistral.1.tgz
```

`dsh plugin` 会把包 pnpm 装进 profile，并自动把 `dsh-provider-usage` 补进
`dsh.profile.bundles`，不用手工改 `package.json`。

装完重启 dsh web 生效：

```bash
systemctl restart dsh-web   # 或按你自己的方式重启
```

> 若之前装过官方 npm 版，用 `dsh plugin add` 指向本地 tgz 即可覆盖；
> pnpm 对同版本的 `file:` 依赖会直接换成本地包。

## 安装方式 B：从 git 分支装

分支 `feat/mistral-amount-display` 在 <https://github.com/EricScottLin/dsh-provider-usage>，
包含全部改动（Mistral 适配器 + 金额显示）。

这个仓库的 `lib/` 不进 git，所以要自己构建：

```bash
git clone https://github.com/EricScottLin/dsh-provider-usage.git
cd dsh-provider-usage
git checkout feat/mistral-amount-display
pnpm install && pnpm build
```

然后在 profile 里 link 这个目录：

```bash
cd ~/.dsh/profiles/web
pnpm add "link:/path/to/dsh-provider-usage"
```

（或直接改 `package.json` 的 `dependencies` 为 `"dsh-provider-usage": "link:/path/to/dsh-provider-usage"`，
并确认 `dsh.profile.bundles` 数组里有 `"dsh-provider-usage"`。）

之后想跟进更新，`git pull` 后重新 `pnpm build` 再重启即可。

> 若不想自己构建，用方式 A 的 tgz。

---

## 配置 Mistral key

插件会按 `MISTRAL_API_KEY` 这个名字解析凭据，两种方式任选：

**方式一：环境变量**

```bash
export MISTRAL_API_KEY="你的 key"
```

**方式二：`~/.dsh/.credentials.yaml`**（推荐，不会漏进 shell 历史）

```yaml
MISTRAL_API_KEY: 你的key
```

key 在 <https://console.mistral.ai/api-keys> 创建，普通 API key 就行，不需要 admin 权限。

---

## 装完怎么确认

1. 重启后打开 dsh Web，左下角侧边栏应有一个小用量球，点开能看到 provider 列表
2. Mistral 那组应显示两行：

```
API · Month        $15 / $15 · 0%
Vibe · Month       $71.43 / $150 · 52%
```

数字随你实际用量变化。如果显示「不支持」，说明加载的还是官方版，检查 profile 的依赖是否指向了这份定制版。

如果显示「缺少凭据」，说明 `MISTRAL_API_KEY` 没读到。

---

## 已知限制

- **两个额度都是组织级的**：同一个 Mistral 组织下，任何 key 读到同一对数字。区别只在 key 花哪个额度（console API key 花 `api_budget`，Vibe key 花 `vibe_budget`），所以两行都显示。
- **免费套餐**：没有额度时可能显示「无生效中的套餐」，而不是 0/0 进度条（后者会被误读为额度耗尽）。
- **金额与百分比同时显示**是本地改进，尚未合入上游。上游作者若采纳，建议改用发布版。

---

## 回滚

把 profile 里的 `dsh-provider-usage` 改回官方版：

```json
"dsh-provider-usage": "^0.3.17"
```

`pnpm install` 后重启即可。或直接删掉这一行和 `bundles` 里的对应项。
