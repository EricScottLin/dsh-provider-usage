window.__ModuleLoader__.load({
	id: "dsh-provider-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"action.label": "用量",
			"action.aria": "Provider 用量",
			"panel.title": "Provider 用量",
			"panel.resize": "拖拽调整面板高度",
			"panel.refresh": "立即刷新",
			"panel.refreshing": "刷新中…",
			"lang.switch": "Switch to English",
			"panel.resetPos": "悬浮球归位",
			"panel.interval": "刷新周期",
			"panel.thresholds": "余额阈值",
			"panel.thresholdRed": "红",
			"panel.thresholdYellow": "黄",
			"panel.updated": "更新于 {time}",
			"panel.never": "尚未获取",
			"panel.empty": "未检测到已配置的 Provider",
			"interval.15s": "15 秒",
			"interval.30s": "30 秒",
			"interval.60s": "1 分钟",
			"interval.300s": "5 分钟",
			"interval.900s": "15 分钟",
			"interval.1800s": "30 分钟",
			"balance.total": "总额",
			"balance.granted": "赠送 {amount}",
			"balance.toppedUp": "充值 {amount}",
			"usage.weekly": "每周配额",
			"usage.used": "已用 {used}",
			"usage.remaining": "剩余 {remaining}",
			"usage.unlimited": "不限量",
			"usage.resetAt": "重置于 {time}",
			"usage.resetIn": "{countdown} 后重置",
			"status.unsupported": "该 Provider 暂不支持额度查询",
			"status.missingCredential": "未配置密钥（{ref}）",
			"status.missingAuthorization": "未完成 OAuth 授权（{key}）",
			"status.reauthRequired": "OAuth 授权已失效，需重新登录",
			"status.noSubscription": "无生效中的套餐（已到期或未开通）",
			"status.noUsageData": "未获取到额度数据",
			"status.error": "查询失败",
			"status.inUse": "使用中",
			"status.tone.ok": "当前 Provider 正常",
			"status.tone.warn": "当前 Provider 用量接近上限或余额偏低",
			"status.tone.danger": "当前 Provider 异常、用量将尽或余额过低",
			"countdown.days": "{days}天{hours}小时",
			"countdown.hours": "{hours}小时{minutes}分",
			"countdown.minutes": "{minutes}分钟"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"action.label": "Usage",
			"action.aria": "Provider usage",
			"panel.title": "Provider Usage",
			"panel.resize": "Drag to resize panel",
			"panel.refresh": "Refresh now",
			"panel.refreshing": "Refreshing…",
			"lang.switch": "切换到中文",
			"panel.resetPos": "Reset ball position",
			"panel.interval": "Refresh interval",
			"panel.thresholds": "Balance thresholds",
			"panel.thresholdRed": "Red",
			"panel.thresholdYellow": "Yellow",
			"panel.updated": "Updated {time}",
			"panel.never": "Not fetched yet",
			"panel.empty": "No configured provider detected",
			"interval.15s": "15s",
			"interval.30s": "30s",
			"interval.60s": "1 min",
			"interval.300s": "5 min",
			"interval.900s": "15 min",
			"interval.1800s": "30 min",
			"balance.total": "Total",
			"balance.granted": "granted {amount}",
			"balance.toppedUp": "topped up {amount}",
			"usage.weekly": "Weekly quota",
			"usage.used": "used {used}",
			"usage.remaining": "{remaining} left",
			"usage.unlimited": "Unlimited",
			"usage.resetAt": "Resets at {time}",
			"usage.resetIn": "Resets in {countdown}",
			"status.unsupported": "Usage query is not supported for this provider",
			"status.missingCredential": "No API key configured ({ref})",
			"status.missingAuthorization": "OAuth authorization missing ({key})",
			"status.reauthRequired": "OAuth authorization expired — sign in again",
			"status.noSubscription": "No active plan (expired or not subscribed)",
			"status.noUsageData": "No usage data reported",
			"status.error": "Query failed",
			"status.inUse": "In use",
			"status.tone.ok": "Current provider healthy",
			"status.tone.warn": "Current provider usage nearing its limit or balance running low",
			"status.tone.danger": "Current provider error, usage almost exhausted, or balance too low",
			"countdown.days": "{days}d {hours}h",
			"countdown.hours": "{hours}h {minutes}m",
			"countdown.minutes": "{minutes}m"
		};
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* Floating-ball quota widget: a draggable ball portaled to document.body
		* (the sidebar slot only mounts the component; the button itself no longer
		* lives in the sidebar, avoiding slot layout contention with other plugins).
		* The popover panel lists every configured provider's live balance/quota.
		* Polling interval is user-selectable (persisted in localStorage) and falls
		* back to the deployment-suggested value from the host plugin config.
		*/
		const INTERVAL_OPTIONS = [
			15,
			30,
			60,
			300,
			900,
			1800
		];
		const STORAGE_KEY = "dsh.provider-usage.refreshSeconds";
		const LANG_KEY = "dsh.provider-usage.lang";
		const POS_KEY = "dsh.provider-usage.floatPos";
		const THRESHOLD_RED_KEY = "dsh.provider-usage.balanceRedThreshold";
		const THRESHOLD_YELLOW_KEY = "dsh.provider-usage.balanceYellowThreshold";
		const PANEL_HEIGHT_KEY = "dsh.provider-usage.panelHeight";
		const DEFAULT_INTERVAL = 60;
		/** Balance thresholds fall back to these hardcoded defaults when neither the
		host config nor a stored override provides them. */
		const DEFAULT_BALANCE_RED = 10;
		const DEFAULT_BALANCE_YELLOW = 30;
		/** Smallest panel height the top-edge drag allows (px). */
		const PANEL_MIN_H = 120;
		/** Largest panel height the top-edge drag allows: the viewport minus a
		breathing margin, so the panel can never outgrow the screen. */
		function panelMaxHeight() {
			return Math.max(PANEL_MIN_H, window.innerHeight - 24);
		}
		/** Bottom padding of the open panel (px), read live so the layout math stays
		correct if the stylesheet ever changes it. */
		function panelPaddingBottom(panel) {
			const pad = Number.parseFloat(getComputedStyle(panel).paddingBottom);
			return Number.isFinite(pad) ? pad : 0;
		}
		/**
		* Natural content height of the open panel — children plus padding — even
		* while the panel itself is height-constrained or scrolled (children rects
		* are compensated by scrollTop). This is the grow limit: at this height the
		* panel needs no scrolling and leaves no blank strip at the bottom.
		*/
		function panelContentHeight(panel) {
			const panelTop = panel.getBoundingClientRect().top;
			let bottom = 0;
			for (const child of Array.from(panel.children)) {
				const rect = child.getBoundingClientRect();
				bottom = Math.max(bottom, rect.bottom - panelTop + panel.scrollTop);
			}
			return Math.ceil(bottom) + panelPaddingBottom(panel);
		}
		/**
		* Shrink limit: the height that keeps the panel head plus the FIRST provider
		* card fully visible (bottom padding included). Falls back to PANEL_MIN_H
		* when no provider card is present (e.g. empty list).
		*/
		function firstCardMinHeight(panel) {
			const card = panel.querySelector(".dsh-usage-card");
			if (card === null) return PANEL_MIN_H;
			const panelTop = panel.getBoundingClientRect().top;
			const cardRect = card.getBoundingClientRect();
			return Math.ceil(cardRect.bottom - panelTop + panel.scrollTop) + panelPaddingBottom(panel);
		}
		/** Floating ball diameter in px; drag math derives from it. */
		const BALL_SIZE = 32;
		/** Panel-level override stored in localStorage; null means follow the harness language. */
		function readStoredLang() {
			try {
				const raw = localStorage.getItem(LANG_KEY);
				return raw === "zh" || raw === "en" ? raw : null;
			} catch {
				return null;
			}
		}
		function storeLang(lang) {
			try {
				localStorage.setItem(LANG_KEY, lang);
			} catch {}
		}
		/** Local translator over the bundled dictionaries, mirroring the shell's `{param}` interpolation. */
		function makeT(dict) {
			return (key, params) => {
				const template = dict[key] ?? key;
				if (params === void 0) return template;
				return template.replace(/\{(\w+)\}/g, (raw, name) => name in params ? String(params[name]) : raw);
			};
		}
		function readStoredInterval() {
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw === null) return null;
				const value = Number(raw);
				return Number.isFinite(value) && value >= 5 ? value : null;
			} catch {
				return null;
			}
		}
		function storeInterval(value) {
			try {
				localStorage.setItem(STORAGE_KEY, String(value));
			} catch {}
		}
		/** Parse a threshold input: a finite number ≥ 0, or null while the field is
		empty/transiently invalid (the string is kept in state so typing never
		fights the controlled input). */
		function parseThreshold(raw) {
			const trimmed = raw.trim();
			if (trimmed === "") return null;
			const value = Number(trimmed);
			return Number.isFinite(value) && value >= 0 ? value : null;
		}
		function readStoredThreshold(key) {
			try {
				const raw = localStorage.getItem(key);
				return raw !== null && parseThreshold(raw) !== null ? raw : null;
			} catch {
				return null;
			}
		}
		function storeThreshold(key, value) {
			try {
				localStorage.setItem(key, value);
			} catch {}
		}
		function readStoredPanelHeight() {
			try {
				const raw = localStorage.getItem(PANEL_HEIGHT_KEY);
				if (raw === null) return null;
				const value = Number(raw);
				return Number.isFinite(value) && value >= PANEL_MIN_H ? value : null;
			} catch {
				return null;
			}
		}
		function storePanelHeight(value) {
			try {
				localStorage.setItem(PANEL_HEIGHT_KEY, String(value));
			} catch {}
		}
		/** Equal margin from the chat area's left edge and the window's bottom edge. */
		const DOCK_MARGIN = 24;
		/**
		* Default dock: bottom-left of the main chat area with equal margins on both
		* axes. Returned as viewport fractions of the ball CENTER, like every other
		* position. The chat area's left edge is the sidebar's right edge, derived
		* from the full-height ancestor of the settings slot (stable data-slot hook;
		* class names are build-hashed), so it adapts to sidebar collapse.
		*/
		function defaultFloatPos() {
			let sidebarRight = 264;
			let node = document.querySelector("[data-slot=\"sidebar.settings\"]")?.parentElement ?? null;
			while (node) {
				const rect = node.getBoundingClientRect();
				if (rect.x <= 1 && rect.height >= window.innerHeight * .9) {
					sidebarRight = rect.right;
					break;
				}
				node = node.parentElement;
			}
			return {
				fx: (sidebarRight + DOCK_MARGIN + BALL_SIZE / 2) / window.innerWidth,
				fy: (window.innerHeight - DOCK_MARGIN - BALL_SIZE / 2) / window.innerHeight
			};
		}
		function readStoredFloatPos() {
			try {
				const raw = localStorage.getItem(POS_KEY);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed.fx !== "number" || !Number.isFinite(parsed.fx)) return null;
				if (typeof parsed.fy !== "number" || !Number.isFinite(parsed.fy)) return null;
				return {
					fx: Math.min(1, Math.max(0, parsed.fx)),
					fy: Math.min(1, Math.max(0, parsed.fy))
				};
			} catch {
				return null;
			}
		}
		function storeFloatPos(pos) {
			try {
				localStorage.setItem(POS_KEY, JSON.stringify(pos));
			} catch {}
		}
		/** 归位: forget the pinned spot; the ball follows the default dock again. */
		function clearStoredFloatPos() {
			try {
				localStorage.removeItem(POS_KEY);
			} catch {}
		}
		function formatCountdown(resetAt, now, t) {
			const diff = new Date(resetAt).getTime() - now;
			if (!Number.isFinite(diff) || diff <= 0) return null;
			const minutes = Math.floor(diff / 6e4);
			if (minutes >= 1440) return t("countdown.days", {
				days: Math.floor(minutes / 1440),
				hours: Math.floor(minutes % 1440 / 60)
			});
			if (minutes >= 60) return t("countdown.hours", {
				hours: Math.floor(minutes / 60),
				minutes: minutes % 60
			});
			return t("countdown.minutes", { minutes: Math.max(1, minutes) });
		}
		function barTone(percent) {
			if (percent === null) return "ok";
			if (percent >= 90) return "danger";
			if (percent >= 70) return "warn";
			return "ok";
		}
		/** Parse a balance amount string ("12.34", "0.00") into a number. */
		function toAmount(value) {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : null;
		}
		/**
		* Tone for a monetary balance, compared in the balance's own currency:
		* below the red threshold → danger, below the yellow threshold → warn,
		* otherwise ok. The effective red threshold never exceeds the yellow one,
		* so the zones stay ordered no matter how the panel is configured.
		*/
		function balanceTone(value, red, yellow) {
			if (value === null) return "ok";
			if (value < Math.min(red, yellow)) return "danger";
			if (value < yellow) return "warn";
			return "ok";
		}
		const TONE_SEVERITY = {
			ok: 0,
			warn: 1,
			danger: 2
		};
		/** More severe of two tones; used WITHIN one category. */
		function worseTone(a, b) {
			if (a === null) return b;
			if (b === null) return a;
			return TONE_SEVERITY[a] >= TONE_SEVERITY[b] ? a : b;
		}
		/**
		* Aggregate tone for one provider. The subscription/usage windows ("plan")
		* and the prepaid balance/credits are two INDEPENDENT categories joined with
		* OR semantics: the provider stays green while either category has enough
		* left (the plan is normally consumed before credits, so the surviving
		* resource sets the tone), and when both are running low the lighter warning
		* wins. Within one category the worst row still governs — an exhausted 5h
		* window is not "enough plan" just because the weekly window is healthy.
		*/
		function providerTone(provider, red, yellow) {
			let planTone = null;
			let creditTone = null;
			if (provider.kind === "balance") for (const row of provider.balances ?? []) creditTone = worseTone(creditTone, balanceTone(toAmount(row.total), red, yellow));
			for (const row of provider.usages ?? []) if (row.label === "credits") creditTone = worseTone(creditTone, balanceTone(row.remaining, red, yellow));
			else planTone = worseTone(planTone, barTone(row.percent));
			if (planTone === null) return creditTone ?? "ok";
			if (creditTone === null) return planTone;
			return TONE_SEVERITY[planTone] <= TONE_SEVERITY[creditTone] ? planTone : creditTone;
		}
		/** Worst health across the fetch + the provider IN USE: drives the trigger's
		status dot. Only the active provider (the composer's current selection)
		colors the ball, so an idle low-quota provider does not alarm; when the
		host reports no active provider, fall back to every provider. */
		function healthTone(data, error, red, yellow) {
			if (error !== null) return "danger";
			const providers = data?.providers ?? [];
			const active = providers.filter((provider) => provider.active);
			const relevant = active.length > 0 ? active : providers;
			let tone = "ok";
			for (const provider of relevant) {
				if (provider.status === "error" || provider.status === "missing-credential" || provider.status === "missing-authorization" || provider.status === "reauth-required" || provider.status === "no-subscription") return "danger";
				const providerToneValue = providerTone(provider, red, yellow);
				if (providerToneValue === "danger") return "danger";
				if (providerToneValue === "warn") tone = "warn";
			}
			return tone;
		}
		function formatAmount(value) {
			if (value === null) return "—";
			return Number.isInteger(value) ? String(value) : value.toFixed(2);
		}
		/** Symbols for the currencies providers report; anything else falls back to
		the ISO code so an unknown currency still reads as money. */
		const CURRENCY_SYMBOLS = {
			USD: "$",
			EUR: "€",
			CNY: "¥",
			JPY: "¥",
			GBP: "£"
		};
		/** Money for a currency-bearing usage row: `$140.78`. */
		function formatMoney(value, currency) {
			if (value === null) return "—";
			const amount = formatAmount(value);
			if (currency === null) return amount;
			const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()];
			return symbol === void 0 ? `${amount} ${currency.toUpperCase()}` : `${symbol}${amount}`;
		}
		/** Whether a row's window is denominated in money rather than a count. */
		function isMoneyRow(row) {
			return typeof row.currency === "string" && row.currency !== "";
		}
		/**
		* What a usage row shows at the right of its label.
		*
		* A money window reads as `$140.78 / $150 · 6%` — the remaining amount, the
		* allowance, and how much of it is spent. The amount answers the question the
		* panel exists for ("will I run out?"); the percentage keeps the at-a-glance
		* rhythm the count windows have, so one glance reads the same way across
		* providers. Count windows keep the percentage alone, which is what their
		* limit means anyway.
		*/
		function rowValueText(row, t) {
			const currency = row.currency ?? null;
			if (row.label === "credits" && row.remaining !== null) return formatAmount(row.remaining);
			if (isMoneyRow(row) && row.remaining !== null) {
				const left = formatMoney(row.remaining, currency);
				const head = row.limit === null ? left : `${left} / ${formatMoney(row.limit, currency)}`;
				return row.percent === null ? head : `${head} · ${Math.round(row.percent)}%`;
			}
			if (row.limit === null) {
				if (row.used !== null) return t("usage.used", { used: formatAmount(row.used) });
				if (row.remaining !== null) return formatAmount(row.remaining);
				return t("usage.unlimited");
			}
			if (row.percent !== null) return `${Math.round(row.percent)}%`;
			return t("usage.used", { used: formatAmount(row.used) });
		}
		/**
		* Refine the host's `active` flags with the provider of the FOCUSED session
		* (the composer's own state), so a session switch re-highlights instantly
		* even though the host only tracks the last explicit selection. Returns the
		* same object when nothing changes; `undefined` provider leaves the host's
		* flags untouched.
		*/
		function applyActiveProvider(data, provider) {
			if (provider === void 0 || !Array.isArray(data.providers)) return data;
			let changed = false;
			const providers = data.providers.map((entry) => {
				const active = entry.id === provider;
				if (active === entry.active) return entry;
				changed = true;
				return {
					...entry,
					active
				};
			});
			return changed ? {
				...data,
				providers
			} : data;
		}
		function UsageRows({ provider, now, red, yellow, t }) {
			const rows = provider.usages ?? [];
			if (rows.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: rows.map((row, index) => {
				const percent = row.percent;
				const isCredits = row.label === "credits";
				const isMoney = isMoneyRow(row);
				const tone = isCredits || isMoney ? balanceTone(row.remaining, red, yellow) : barTone(row.percent);
				const reset = row.resetAt !== null ? formatCountdown(row.resetAt, now, t) : null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-usage-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-usage-rowHead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-usage-rowLabel",
								children: row.label === "weekly" ? t("usage.weekly") : row.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `dsh-usage-rowValue${tone === "ok" ? "" : ` dsh-usage-rowValue--${tone}`}`,
								children: rowValueText(row, t)
							})]
						}),
						percent !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-usage-barTrack",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: `dsh-usage-barFill dsh-usage-barFill--${tone}`,
								style: { width: `${Math.min(100, Math.max(0, percent))}%` }
							})
						}) : null,
						reset !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-usage-rowReset",
							children: t("usage.resetIn", { countdown: reset })
						}) : null
					]
				}, `${row.label}-${index}`);
			}) });
		}
		function ProviderCard({ provider, now, red, yellow, t }) {
			const balances = provider.balances ?? [];
			const usages = provider.usages ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `dsh-usage-card${provider.active ? " dsh-usage-card--active" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-usage-cardHead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-usage-providerName",
						children: provider.displayName
					}), provider.active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-usage-inUse",
						children: t("status.inUse")
					}) : null]
				}), provider.status === "unsupported" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					children: t("status.unsupported")
				}) : provider.status === "missing-credential" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					children: t("status.missingCredential", { ref: provider.message })
				}) : provider.status === "missing-authorization" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					children: t("status.missingAuthorization", { key: provider.message })
				}) : provider.status === "reauth-required" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					title: provider.message ?? void 0,
					children: t("status.reauthRequired")
				}) : provider.status === "no-subscription" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					children: t("status.noSubscription")
				}) : provider.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-usage-message",
					children: [
						t("status.error"),
						": ",
						provider.message
					]
				}) : provider.kind === "balance" ? balances.length > 0 ? balances.map((row, index) => {
					const tone = balanceTone(toAmount(row.total), red, yellow);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-usage-balanceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dsh-usage-balanceTotal${tone === "ok" ? "" : ` dsh-usage-balanceTotal--${tone}`}`,
							children: row.total
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-usage-balanceCurrency",
							children: row.currency
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-usage-balanceParts",
						children: [row.granted !== "0" && row.granted !== "0.00" ? t("balance.granted", { amount: row.granted }) : null, row.toppedUp !== "0" && row.toppedUp !== "0.00" ? t("balance.toppedUp", { amount: row.toppedUp }) : null].filter(Boolean).join(" · ")
					})] }, `${row.currency}-${index}`);
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					children: t("status.noUsageData")
				}) : usages.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageRows, {
					provider,
					now,
					red,
					yellow,
					t
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-usage-message",
					children: t("status.noUsageData")
				})]
			});
		}
		/** Battery level: remaining charge reads as remaining quota. */
		function BatteryIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						width: "16",
						height: "10",
						x: "2",
						y: "7",
						rx: "2",
						ry: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M22 11v2" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 11v2" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10 11v2" })
				]
			});
		}
		function RefreshIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 12a8 8 0 1 1-2.34-5.66" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 4v4h-4" })]
			});
		}
		function GlobeIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "9"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 12h18" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z" })
				]
			});
		}
		/** Crosshair for the "reset ball to its default spot" head button. */
		function HomeIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "7"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "1.5",
						fill: "currentColor",
						stroke: "none"
					})
				]
			});
		}
		function UsageAction({ t, fetchUsage, getActiveProvider, subscribeActiveChange }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [data, setData] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [intervalSec, setIntervalSec] = (0, react.useState)(() => readStoredInterval() ?? DEFAULT_INTERVAL);
			const [langOverride, setLangOverride] = (0, react.useState)(() => readStoredLang());
			/** Balance thresholds as raw input strings (kept as text so typing never
			fights the controlled input); parsed on use, overridden locally only
			after the user edits them. */
			const [redThreshold, setRedThreshold] = (0, react.useState)(() => readStoredThreshold(THRESHOLD_RED_KEY) ?? String(DEFAULT_BALANCE_RED));
			const [yellowThreshold, setYellowThreshold] = (0, react.useState)(() => readStoredThreshold(THRESHOLD_YELLOW_KEY) ?? String(DEFAULT_BALANCE_YELLOW));
			const [now, setNow] = (0, react.useState)(() => Date.now());
			/** Pinned spot (user-dragged) as viewport fractions; null = follow the default dock. */
			const [pinnedPos, setPinnedPos] = (0, react.useState)(() => readStoredFloatPos());
			/** Viewport size drives the fraction → px conversion and the default dock. */
			const [viewport, setViewport] = (0, react.useState)({
				w: window.innerWidth,
				h: window.innerHeight
			});
			/** Transient ball position while dragging (cursor-centered); null when docked. */
			const [dragPos, setDragPos] = (0, react.useState)(null);
			/** User-resized panel height in px; null = auto-size to content (max-height
			+ scroll). Persisted, like every other panel preference. */
			const [panelHeight, setPanelHeight] = (0, react.useState)(() => readStoredPanelHeight());
			const harnessLang = t("lang.switch") === zh["lang.switch"] ? "zh" : t("lang.switch") === en["lang.switch"] ? "en" : null;
			const lang = langOverride ?? harnessLang ?? "en";
			const tt = (0, react.useMemo)(() => makeT(lang === "zh" ? zh : en), [lang]);
			const toggleLang = (0, react.useCallback)(() => {
				setLangOverride((current) => {
					const next = (current ?? harnessLang ?? "en") === "zh" ? "en" : "zh";
					storeLang(next);
					return next;
				});
			}, [harnessLang]);
			/** Panel-head home button: unpin the ball so it follows the default dock. */
			const resetFloatPos = () => {
				clearStoredFloatPos();
				setPinnedPos(null);
			};
			const [panelPos, setPanelPos] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const ballRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const inFlight = (0, react.useRef)(false);
			/** Active ball-drag session; cleared on pointerup/pointercancel. */
			const dragRef = (0, react.useRef)(null);
			/** Set when a drag ends so the trailing click does not toggle the panel. */
			const suppressClickRef = (0, react.useRef)(false);
			/** Active panel-height drag; cleared on pointerup/pointercancel. */
			const resizeRef = (0, react.useRef)(null);
			/** Resize bounds snapshotted at drag start from the live layout: min = first
			provider card fully visible, max = content height (no scroll, no blank). */
			const resizeLimitsRef = (0, react.useRef)(null);
			const refresh = (0, react.useCallback)(async () => {
				if (inFlight.current) return;
				inFlight.current = true;
				setLoading(true);
				try {
					const result = await fetchUsage();
					setData(applyActiveProvider(result, getActiveProvider?.()));
					setError(null);
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : String(reason));
				} finally {
					inFlight.current = false;
					setLoading(false);
				}
			}, [fetchUsage, getActiveProvider]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			(0, react.useEffect)(() => {
				const timer = setInterval(() => {
					if (document.visibilityState === "visible") refresh();
				}, intervalSec * 1e3);
				return () => clearInterval(timer);
			}, [intervalSec, refresh]);
			(0, react.useEffect)(() => {
				if (data !== null && readStoredInterval() === null && data.refreshSeconds !== intervalSec) setIntervalSec(data.refreshSeconds);
			}, [data]);
			(0, react.useEffect)(() => {
				if (data === null) return;
				if (readStoredThreshold(THRESHOLD_RED_KEY) === null && typeof data.balanceRedThreshold === "number") setRedThreshold(String(data.balanceRedThreshold));
				if (readStoredThreshold(THRESHOLD_YELLOW_KEY) === null && typeof data.balanceYellowThreshold === "number") setYellowThreshold(String(data.balanceYellowThreshold));
			}, [data]);
			(0, react.useEffect)(() => {
				return subscribeActiveChange?.(() => {
					setData((prev) => prev === null ? prev : applyActiveProvider(prev, getActiveProvider?.()));
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				setNow(Date.now());
				const timer = setInterval(() => setNow(Date.now()), 3e4);
				return () => clearInterval(timer);
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (!(event.target instanceof Node)) return;
					if (rootRef.current?.contains(event.target)) return;
					if (ballRef.current?.contains(event.target)) return;
					if (panelRef.current?.contains(event.target)) return;
					setOpen(false);
				};
				document.addEventListener("pointerdown", closeOutside);
				return () => document.removeEventListener("pointerdown", closeOutside);
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const update = () => {
					const rect = ballRef.current?.getBoundingClientRect();
					if (!rect) return;
					const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 336));
					setPanelPos(rect.top > window.innerHeight / 2 ? {
						left,
						bottom: window.innerHeight - rect.top + 6
					} : {
						left,
						top: rect.bottom + 6
					});
				};
				update();
				window.addEventListener("resize", update);
				return () => window.removeEventListener("resize", update);
			}, [
				open,
				pinnedPos,
				viewport
			]);
			(0, react.useLayoutEffect)(() => {
				const panel = panelRef.current;
				if (panel === null || panelHeight === null) return;
				const clamped = Math.min(panelHeight, panelContentHeight(panel), panelMaxHeight());
				if (clamped !== panelHeight) setPanelHeight(clamped);
			}, [
				panelHeight,
				data,
				open
			]);
			(0, react.useEffect)(() => {
				const onResize = () => setViewport({
					w: window.innerWidth,
					h: window.innerHeight
				});
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, []);
			const effYellow = parseThreshold(yellowThreshold) ?? DEFAULT_BALANCE_YELLOW;
			const effRed = Math.min(parseThreshold(redThreshold) ?? DEFAULT_BALANCE_RED, effYellow);
			const tone = healthTone(data, error, effRed, effYellow);
			const onKeyDown = (event) => {
				if (event.key !== "Escape" || !open) return;
				event.preventDefault();
				setOpen(false);
			};
			const onBallPointerDown = (event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					dragging: false
				};
			};
			const onBallPointerMove = (event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				if (!drag.dragging) {
					if (Math.abs(event.clientX - drag.startX) < 5 && Math.abs(event.clientY - drag.startY) < 5) return;
					drag.dragging = true;
					if (open) setOpen(false);
				}
				const half = BALL_SIZE / 2;
				setDragPos({
					x: Math.min(Math.max(half, event.clientX), window.innerWidth - half),
					y: Math.min(Math.max(half, event.clientY), window.innerHeight - half)
				});
			};
			const endBallDrag = (event) => {
				const drag = dragRef.current;
				dragRef.current = null;
				if (drag === null || drag.pointerId !== event.pointerId || !drag.dragging) return;
				const half = BALL_SIZE / 2;
				const x = Math.min(Math.max(half, event.clientX), window.innerWidth - half);
				const y = Math.min(Math.max(half, event.clientY), window.innerHeight - half);
				const next = {
					fx: x / window.innerWidth,
					fy: y / window.innerHeight
				};
				setPinnedPos(next);
				storeFloatPos(next);
				setDragPos(null);
				suppressClickRef.current = true;
			};
			const cancelBallDrag = (event) => {
				if (dragRef.current?.pointerId !== event.pointerId) return;
				dragRef.current = null;
				setDragPos(null);
			};
			const onResizePointerDown = (event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				const panel = panelRef.current;
				const rect = panel?.getBoundingClientRect();
				const startHeight = panelHeight ?? Math.round(rect?.height ?? 0);
				if (panel !== null) {
					const viewportMax = panelMaxHeight();
					const max = Math.min(panelContentHeight(panel), viewportMax);
					const min = Math.min(Math.max(firstCardMinHeight(panel), PANEL_MIN_H), max);
					resizeLimitsRef.current = {
						min,
						max
					};
				} else resizeLimitsRef.current = {
					min: PANEL_MIN_H,
					max: panelMaxHeight()
				};
				resizeRef.current = {
					pointerId: event.pointerId,
					startY: event.clientY,
					startHeight,
					current: startHeight
				};
			};
			const onResizePointerMove = (event) => {
				const resize = resizeRef.current;
				if (resize === null || resize.pointerId !== event.pointerId) return;
				const limits = resizeLimitsRef.current;
				const next = limits === null ? resize.startHeight + (resize.startY - event.clientY) : Math.min(Math.max(resize.startHeight + (resize.startY - event.clientY), limits.min), limits.max);
				resize.current = next;
				setPanelHeight(next);
			};
			const endResize = (event) => {
				const resize = resizeRef.current;
				if (resize === null || resize.pointerId !== event.pointerId) return;
				resizeRef.current = null;
				resizeLimitsRef.current = null;
				storePanelHeight(resize.current);
			};
			const onBallClick = () => {
				if (suppressClickRef.current) {
					suppressClickRef.current = false;
					return;
				}
				setNow(Date.now());
				setOpen((current) => !current);
				if (!open) refresh();
			};
			const docked = pinnedPos ?? defaultFloatPos();
			const centerX = dragPos !== null ? dragPos.x : docked.fx * viewport.w;
			const centerY = dragPos !== null ? dragPos.y : docked.fy * viewport.h;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: "dsh-usage-root",
				onKeyDown,
				children: [(0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					ref: ballRef,
					type: "button",
					className: `dsh-usage-ball dsh-usage-tone-${tone}`,
					style: {
						left: centerX - BALL_SIZE / 2,
						top: centerY - BALL_SIZE / 2
					},
					"aria-expanded": open,
					"aria-label": tt("action.aria"),
					title: `${tt("action.aria")} · ${tt(`status.tone.${tone}`)}`,
					onPointerDown: onBallPointerDown,
					onPointerMove: onBallPointerMove,
					onPointerUp: endBallDrag,
					onPointerCancel: cancelBallDrag,
					onClick: onBallClick,
					onKeyDown,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BatteryIcon, {})
				}), document.body), open && panelPos !== null ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: "dsh-usage-panel",
					role: "dialog",
					"aria-label": tt("panel.title"),
					style: {
						left: panelPos.left,
						top: panelPos.top,
						bottom: panelPos.bottom,
						...panelHeight !== null ? {
							height: Math.min(panelHeight, panelMaxHeight()),
							maxHeight: "none"
						} : {}
					},
					onKeyDown,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-usage-resize",
							title: tt("panel.resize"),
							"aria-label": tt("panel.resize"),
							onPointerDown: onResizePointerDown,
							onPointerMove: onResizePointerMove,
							onPointerUp: endResize,
							onPointerCancel: endResize
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-usage-head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-usage-title",
									children: tt("panel.title")
								}),
								data?.version ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-usage-version",
									children: ["v", data.version]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-usage-home",
									onClick: resetFloatPos,
									title: tt("panel.resetPos"),
									"aria-label": tt("panel.resetPos"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HomeIcon, {})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dsh-usage-lang",
									onClick: toggleLang,
									title: tt("lang.switch"),
									"aria-label": tt("lang.switch"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GlobeIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: lang === "zh" ? "中" : "EN" })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `dsh-usage-refresh${loading ? " dsh-usage-refresh--loading" : ""}`,
									disabled: loading,
									onClick: refresh,
									title: tt("panel.refresh"),
									"aria-label": tt("panel.refresh"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {})
								})
							]
						}),
						data === null && error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-usage-message",
							children: [
								tt("status.error"),
								": ",
								error
							]
						}) : null,
						data !== null && data.providers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-usage-message",
							children: tt("panel.empty")
						}) : null,
						(data?.providers ?? []).map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCard, {
							provider,
							now,
							red: effRed,
							yellow: effYellow,
							t: tt
						}, provider.id)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-usage-foot",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-usage-footLabel",
									children: tt("panel.interval")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "dsh-usage-select",
									value: intervalSec,
									onChange: (event) => {
										const value = Number(event.target.value);
										setIntervalSec(value);
										storeInterval(value);
									},
									children: INTERVAL_OPTIONS.map((seconds) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: seconds,
										children: tt(`interval.${seconds}s`)
									}, seconds))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-usage-updated",
									children: data === null ? tt("panel.never") : tt("panel.updated", { time: new Date(data.fetchedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US") })
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-usage-thresholds",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-usage-footLabel",
									children: tt("panel.thresholds")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-usage-thresholdField",
									title: tt("panel.thresholdRed"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-usage-thresholdLabel dsh-usage-thresholdLabel--red",
										children: tt("panel.thresholdRed")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-usage-thresholdInput",
										type: "number",
										min: 0,
										step: .01,
										inputMode: "decimal",
										value: redThreshold,
										onChange: (event) => {
											setRedThreshold(event.target.value);
											storeThreshold(THRESHOLD_RED_KEY, event.target.value);
										}
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-usage-thresholdField",
									title: tt("panel.thresholdYellow"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-usage-thresholdLabel dsh-usage-thresholdLabel--yellow",
										children: tt("panel.thresholdYellow")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-usage-thresholdInput",
										type: "number",
										min: 0,
										step: .01,
										inputMode: "decimal",
										value: yellowThreshold,
										onChange: (event) => {
											setYellowThreshold(event.target.value);
											storeThreshold(THRESHOLD_YELLOW_KEY, event.target.value);
										}
									})]
								})
							]
						})
					]
				}), document.body) : null]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Panel stylesheet, injected once per page. Follows the shipped plugins'
		* convention of a `<style data-plugin-css>` tag and design-token colors.
		*/
		const CSS = `
.dsh-usage-root { position: relative; display: inline-flex; }
/* Tri-tone health halo: only the shadow carries the state of the provider IN
   USE (green ok / amber remaining<30% / red error or usage>=90%) — the button
   face itself stays neutral. A 1px tone ring plus a soft halo keeps the
   state readable on both light and dark skins. */
.dsh-usage-tone-ok { --dsh-usage-tone: #22a06b; }
.dsh-usage-tone-warn { --dsh-usage-tone: #e2b93b; }
.dsh-usage-tone-danger { --dsh-usage-tone: #d94f4f; }
/* Floating ball trigger: a draggable fixed circle portaled to document.body,
   one layer below the panel (1000) so the popover always covers it. Position
   comes from inline style: docked it sits at its stored coordinates, while
   dragging it follows the cursor. Keeps the shell's lv3 lift shadow; the
   tone halo stacks on top. */
.dsh-usage-ball {
  position: fixed; z-index: 999; width: 32px; height: 32px; border-radius: 50%;
  /* The shell's theme opts every element into squircle corners
     (corner-shape: superellipse) under @supports; a ball must stay round. */
  corner-shape: round;
  cursor: pointer; touch-action: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--dsw-alias-border-l2);
  background-color: var(--dsw-specific-menu);
  color: var(--dsw-alias-label-tertiary);
  transition: box-shadow 0.15s;
}
.dsh-usage-ball:hover, .dsh-usage-ball:focus-visible { color: var(--dsw-alias-label-secondary); }
.dsh-usage-ball svg { width: 15px; height: 15px; }
.dsh-usage-ball.dsh-usage-tone-ok,
.dsh-usage-ball.dsh-usage-tone-warn,
.dsh-usage-ball.dsh-usage-tone-danger {
  box-shadow:
    var(--dsw-shadow-lv3),
    0 0 0 1px color-mix(in srgb, var(--dsh-usage-tone) 40%, transparent),
    0 0 14px color-mix(in srgb, var(--dsh-usage-tone) 55%, transparent);
}
.dsh-usage-ball.dsh-usage-tone-ok:hover,
.dsh-usage-ball.dsh-usage-tone-warn:hover,
.dsh-usage-ball.dsh-usage-tone-danger:hover,
.dsh-usage-ball.dsh-usage-tone-ok:focus-visible,
.dsh-usage-ball.dsh-usage-tone-warn:focus-visible,
.dsh-usage-ball.dsh-usage-tone-danger:focus-visible {
  box-shadow:
    var(--dsw-shadow-lv3),
    0 0 0 1px color-mix(in srgb, var(--dsh-usage-tone) 55%, transparent),
    0 0 18px color-mix(in srgb, var(--dsh-usage-tone) 70%, transparent);
}
.dsh-usage-panel {
  z-index: 1000; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-menu);
  box-shadow: var(--dsw-shadow-lv3);
  border-radius: 12px; margin: 0; padding: 8px;
  width: 320px; max-width: min(360px, 100vw - 16px);
  max-height: min(460px, 100vh - 60px); overflow: auto;
  display: flex; flex-direction: column; gap: 6px;
  /* position: fixed with viewport coordinates computed inline from the
     trigger rect — absolute positioning inside the sidebar gets clipped by
     the column's overflow. */
  position: fixed;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
/* Top-edge resize handle: sticks to the panel top even while the body
   scrolls, so it is always grabbable; drag to make the panel taller/shorter
   (height persisted in localStorage). */
.dsh-usage-resize {
  position: sticky; top: 0; z-index: 2; flex: none;
  height: 6px; margin: -4px 0 0;
  cursor: ns-resize; touch-action: none;
  border-radius: 3px;
}
.dsh-usage-resize::after {
  content: ''; position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 32px; height: 3px; border-radius: 2px;
  background: var(--dsw-alias-border-l2);
}
.dsh-usage-resize:hover, .dsh-usage-resize:active {
  background: color-mix(in srgb, var(--dsw-alias-accent, #4f8cff) 25%, transparent);
}
.dsh-usage-resize:hover::after, .dsh-usage-resize:active::after {
  background: var(--dsw-alias-accent, #4f8cff);
}
.dsh-usage-head {
  display: flex; align-items: center; gap: 8px; padding: 2px 4px 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-usage-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
.dsh-usage-version {
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px;
  padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-fill-l2);
  font-variant-numeric: tabular-nums; user-select: none; margin-right: auto;
}
.dsh-usage-lang {
  cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
  border: 0; border-radius: 6px; background: 0; padding: 3px 5px;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px;
}
.dsh-usage-lang:hover { color: var(--dsw-alias-label-secondary); }
.dsh-usage-refresh {
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 6px; background: 0; padding: 4px;
  color: var(--dsw-alias-label-tertiary); line-height: 0;
}
.dsh-usage-refresh:hover { color: var(--dsw-alias-label-secondary); }
.dsh-usage-refresh:disabled { opacity: 0.5; cursor: default; }
/* Home button in the panel head: sends the ball back to its default spot. */
.dsh-usage-home {
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 6px; background: 0; padding: 4px;
  color: var(--dsw-alias-label-tertiary); line-height: 0;
}
.dsh-usage-home:hover { color: var(--dsw-alias-label-secondary); }
@keyframes dsh-usage-spin { to { transform: rotate(360deg); } }
.dsh-usage-refresh--loading svg { animation: dsh-usage-spin 0.9s linear infinite; }
.dsh-usage-card {
  border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
  background: var(--dsw-alias-fill-l2);
}
/* The provider in use, whose quota alone drives the ball tone. */
.dsh-usage-card--active {
  outline: 1px solid color-mix(in srgb, var(--dsw-alias-accent, #4f8cff) 45%, transparent);
  outline-offset: -1px;
}
.dsh-usage-cardHead { display: flex; align-items: center; gap: 8px; }
.dsh-usage-providerName {
  color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
}
.dsh-usage-inUse {
  flex: none; font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-accent, #4f8cff) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-accent, #4f8cff) 35%, transparent);
}
.dsh-usage-message { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; word-break: break-all; }
.dsh-usage-balanceRow { display: flex; align-items: baseline; gap: 8px; }
.dsh-usage-balanceTotal {
  color: var(--dsw-alias-label-primary); font-size: 18px; font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* Balance below the user-configured thresholds: red < red threshold, yellow
   below the yellow threshold; a healthy balance keeps the default label color. */
.dsh-usage-balanceTotal--warn { color: #e2b93b; }
.dsh-usage-balanceTotal--danger { color: #d94f4f; }
.dsh-usage-balanceCurrency { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-usage-balanceParts { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.dsh-usage-row { display: flex; flex-direction: column; gap: 3px; }
.dsh-usage-rowHead { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; }
.dsh-usage-rowLabel { color: var(--dsw-alias-label-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-usage-rowValue { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; flex: none; }
/* Credits rows show a remaining balance: tinted by the balance thresholds. */
.dsh-usage-rowValue--warn { color: #e2b93b; }
.dsh-usage-rowValue--danger { color: #d94f4f; }
.dsh-usage-barTrack {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: var(--dsw-alias-border-l2);
}
.dsh-usage-barFill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.dsh-usage-barFill--ok { background: #22a06b; }
.dsh-usage-barFill--warn { background: #e2b93b; }
.dsh-usage-barFill--danger { background: #d94f4f; }
.dsh-usage-rowReset { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.dsh-usage-foot {
  display: flex; align-items: center; gap: 8px; padding: 6px 4px 2px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-usage-footLabel { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsh-usage-select {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: 0;
  color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 2px 4px; cursor: pointer;
}
.dsh-usage-updated { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-left: auto; }
/* Balance threshold row under the footer: red/yellow inputs persisted locally. */
.dsh-usage-thresholds {
  display: flex; align-items: center; gap: 10px; padding: 2px 4px 4px;
}
.dsh-usage-thresholdField { display: inline-flex; align-items: center; gap: 4px; }
.dsh-usage-thresholdLabel { font-size: 11px; font-weight: 600; }
.dsh-usage-thresholdLabel--red { color: #d94f4f; }
.dsh-usage-thresholdLabel--yellow { color: #e2b93b; }
.dsh-usage-thresholdInput {
  width: 58px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: 0;
  color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 2px 4px;
  font-variant-numeric: tabular-nums;
}
.dsh-usage-thresholdInput:focus {
  outline: none;
  border-color: var(--dsw-alias-accent, #4f8cff);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-accent, #4f8cff) 40%, transparent);
}
`;
		const TAG_ID = "dsh-provider-usage/panel.css";
		/** Inject the panel stylesheet once; on HMR swap, refresh the existing tag's payload in place. */
		function ensureStyles() {
			if (typeof document === "undefined") return;
			const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]");
			if (existing !== null) {
				if (existing.textContent !== CSS) existing.textContent = CSS;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-provider-usage";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* provider-usage — browser half.
		*
		* Registers the locale dictionaries and contributes the usage widget into the
		* sidebar footer's additive action slot. Data comes from the host `usage`
		* Typert Remote (SRC mode — no generated descriptors) through the raw RPC
		* caller on the connection service.
		*
		* The "provider in use" flag is refined CLIENT-side: the host marks the route
		* from the GLOBAL default model selection, which only moves on an explicit
		* composer pick — switching between sessions with different per-session
		* selections would leave it stale. The focused session's own effective
		* selection (pending → last used → host default, mirrored by the composer's
		* model seat) is read live from the client session services and overrides the
		* host flag, so the panel follows session switches immediately.
		*/
		/**
		* Required client services: slot registry, locale seats, the connection RPC
		* caller, and the live session/model-selection state used to refine the
		* "in use" flag (`sessions` + `modelDirectories`, both mounted by the web
		* app — the latter is the composer model seat's own service).
		*/
		const inject = [
			"slots",
			"locale",
			"connection",
			"sessions",
			"modelDirectories"
		];
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register("provider-usage", {
				zh,
				en
			}), "provider-usage: dictionaries");
			const fetchUsage = async () => {
				const result = await ctx.connection.rpc.call("/api", "usage/list", { args: {} });
				if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
				return result.value;
			};
			/**
			* The provider the FOCUSED session's composer shows (and its agent would
			* use): the session's durable model selection, else the deployment default
			* — exactly what the host resolves per session. Undefined while the client
			* session state is not ready; the host's own flag then stands.
			*/
			const getActiveProvider = () => {
				const current = ctx.sessions?.list?.getSnapshot()?.current;
				if (typeof current !== "string" || current === "") return void 0;
				try {
					const provider = (ctx.modelDirectories?.directoryFor(current))?.store?.getSnapshot()?.current?.provider;
					return typeof provider === "string" && provider !== "" ? provider : void 0;
				} catch {
					return;
				}
			};
			/**
			* Re-derive the panel's "in use" flag the moment the focused session or its
			* model selection changes — no need to wait for the next poll tick. The
			* directory subscription follows the CURRENT focused session and is
			* re-pointed on every session switch, so a late projection load still lands.
			*/
			const subscribeActiveChange = (onChange) => {
				const sessions = ctx.sessions;
				if (typeof sessions?.list?.subscribe !== "function") return () => {};
				let directoryUnsub = null;
				const followDirectory = () => {
					directoryUnsub?.();
					directoryUnsub = null;
					const current = sessions.list.getSnapshot()?.current;
					if (typeof current === "string" && current !== "") try {
						const store = ctx.modelDirectories?.directoryFor(current)?.store;
						if (typeof store?.subscribe === "function") directoryUnsub = store.subscribe(onChange);
					} catch {}
				};
				const offList = sessions.list.subscribe(() => {
					followDirectory();
					onChange();
				});
				followDirectory();
				return () => {
					offList?.();
					directoryUnsub?.();
				};
			};
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "provider-usage",
				order: 10,
				locale: "provider-usage",
				inject: () => ({
					fetchUsage,
					getActiveProvider,
					subscribeActiveChange
				})
			}, UsageAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map