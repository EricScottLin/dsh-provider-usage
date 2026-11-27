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

## 安装：一条命令

```bash
dsh plugin add "github:EricScottLin/dsh-provider-usage#feat/mistral-amount-display"
```

`dsh plugin` 会装进当前 profile，并自动把 `dsh-provider-usage` 补进
`dsh.profile.bundles`，不用手工改 `package.json`。

装完重启 dsh web 生效。

### 或在 Web 界面装

**Plugins → Add plugin**，在包名输入框里填同样的地址：

```
github:EricScottLin/dsh-provider-usage#feat/mistral-amount-display
```

这个输入框接受包名、Git 地址、tarball 和本地绝对路径，Git 地址这条已验证可用。

### 想锁定版本（推荐）

分支会随更新变动。要固定在验证过的这个版本，用 commit SHA：

```bash
dsh plugin add "github:EricScottLin/dsh-provider-usage#a2b7f5d0134523af2de6b3841ad7c6e37d22d815"
```

---

## 配置 Mistral key

插件按 `MISTRAL_API_KEY` 这个名字解析凭据，两种方式任选：

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

重启后打开 dsh Web，左下角侧边栏应有一个小用量球，点开能看到 provider 列表。
Mistral 那组应显示两行：

```
API · Month        $15 / $15 · 0%
Vibe · Month       $71.43 / $150 · 52%
```

数字随实际用量变化。

- 显示「不支持」→ 装的是官方版，检查 profile 依赖是否指向这份定制版
- 显示「缺少凭据」→ `MISTRAL_API_KEY` 没读到

---

## 更新

```bash
dsh plugin remove dsh-provider-usage
dsh plugin add "github:EricScottLin/dsh-provider-usage#feat/mistral-amount-display"
```

（HMR profile 不允许直接覆盖已安装的包，要先移除。）

---

## 已知限制

- **两个额度都是组织级的**：同一个 Mistral 组织下，任何 key 读到同一对数字。区别只在 key 花哪个额度（console API key 花 `api_budget`，Vibe key 花 `vibe_budget`），所以两行都显示。
- **免费套餐**：没有额度时显示「无生效中的套餐」，而不是 0/0 进度条（后者会被误读为额度耗尽）。
- **金额与百分比同时显示**是本地改进，尚未合入上游。上游作者若采纳，建议改用发布版。
- `lib/` 构建产物直接入库（上游靠 npm publish 时构建），所以这个 fork 能从 Git 直接装，不需要自己 build。

---

## 回滚到官方版

```bash
dsh plugin remove dsh-provider-usage
dsh plugin add dsh-provider-usage
```

装的是 npm 上的官方版本，Mistral 会重新显示为「不支持」。
