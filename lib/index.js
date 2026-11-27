import z from "@deepseek-ai/schemastery";
import { credentialKey, credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createHash, createHmac } from "node:crypto";
//#region src/wire.ts
/**
* Host-side verdict for "the credential is valid, the account has no plan":
* an adapter throws it and the service maps it to the `no-subscription`
* status instead of the `error` a failed query gets. Kept beside the status
* union so the two stay one concept.
*/
var NoActiveSubscriptionError = class extends Error {
	constructor() {
		super("no active subscription");
		this.name = "NoActiveSubscriptionError";
	}
};
function toNumber(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
function toResetAt(value) {
	const numeric = toNumber(value);
	if (numeric !== null) {
		const ms = numeric > 0xe8d4a51000 ? numeric : numeric * 1e3;
		const date = new Date(ms);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	if (typeof value === "string" && value !== "") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	return null;
}
function usageRow(raw, fallbackLabel) {
	if (raw === null || typeof raw !== "object") return null;
	const limit = toNumber(raw.limit ?? raw.limit_amount);
	let used = toNumber(raw.used ?? raw.used_amount);
	const remaining = toNumber(raw.remaining);
	if (used === null && remaining !== null && limit !== null) used = limit - remaining;
	if (used === null && limit === null && remaining === null) return null;
	const resetAt = toResetAt(raw.resetTime ?? raw.reset_at ?? raw.reset_time);
	const rem = remaining ?? (limit !== null && used !== null ? limit - used : null);
	return {
		label: String(raw.name ?? raw.title ?? raw.model_name ?? fallbackLabel),
		used,
		limit,
		remaining: rem,
		percent: limit !== null && limit > 0 && used !== null ? used / limit * 100 : null,
		resetAt
	};
}
/**
* Display priority for quota windows: the rolling 5h window comes first,
* then the weekly window, then provider-ordered extras (stable sort).
* Every adapter with a 5h/weekly pair (Kimi, Codex, MiniMax, z.ai,
* OpenCode, Volcengine Ark) renders in this order.
*/
function orderUsageRows(rows) {
	const priority = (label) => label === "5h limit" ? 0 : label === "weekly" ? 1 : 2;
	return rows.sort((a, b) => priority(a.label) - priority(b.label));
}
//#endregion
//#region src/deepseek-account.ts
/**
* DeepSeek Account (dsh ≥ 0.1.7) — grant parsing and wallet summarizing.
*
* The harness composes the `deepseek-account` route from the account platform
* plugin (`@deepseek-ai/dsh-deepseek-account-platform`): a browser PKCE
* sign-in stores a long-lived grant in the credential records under
* `deepseek-account-platform/default`, shaped `{ version: 1, token, issuer }`
* where `issuer` is the configured `platformOrigin`. The platform answers a
* balance query at `GET {issuer}/api/v0/users/get_user_summary` with the
* grant in the `x-dsh-auth-token` header:
*
*     { "code": 0, "data": { "biz_code": 0, "biz_data": {
*         "normal_wallets": [{ "currency": "CNY", "balance": "110.00" }],
*         "bonus_wallets":  [{ "currency": "CNY", "balance": "25.50" }] } } }
*
* `normal_wallets` are recharge money, `bonus_wallets` are granted money —
* kept separate by the platform, merged into the panel's
* total/granted/toppedUp row vocabulary here. Balance strings follow the
* big.js grammar the platform's web client accepts, including decimal
* exponents (`0E-16`, `5.0000000000000000`).
*
* The token is not refreshable: HTTP 401 or a top-level `code: 40003` means
* the stored sign-in is dead and only a new browser sign-in fixes it.
* @module dsh-provider-usage/deepseek-account
*/
/**
* Thrown when the platform rejects the stored grant (HTTP 401 or top-level
* response `code: 40003`): the panel reports "sign in again" instead of
* retrying a dead token.
*/
var DeepSeekAccountAuthRequiredError = class extends Error {
	code = "DEEPSEEK_ACCOUNT_AUTH_REQUIRED";
	constructor() {
		super("DeepSeek Account sign-in expired");
		this.name = "DeepSeekAccountAuthRequiredError";
	}
};
function isObject$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Validate the grant payload the account platform persists. */
function parseDeepSeekAccountGrant(payload) {
	if (!isObject$1(payload) || payload.version !== 1) return null;
	if (typeof payload.token !== "string" || payload.token === "") return null;
	if (typeof payload.issuer !== "string" || payload.issuer === "") return null;
	let origin;
	try {
		origin = new URL(payload.issuer);
	} catch {
		return null;
	}
	if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
	return {
		version: 1,
		token: payload.token,
		issuer: origin.origin
	};
}
/**
* The credential record key (as `credentialKey(provider, slot)` composes it)
* holding the account grant.
*/
const DEEPSEEK_ACCOUNT_CREDENTIAL_KEY = "deepseek-account-platform/default";
/**
* Whether a detected route is the harness's built-in DeepSeek account route
* with no sign-in behind it — the one route the harness composes
* unconditionally, so it is listed whether or not this deployment ever signed
* in. The panel leaves that card out: with no grant it could only ever read
* "OAuth authorization missing", a fact the harness's own account page already
* reports, and one that costs a card in the panel of everyone who uses the API
* key route instead. The row returns on the poll after a sign-in.
*
* A *configured* route is never hidden this way. An unsigned pi-ai
* `openai-codex` — registered only because the user configured it — keeps its
* card precisely because "sign in again" is the hint a human needs there.
* @param kind - the detected route's kind (`undefined` for an `unsupported`
*   route, which carries no kind at all).
* @param readGrant - reads the stored account grant; never called for other
*   routes, so a poll reads the credential store only when it has to.
* @returns true when the route should be left out of the panel.
*/
async function isUnusedAccountRoute(kind, readGrant) {
	if (kind !== "deepseek-account") return false;
	return await readGrant() === void 0;
}
/** Platform money amount as the panel displays it: two decimal places. */
function money(value) {
	return value.toFixed(2);
}
/**
* Merge the platform's wallet lists into one balance row per currency: the
* total is recharge + granted, and the parts keep the panel's split
* (`granted` = bonus wallets, `toppedUp` = normal wallets). Wallet entries
* with a missing currency or a non-numeric balance are skipped — a partially
* unreadable summary still shows the wallets that did parse.
* @param wallets - the envelope's `biz_data` object (may be malformed).
* @returns one row per currency seen, or an empty array.
*/
function accountBalanceRows(wallets) {
	if (!isObject$1(wallets)) return [];
	const merged = /* @__PURE__ */ new Map();
	const add = (list, slot) => {
		if (!Array.isArray(list)) return;
		for (const entry of list) {
			if (!isObject$1(entry)) continue;
			const currency = typeof entry.currency === "string" ? entry.currency.trim().toUpperCase() : "";
			const amount = toNumber(entry.balance);
			if (currency === "" || amount === null) continue;
			const row = merged.get(currency) ?? {
				total: 0,
				granted: 0,
				toppedUp: 0
			};
			row[slot] += amount;
			row.total += amount;
			merged.set(currency, row);
		}
	};
	add(wallets.normal_wallets, "toppedUp");
	add(wallets.bonus_wallets, "granted");
	return [...merged.entries()].map(([currency, row]) => ({
		currency,
		total: money(row.total),
		granted: money(row.granted),
		toppedUp: money(row.toppedUp)
	}));
}
/**
* Parse one `get_user_summary` response envelope into balance rows.
* @param payload - the parsed JSON body (any shape).
* @returns the wallet rows, or an empty array when the envelope holds none.
* @throws DeepSeekAccountAuthRequiredError when the platform answers the
*   top-level `code: 40003` (invalid authorization) verdict.
*/
function parseAccountSummaryEnvelope(payload) {
	if (!isObject$1(payload)) return [];
	if (payload.code === 40003) throw new DeepSeekAccountAuthRequiredError();
	const data = isObject$1(payload.data) ? payload.data : null;
	if (payload.code !== 0 || data === null || data.biz_code !== 0) return [];
	return accountBalanceRows(data.biz_data);
}
//#endregion
//#region src/section.ts
/**
* Detach a live entry config. Newer dsh hands volatile fields out as reactive
* refs read through `.get()` (e.g. `llm-pi-ai`'s `providers` map), so unwrap
* those and deep-copy plain data: callers index a stable snapshot and never a
* live object.
* @param value - a live config node.
* @returns the detached plain value.
*/
function plainSection(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return plainSection(value.get());
	if (Array.isArray(value)) return value.map(plainSection);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainSection(child)]));
	return value;
}
/**
* Read one plugin's live config section, whichever settings generation is
* mounted. The legacy `settings.get(ns)` is tried first — an `undefined`
* answer (legacy reads throw only on a broken service, and answer `undefined`
* for an unregistered namespace) falls through to the config editor's loader
* entries, so nothing is lost on a hybrid composition either.
* @param settings - `ctx.get('settings')`, any generation (may be undefined).
* @param configEditor - `ctx.get('configEditor')`; only consulted when the
*   legacy `get` is absent (may be undefined).
* @param ns - the profile entry id / settings namespace to read.
* @returns the detached section value, or undefined when unavailable.
*/
async function readLiveSection(settings, configEditor, ns) {
	let legacy;
	if (settings !== null && typeof settings === "object" && typeof settings.get === "function") {
		try {
			legacy = await Promise.resolve(settings.get(ns));
		} catch {
			legacy = void 0;
		}
		if (legacy !== void 0) return legacy;
	}
	const entries = configEditor !== null && typeof configEditor === "object" && typeof configEditor.entries === "function" ? configEditor.entries() ?? [] : [];
	const entry = (Array.isArray(entries) ? entries : []).find((row) => row?.options?.id === ns);
	if (entry?.fiber === void 0) return void 0;
	return plainSection(entry.fiber.config);
}
/**
* The settings namespace a pi-ai route's profile lives under. The
* configurable-provider directory publishes each route's owning namespace
* (which is the composing entry's id and may differ from the plugin default);
* the directory is new in the same generation that removed `settings.get`, so
* the plugin's own namespace stays the fallback for older harnesses.
* @param llm - `ctx.get('llm')`, any generation.
* @param routeId - the provider route id.
* @param fallback - namespace assumed when no directory entry answers.
* @returns the namespace to read the route's profile section from.
*/
function settingsNsForRoute(llm, routeId, fallback = "llm-pi-ai") {
	const directory = llm !== null && typeof llm === "object" && typeof llm.listConfigurableProviders === "function" ? llm.listConfigurableProviders() ?? [] : [];
	const ns = (Array.isArray(directory) ? directory : []).find((row) => row?.provider === routeId)?.settingsNs;
	return typeof ns === "string" && ns !== "" ? ns : fallback;
}
//#endregion
//#region src/host-seams.ts
/** Whether a live service is an object this probe can look into at all. */
function isService(value) {
	return value !== null && typeof value === "object";
}
/** Whether a service object carries a callable method of that name. */
function hasMethod(holder, name) {
	return isService(holder) && typeof holder[name] === "function";
}
/**
* Name every seam the plugin needs but the live services do not provide.
*
* Only the surfaces that decide whether a query can work at all are judged:
* credential resolution (`resolve` for key references, `readRecord` for the
* stored grants, `modifyRecord` for the Codex rotation) and route enumeration
* (`llm.listProviders`, without which there is nothing to enumerate). The
* settings and model-selection seams are deliberately absent from this list —
* the plugin reads them defensively across three dsh generations, so their
* absence degrades a detail rather than the query.
* @param services - the services as `ctx.get` answered them; either may be
*   `undefined` when the composition does not mount it.
* @returns the missing seam names, or an empty array when nothing is missing.
*/
function missingHostSeams(services) {
	const missing = [];
	if (!isService(services.credentials)) missing.push("credentials");
	else for (const name of [
		"readRecord",
		"modifyRecord",
		"resolve"
	]) if (!hasMethod(services.credentials, name)) missing.push(`credentials.${name}`);
	if (!isService(services.llm)) missing.push("llm");
	else if (!hasMethod(services.llm, "listProviders")) missing.push("llm.listProviders");
	return missing;
}
//#endregion
//#region src/openai-codex.ts
/** OpenAI Codex OAuth grant parsing and refresh helpers. */
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
/**
* Upstream verdicts that only a fresh sign-in can clear: the stored refresh
* token is single-use, so `refresh_token_reused` means the rotation it took
* part in was lost, and `invalid_grant` means it was revoked or expired.
*/
const REAUTH_CODES = /* @__PURE__ */ new Set([
	"refresh_token_reused",
	"invalid_grant",
	"invalid_token"
]);
/**
* Thrown when the stored grant is unrecoverable without human authorization.
* Carries the dead refresh token so callers can latch this verdict against
* exactly that token — a new sign-in stores a different one and clears it —
* and carries a message meant to reach the user verbatim.
*/
var OpenAiCodexReauthRequiredError = class extends Error {
	code = "OPENAI_CODEX_REAUTH_REQUIRED";
	refreshToken;
	constructor(message, refreshToken) {
		super(message);
		this.name = "OpenAiCodexReauthRequiredError";
		this.refreshToken = refreshToken;
	}
};
function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Read a failed token response. OpenAI reports a consumed refresh token as a
* nested object (`{ error: { code: 'refresh_token_reused' } }`) while the OAuth
* spec uses a bare `error` string, so both shapes are unwrapped into one
* human-readable detail plus the "needs a new sign-in" verdict.
*/
function refreshFailure(body) {
	if (!isObject(body)) return {
		detail: void 0,
		reauth: false
	};
	const description = typeof body.error_description === "string" && body.error_description !== "" ? body.error_description : void 0;
	const nested = body.error;
	if (isObject(nested)) {
		const message = typeof nested.message === "string" && nested.message !== "" ? nested.message : void 0;
		const code = typeof nested.code === "string" && nested.code !== "" ? nested.code : typeof nested.type === "string" && nested.type !== "" ? nested.type : void 0;
		return {
			detail: (message === void 0 ? code : code === void 0 ? message : `${message} (${code})`) ?? description,
			reauth: code !== void 0 && REAUTH_CODES.has(code)
		};
	}
	if (typeof nested === "string" && nested !== "") return {
		detail: description ?? nested,
		reauth: REAUTH_CODES.has(nested)
	};
	return {
		detail: description,
		reauth: false
	};
}
/** Decode the ChatGPT account id embedded in a Codex OAuth access token. */
function openAiCodexAccountId(accessToken) {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3 || parts[1] === "") return null;
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		if (!isObject(payload)) return null;
		const auth = payload[OPENAI_AUTH_CLAIM];
		if (!isObject(auth)) return null;
		const accountId = auth.chatgpt_account_id;
		return typeof accountId === "string" && accountId !== "" ? accountId : null;
	} catch {
		return null;
	}
}
/** Validate the opaque grant payload written by dsh-llm-pi-ai. */
function parseOpenAiCodexGrant(payload) {
	if (!isObject(payload) || payload.type !== "oauth") return null;
	if (typeof payload.access !== "string" || payload.access === "") return null;
	if (typeof payload.refresh !== "string" || payload.refresh === "") return null;
	if (typeof payload.expires !== "number" || !Number.isFinite(payload.expires)) return null;
	const accountId = (typeof payload.accountId === "string" && payload.accountId !== "" ? payload.accountId : null) ?? openAiCodexAccountId(payload.access);
	return accountId === null ? null : {
		type: "oauth",
		access: payload.access,
		refresh: payload.refresh,
		expires: payload.expires,
		accountId
	};
}
/** Refresh slightly early so the token cannot expire during the quota request. */
function openAiCodexGrantNeedsRefresh(grant, now = Date.now()) {
	return grant.expires <= now + 3e4;
}
/** Refresh a Codex OAuth grant using the same public client identity as pi-ai. */
async function refreshOpenAiCodexGrant(refreshToken, signal) {
	let response;
	try {
		response = await fetch(OPENAI_CODEX_TOKEN_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: OPENAI_CODEX_CLIENT_ID
			}),
			signal
		});
	} catch (error) {
		if (signal.aborted) throw error;
		throw new Error(`OpenAI Codex OAuth refresh failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	let body;
	try {
		body = await response.json();
	} catch {
		body = void 0;
	}
	if (!response.ok) {
		const failure = refreshFailure(body);
		const message = `OpenAI Codex OAuth refresh failed (HTTP ${response.status})${failure.detail === void 0 ? "" : `: ${failure.detail}`}`;
		if (failure.reauth) throw new OpenAiCodexReauthRequiredError(message, refreshToken);
		throw new Error(message);
	}
	if (!isObject(body)) throw new Error("OpenAI Codex OAuth refresh returned an invalid response");
	const access = body.access_token;
	const refresh = body.refresh_token;
	const expiresIn = body.expires_in;
	if (typeof access !== "string" || access === "" || typeof refresh !== "string" || refresh === "" || typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) throw new Error("OpenAI Codex OAuth refresh response is missing token fields");
	const accountId = openAiCodexAccountId(access);
	if (accountId === null) throw new Error("OpenAI Codex OAuth access token has no ChatGPT account id");
	return {
		type: "oauth",
		access,
		refresh,
		expires: Date.now() + expiresIn * 1e3,
		accountId
	};
}
/**
* Resolve the stored Codex grant, rotating it under the credential store's
* exclusive lock when it is close to expiry.
*
* The lock is taken *before* the network round trip, not after it. The refresh
* token is single-use upstream, so a write that fails once the token has been
* spent loses the rotation for good; deciding inside `mutate` also means a
* concurrent process that already rotated the grant is observed rather than
* overwritten, and no single-use token is ever spent twice. A rejected write
* is deliberately left to propagate — reporting a healthy panel over a grant
* that was never persisted is what turns this failure into a silent brick.
*
* The record is pre-read outside the lock only to answer "is there a grant at
* all" (missing authorization) and to keep the steady state lock-free.
*
* @param store - the credentials record seam.
* @param key - the record key holding the grant.
* @param grantRecord - rebuilds the store's own record shape around a grant.
* @param signal - cancellation for the refresh request.
* @returns the current grant, or `undefined` when none is stored/parseable.
*/
async function resolveOpenAiCodexGrant(store, key, grantRecord, signal) {
	const existing = await store.readRecord(key);
	if (existing === void 0) return void 0;
	const parsed = parseOpenAiCodexGrant(existing.payload);
	if (parsed === null) return void 0;
	if (!openAiCodexGrantNeedsRefresh(parsed)) return parsed;
	const committed = await store.modifyRecord(key, async (current) => {
		if (current === void 0) return void 0;
		const fresh = parseOpenAiCodexGrant(current.payload);
		if (fresh === null) return void 0;
		if (!openAiCodexGrantNeedsRefresh(fresh)) return void 0;
		return grantRecord(await refreshOpenAiCodexGrant(fresh.refresh, signal));
	});
	return (committed === void 0 ? null : parseOpenAiCodexGrant(committed.payload)) ?? parsed;
}
//#endregion
//#region src/kimi.ts
/**
* Kimi Code `/v1/usages` parsing.
*
* The endpoint has reported three shapes over its life, and an account with no
* valid plan answers a fourth: an empty body (`{}`, HTTP 200, no error).
*
* - **ratio pools** (what the official CLI reads today):
*   `usages: { limit_5h, limit_7d, limit_month_total, limit_month_code }`,
*   each `{ used_ratio, reset_time }`. The pools are the plan itself: when the
*   membership lapses the whole `usages` key disappears.
* - **count windows**: `limits: [{ window, detail }]`, with string amounts and
*   a camelCase `resetTime`; an optional `usage` summary rides beside them.
* - **per-model data**: `data: [{ model_name, limit, used, ... }]`, where the
*   `all` row is the overall weekly window.
*
* The distinction that matters to the panel is {@link KimiUsageResult.hasPlanData}:
* a payload that carries quota data but yields no window is a parse failure the
* user must see, while a payload with no quota container at all means "no
* active plan" — rendering that as an empty card hides the very fact the user
* opens the panel to check.
* @module dsh-provider-usage/kimi
*/
/** Ratio-pool keys rendered by the panel, in display order. */
const RATIO_POOLS = [
	["limit_5h", "5h limit"],
	["limit_7d", "weekly"],
	["limit_month_total", "monthly"]
];
/** Code-only monthly pool, shown when the combined monthly pool is absent. */
const CODE_MONTH_POOL = "limit_month_code";
/** One ratio-pool entry (`used_ratio` is a fraction of the window). */
function ratioRow(raw, label) {
	const ratio = toNumber(raw?.used_ratio);
	if (ratio === null) return null;
	const percent = Math.min(100, Math.max(0, ratio * 100));
	return {
		label,
		used: percent,
		limit: 100,
		remaining: 100 - percent,
		percent,
		resetAt: toResetAt(raw?.reset_time ?? raw?.resetTime)
	};
}
function parseRatioPools(pools) {
	if (pools === null || typeof pools !== "object" || Array.isArray(pools)) return [];
	const rows = [];
	for (const [key, label] of RATIO_POOLS) {
		const row = ratioRow(pools[key], label);
		if (row !== null) rows.push(row);
	}
	if (!rows.some((row) => row.label === "monthly")) {
		const code = ratioRow(pools[CODE_MONTH_POOL], "monthly");
		if (code !== null) rows.push(code);
	}
	return rows;
}
/** Window label from a `limits[].window` descriptor (300 MINUTE → "5h limit"). */
function windowLabel(window) {
	const duration = toNumber(window?.duration);
	if (duration === null) return "limit";
	const unit = String(window?.timeUnit ?? window?.time_unit ?? "").toUpperCase();
	if (unit.includes("MINUTE")) return duration >= 60 && duration % 60 === 0 ? `${duration / 60}h limit` : `${duration}m limit`;
	if (unit.includes("HOUR")) return `${duration}h limit`;
	if (unit.includes("DAY")) return `${duration}d limit`;
	if (unit.includes("MONTH")) return `${duration}mo limit`;
	return "limit";
}
function parseLimitWindows(limits) {
	if (!Array.isArray(limits)) return [];
	const rows = [];
	for (const item of limits) {
		const row = usageRow(item?.detail !== null && typeof item?.detail === "object" ? item.detail : item, windowLabel(item?.window));
		if (row !== null) rows.push(row);
	}
	return rows;
}
function parseModelWindows(data) {
	if (!Array.isArray(data)) return [];
	const rows = [];
	for (const item of data) {
		const isOverall = item?.model_name === "all";
		const row = usageRow(item, isOverall ? "weekly" : "limit");
		if (row !== null) rows.push(isOverall ? {
			...row,
			label: "weekly"
		} : row);
	}
	return rows;
}
/** True when the payload carries any quota container (see {@link KimiUsageResult}). */
function carriesQuota(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
	const pools = payload.usages;
	if (pools !== null && typeof pools === "object" && !Array.isArray(pools) && Object.keys(pools).length > 0) return true;
	if (Array.isArray(payload.data) && payload.data.length > 0) return true;
	if (Array.isArray(payload.limits) && payload.limits.length > 0) return true;
	const usage = payload.usage;
	return usage !== null && typeof usage === "object" && !Array.isArray(usage) && Object.keys(usage).length > 0;
}
/**
* Parse a Kimi Code usage response body into panel rows plus the plan verdict.
* @param payload - the parsed JSON body (may be `{}` for a lapsed plan).
*/
function parseKimiUsages(payload) {
	const pools = parseRatioPools(payload?.usages);
	if (pools.length > 0) return {
		usages: orderUsageRows(pools),
		hasPlanData: true
	};
	const models = parseModelWindows(payload?.data);
	if (models.length > 0) return {
		usages: orderUsageRows(models),
		hasPlanData: true
	};
	const rows = [];
	const summary = usageRow(payload?.usage, "weekly");
	if (summary !== null) rows.push({
		...summary,
		label: "weekly"
	});
	rows.push(...parseLimitWindows(payload?.limits));
	return {
		usages: orderUsageRows(rows),
		hasPlanData: carriesQuota(payload)
	};
}
//#endregion
//#region src/mistral.ts
/**
* Mistral billing (`api.mistral.ai/v1/billing/*`) parsing.
*
* Mistral publishes no public "how much is left" API, but its own Vibe CLI
* reads two billing endpoints with the ordinary inference key, so the same two
* calls work here — no console cookie, no browser session:
*
* - `GET /v1/billing/budget` → the month's allowance, per budget:
*   `{ vibe_budget: { usage_percentage, initial_budget, currency, reset_at,
*   payg_enabled? }, api_budget: { … } }`. `usage_percentage` is a percentage
*   of `initial_budget` (150 × 6.02% = $9.03 spent), not an amount.
* - `GET /v1/billing/subscription` → `{ plan_name, payg_enabled,
*   vibe_payg_enabled, enterprise }`.
*
* Both budgets belong to the **organization**, so every key of one
* organization reads the same `vibe_budget` and `api_budget`; what differs per
* key is which one the key spends. A console API key (`plan_type: "api"`)
* spends `api_budget`, a Vibe key (`"chat"`) spends `vibe_budget` — the
* `console.mistral.ai/api/vibe/whoami` fact magpie ([yetone/magpie],
* `internal/provider/mistral_plan.go`) reads to pick one. This adapter shows
* **both** rows instead of picking, which stays honest for either key kind and
* costs no extra request.
*
* [yetone/magpie]: https://github.com/yetone/magpie/blob/main/internal/provider/mistral_plan.go
* @module dsh-provider-usage/mistral
*/
/**
* Billing's plan names as Vibe titles them (`mistral_plan.go`,
* `mistralPlanTitles`). An unknown name is passed through untouched.
*/
const PLAN_TITLES = {
	FREE: "Free",
	INDIVIDUAL: "Pro",
	EDU: "Student",
	TEAM: "Team",
	ENTERPRISE: "Enterprise"
};
/** Window labels; the API and Vibe allowances are separate months. */
const API_LABEL = "API · Month";
const VIBE_LABEL = "Vibe · Month";
function toStringOrNull(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function toBooleanOrNull(value) {
	return typeof value === "boolean" ? value : null;
}
/**
* Coerce one `*_budget` block.
*
* A block with no positive `initial_budget` is "no allowance", not a zero
* window: Mistral omits a plan's budget entirely rather than reporting 0, and
* rendering a 0/0 bar reads as "exhausted" instead of "not on this plan".
* @param raw - the endpoint's budget object.
* @returns the normalised block, or null when the block grants nothing.
*/
function normalizeBudgetDetail(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const initialBudget = toNumber(raw.initial_budget);
	if (initialBudget === null || initialBudget <= 0) return null;
	return {
		usagePercentage: toNumber(raw.usage_percentage),
		initialBudget,
		currency: toStringOrNull(raw.currency),
		resetAt: toResetAt(raw.reset_at),
		paygEnabled: toBooleanOrNull(raw.payg_enabled)
	};
}
/**
* Read both budgets out of a `/v1/billing/budget` body.
* @param payload - the parsed JSON body.
* @returns the two blocks, each null when the organization has no allowance.
*/
function parseMistralBudget(payload) {
	return {
		vibe: normalizeBudgetDetail(payload?.vibe_budget),
		api: normalizeBudgetDetail(payload?.api_budget)
	};
}
/**
* Read the plan out of a `/v1/billing/subscription` body.
* @param payload - the parsed JSON body.
* @returns the subscription, or null for a body this parser cannot read.
*/
function parseMistralSubscription(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	return {
		planName: toStringOrNull(payload.plan_name),
		paygEnabled: toBooleanOrNull(payload.payg_enabled),
		vibePaygEnabled: toBooleanOrNull(payload.vibe_payg_enabled),
		enterprise: toBooleanOrNull(payload.enterprise)
	};
}
/**
* Billing's plan name as a title (`EDU` → `Student`, `INDIVIDUAL` → `Pro`).
* @param name - the raw `plan_name`.
* @returns the title, the raw name when unknown, or null.
*/
function planTitle(name) {
	if (name === null) return null;
	return PLAN_TITLES[name.toUpperCase()] ?? name;
}
/**
* Build the panel row for one budget block.
*
* The row is in the panel's own unit: `used`/`limit` in the budget's currency
* and `percent` as the endpoint's percentage, so the bar and the amount agree
* without re-deriving one from the other.
* @param detail - the normalised block.
* @param label - the window label.
* @returns the usage row.
*/
function budgetRow(detail, label) {
	const limit = detail.initialBudget ?? 0;
	const percent = Math.max(0, detail.usagePercentage ?? 0);
	const used = Math.round(limit * percent) / 100;
	return {
		label,
		used,
		limit,
		remaining: Math.max(0, Math.round((limit - used) * 100) / 100),
		percent: Math.min(100, percent),
		resetAt: detail.resetAt,
		currency: detail.currency
	};
}
/**
* Turn the two bodies into panel rows plus the plan title.
*
* Order is API then Vibe — the order the endpoint itself lists them.
* @param budgetBody - the `/v1/billing/budget` JSON.
* @param subscriptionBody - the `/v1/billing/subscription` JSON (optional; the
*   card stands without it).
* @returns the rows and the plan title.
*/
function parseMistralUsage(budgetBody, subscriptionBody) {
	const budget = parseMistralBudget(budgetBody);
	const subscription = parseMistralSubscription(subscriptionBody);
	const rows = [];
	if (budget.api !== null) rows.push(budgetRow(budget.api, API_LABEL));
	if (budget.vibe !== null) rows.push(budgetRow(budget.vibe, VIBE_LABEL));
	return {
		usages: rows,
		plan: planTitle(subscription?.planName ?? null),
		payg: subscription === null ? null : {
			enabled: subscription.paygEnabled,
			vibeEnabled: subscription.vibePaygEnabled
		}
	};
}
//#endregion
//#region src/volcengine-ark.ts
/**
* Volcengine Ark subscription-plan quota (Agent Plan / Coding Plan).
*
* These are the only adapters here whose quota does not come from the route's
* own endpoint. A plan's usage lives on Volcengine's OpenTOP *control plane*
* (`open.volcengineapi.com`, service `ark`, version `2024-01-01`) and is
* authenticated with an IAM **AK/SK pair** under Volcengine's V4 HMAC-SHA256
* scheme. The route's own key (`ARK_AGENT_PLAN_API_KEY` / `ARK_API_KEY`) is a
* data-plane Bearer credential and is refused there — the live gateway answers
* `GetAFPUsage requires Volcengine Ark SSO STS` — so these kinds resolve a
* separate credential pair instead of `apiKeyEnv`.
*
* | product     | action               | payload                                   |
* | ---         | ---                  | ---                                       |
* | Agent Plan  | `GetAFPUsage`        | `Result.AFP{FiveHour,Weekly,Monthly}`     |
* | Coding Plan | `GetCodingPlanUsage` | `Result.QuotaUsage[]`                     |
*
* Agent Plan windows are absolutes (`Quota`, `Used`, reset in epoch
* milliseconds); Coding Plan windows are percentages (`Percent`, reset in
* epoch seconds). Both use `-1`/`0` as the "no reset scheduled" sentinel, and
* an Agent Plan's `AFPDaily` window is deliberately not rendered — the Ark
* console and the official `arkcli` both omit it.
* @module dsh-provider-usage/volcengine-ark
*/
/** OpenTOP endpoint, service and version shared by both plan RPCs. */
const HOST = "open.volcengineapi.com";
const REGION = "cn-beijing";
const SERVICE = "ark";
const VERSION = "2024-01-01";
/**
* Agent Plan control-plane actions, primary first. Both names answer on the
* live gateway for `ark` 2024-01-01 and return the same payload; the official
* `arkcli` and CodexBar use the first, an earlier community plugin only the
* second, so the adapter retries the alias when the gateway reports the
* primary as unknown.
*/
const AGENT_PLAN_ACTIONS = ["GetAFPUsage", "GetAgentPlanAFPUsage"];
/** Coding Plan control-plane action. */
const CODING_PLAN_ACTIONS = ["GetCodingPlanUsage"];
/**
* IAM credential refs, each slot ordered most-specific first. The canonical
* names match the `dsh-volcark-quota` plugin so one AK/SK pair serves both
* panels; the trailing aliases let an environment that already exports the
* official volcengine tooling variables work without a second copy of the
* secret.
*/
const ACCESS_KEY_REFS = [
	"VOLC_ARK_ACCESS_KEY_ID",
	"VOLC_ACCESS_KEY_ID",
	"VOLC_ACCESSKEY"
];
const SECRET_KEY_REFS = [
	"VOLC_ARK_ACCESS_KEY_SECRET",
	"VOLC_ACCESS_KEY_SECRET",
	"VOLC_SECRETKEY",
	"VOLC_SECRET_KEY"
];
/** Headers the signature covers, lower-cased and sorted as the canonical form requires. */
const SIGNED_HEADERS = "host;x-content-sha256;x-date";
/** `yyyyMMdd'T'HHmmss'Z'` plus the `yyyyMMdd` half the credential scope starts with. */
function volcengineTimestamp(date) {
	const xDate = date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:\-]/g, "");
	return {
		xDate,
		dateStamp: xDate.slice(0, 8)
	};
}
/** Canonical query string: keys sorted, both halves percent-encoded. */
function canonicalQuery(params) {
	return Object.keys(params).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join("&");
}
function sha256Hex(data) {
	return createHash("sha256").update(data, "utf8").digest("hex");
}
function hmac(key, message) {
	return createHmac("sha256", key).update(message, "utf8").digest();
}
/**
* Sign one OpenTOP `POST /?Action=…&Version=…` call with an empty `{}` body.
*
* Byte-for-byte compatible with the official `@volcengine/openapi` signer:
* the signed set is `host;x-content-sha256;x-date` (that SDK leaves
* `content-type` unsigned), the credential scope is
* `<yyyyMMdd>/cn-beijing/ark/request`, and the signing key comes from the
* HMAC chain secret → date → region → service → `request`.
* @param options - AK/SK pair, action name, and an optional clock override for tests.
* @returns the request URL and its headers.
*/
function volcengineSignedRequest(options) {
	const contentSha256 = sha256Hex("{}");
	const { xDate, dateStamp } = volcengineTimestamp(options.date ?? /* @__PURE__ */ new Date());
	const query = canonicalQuery({
		Action: options.action,
		Version: VERSION
	});
	const canonicalRequest = [
		"POST",
		"/",
		query,
		`${[
			`host:${HOST}`,
			`x-content-sha256:${contentSha256}`,
			`x-date:${xDate}`
		].join("\n")}\n`,
		SIGNED_HEADERS,
		contentSha256
	].join("\n");
	const scope = `${dateStamp}/${REGION}/${SERVICE}/request`;
	const stringToSign = [
		"HMAC-SHA256",
		xDate,
		scope,
		sha256Hex(canonicalRequest)
	].join("\n");
	const signingKey = hmac(hmac(hmac(hmac(options.secretKey, dateStamp), REGION), SERVICE), "request");
	const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
	return {
		url: `https://${HOST}/?${query}`,
		headers: {
			"content-type": "application/json",
			"x-date": xDate,
			"x-content-sha256": contentSha256,
			authorization: `HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`
		}
	};
}
/**
* Reset instant for a plan window. Both products mark "no reset scheduled"
* with a non-positive number, which must read as absent rather than as 1970.
* Epoch milliseconds (Agent Plan) and seconds (Coding Plan) are told apart
* downstream by magnitude.
*/
function planResetAt(value) {
	const numeric = toNumber(value);
	if (numeric !== null && numeric <= 0) return null;
	return toResetAt(value);
}
/** Backend Coding Plan window names → the panel's canonical labels. */
function codingWindowLabel(level) {
	const name = String(level ?? "").toLowerCase();
	if (name === "session" || name === "5-hour" || name === "five_hour" || name === "5h") return "5h limit";
	if (name === "weekly" || name === "week") return "weekly";
	if (name === "monthly" || name === "month") return "monthly";
	return typeof level === "string" && level !== "" ? level : "limit";
}
/**
* Parse a `GetAFPUsage` payload into the panel's usage rows: the 5h, weekly
* and monthly windows in that order, each judged by its absolute
* `Used`/`Quota` pair. A window the plan does not carry (absent, or a
* non-positive quota) is skipped, and `AFPDaily` is never rendered.
* @param payload - decoded `GetAFPUsage` body.
* @returns the Agent Plan windows, empty when the account has no active plan.
*/
function parseAgentPlanUsage(payload) {
	const result = payload?.Result;
	const windows = [
		["5h limit", "AFPFiveHour"],
		["weekly", "AFPWeekly"],
		["monthly", "AFPMonthly"]
	];
	const rows = [];
	for (const [label, key] of windows) {
		const window = result?.[key];
		if (window === null || typeof window !== "object") continue;
		const quota = toNumber(window.Quota);
		if (quota === null || quota <= 0) continue;
		const row = usageRow({
			name: label,
			limit: quota,
			used: window.Used,
			resetTime: planResetAt(window.ResetTime)
		}, label);
		if (row !== null) rows.push(row);
	}
	return orderUsageRows(rows);
}
/**
* Parse a `GetCodingPlanUsage` payload into the panel's usage rows. Windows
* are percentage-only, so each is rendered as a 100-wide window. An inactive
* or reclaimed plan answers with `Status` alone and no `QuotaUsage`, which
* yields no rows.
* @param payload - decoded `GetCodingPlanUsage` body.
* @returns the Coding Plan windows, empty when the account has no active plan.
*/
function parseCodingPlanUsage(payload) {
	const entries = Array.isArray(payload?.Result?.QuotaUsage) ? payload.Result.QuotaUsage : [];
	const rows = [];
	for (const entry of entries) {
		const percent = toNumber(entry?.Percent);
		if (percent === null) continue;
		rows.push({
			label: codingWindowLabel(entry?.Level),
			used: percent,
			limit: 100,
			remaining: 100 - percent,
			percent,
			resetAt: planResetAt(entry?.ResetTimestamp)
		});
	}
	return orderUsageRows(rows);
}
//#endregion
//#region src/index.ts
const name = "provider-usage";
/** Own package version, baked in by tsdown `define` at build time (the
fallback only fires if the sources are compiled some other way). */
const version = "0.3.17-mistral.1";
/** Settings namespace this plugin owns (registered through `ctx.settings`). */
const NS = "provider-usage";
const PROVIDER_KINDS = [
	"deepseek",
	"deepseek-account",
	"kimi-coding",
	"mistral",
	"moonshot",
	"openrouter",
	"github-copilot",
	"openai-codex",
	"openai",
	"anthropic",
	"minimax",
	"zai",
	"opencode",
	"vercel-ai-gateway",
	"xai",
	"volcengine-ark-agent",
	"volcengine-ark-coding"
];
const ProviderSpec = z.object({
	/** Route id this spec describes (manual specs may use any unique id). */
	id: z.string(),
	kind: z.union(PROVIDER_KINDS),
	baseURL: z.string(),
	apiKeyEnv: z.string().role("credential-ref"),
	displayName: z.string().default(""),
	enabled: z.boolean().default(true)
});
const Config = z.object({
	/** Suggested widget refresh interval in seconds (the panel may override it locally). */
	refreshSeconds: z.number().step(1).min(5).max(86400).default(60),
	/** Balance below this amount turns red, compared in the balance's own currency
	(the panel may override it locally). */
	balanceRedThreshold: z.number().step(.01).min(0).default(10),
	/** Balance below this amount turns yellow, compared in the balance's own currency
	(the panel may override it locally). */
	balanceYellowThreshold: z.number().step(.01).min(0).default(30),
	/** Enumerate live provider routes from the llm registry. */
	autoDetect: z.boolean().default(true),
	/** Per-attempt query timeout in milliseconds; each retry gets a fresh timeout. */
	queryTimeoutMs: z.number().step(1).min(1e3).max(12e4).default(2e4),
	/** Retries after the first failed attempt for transient errors (timeout, network, HTTP 408/425/429/5xx). */
	queryRetries: z.number().step(1).min(0).max(10).default(2),
	/** Base delay between retries in milliseconds; doubles each attempt, capped at 10s. */
	queryRetryDelayMs: z.number().step(1).min(100).max(6e4).default(2e3),
	/** Manual provider specs; an id matching a detected route overrides it. */
	providers: z.array(ProviderSpec).default([])
});
/**
* Catalog fallback for well-known routes when the settings section omits
* connection facts. Mirrors the pi-ai catalog shipped with the harness, plus
* the harness's own `deepseek-official` route; routes without a fixed
* baseURL (cloud/OAuth providers) rely on the settings profile instead.
*/
const KNOWN_ROUTES = {
	"deepseek-official": {
		baseURL: "https://api.deepseek.com",
		apiKeyEnv: "DEEPSEEK_API_KEY",
		displayName: "DeepSeek"
	},
	deepseek: {
		baseURL: "https://api.deepseek.com",
		apiKeyEnv: "DEEPSEEK_API_KEY",
		displayName: "DeepSeek"
	},
	"deepseek-account": {
		baseURL: "https://platform.deepseek.com",
		displayName: "DeepSeek Account"
	},
	"kimi-coding": {
		baseURL: "https://api.kimi.com/coding",
		apiKeyEnv: "KIMI_API_KEY",
		displayName: "Kimi Code"
	},
	"moonshotai-cn": {
		baseURL: "https://api.moonshot.cn/v1",
		apiKeyEnv: "MOONSHOT_API_KEY",
		displayName: "Moonshot AI CN"
	},
	moonshotai: {
		baseURL: "https://api.moonshot.ai/v1",
		apiKeyEnv: "MOONSHOT_API_KEY",
		displayName: "Moonshot AI"
	},
	openrouter: {
		baseURL: "https://openrouter.ai/api/v1",
		apiKeyEnv: "OPENROUTER_API_KEY",
		displayName: "OpenRouter"
	},
	anthropic: {
		baseURL: "https://api.anthropic.com",
		apiKeyEnv: "ANTHROPIC_API_KEY",
		displayName: "Anthropic"
	},
	openai: {
		baseURL: "https://api.openai.com/v1",
		apiKeyEnv: "OPENAI_API_KEY",
		displayName: "OpenAI"
	},
	"openai-codex": {
		baseURL: "https://chatgpt.com/backend-api",
		displayName: "OpenAI Codex"
	},
	google: {
		baseURL: "https://generativelanguage.googleapis.com/v1beta",
		apiKeyEnv: "GEMINI_API_KEY",
		displayName: "Google"
	},
	"google-vertex": {
		apiKeyEnv: "GOOGLE_CLOUD_API_KEY",
		displayName: "Google Vertex"
	},
	xai: {
		baseURL: "https://api.x.ai/v1",
		apiKeyEnv: "XAI_API_KEY",
		displayName: "xAI"
	},
	mistral: {
		baseURL: "https://api.mistral.ai",
		apiKeyEnv: "MISTRAL_API_KEY",
		displayName: "Mistral"
	},
	groq: {
		baseURL: "https://api.groq.com/openai/v1",
		apiKeyEnv: "GROQ_API_KEY",
		displayName: "Groq"
	},
	cerebras: {
		baseURL: "https://api.cerebras.ai/v1",
		apiKeyEnv: "CEREBRAS_API_KEY",
		displayName: "Cerebras"
	},
	fireworks: {
		baseURL: "https://api.fireworks.ai/inference",
		apiKeyEnv: "FIREWORKS_API_KEY",
		displayName: "Fireworks"
	},
	together: {
		baseURL: "https://api.together.ai/v1",
		apiKeyEnv: "TOGETHER_API_KEY",
		displayName: "Together"
	},
	nvidia: {
		baseURL: "https://integrate.api.nvidia.com/v1",
		apiKeyEnv: "NVIDIA_API_KEY",
		displayName: "NVIDIA"
	},
	huggingface: {
		baseURL: "https://router.huggingface.co/v1",
		apiKeyEnv: "HF_TOKEN",
		displayName: "Hugging Face"
	},
	"github-copilot": {
		baseURL: "https://api.individual.githubcopilot.com",
		apiKeyEnv: "COPILOT_GITHUB_TOKEN",
		displayName: "GitHub Copilot"
	},
	"vercel-ai-gateway": {
		baseURL: "https://ai-gateway.vercel.sh",
		apiKeyEnv: "AI_GATEWAY_API_KEY",
		displayName: "Vercel AI Gateway"
	},
	"ant-ling": {
		baseURL: "https://api.ant-ling.com/v1",
		apiKeyEnv: "ANT_LING_API_KEY",
		displayName: "Ant Ling"
	},
	"ark-agent-plan": {
		baseURL: "https://ark.cn-beijing.volces.com/api/plan",
		apiKeyEnv: "ARK_AGENT_PLAN_API_KEY",
		displayName: "Volcengine Ark Agent Plan"
	},
	"ark-agent-plan-cn": {
		baseURL: "https://ark.cn-beijing.volces.com/api/plan",
		apiKeyEnv: "ARK_AGENT_PLAN_CN_API_KEY",
		displayName: "Volcengine Ark Agent Plan"
	},
	"ark-coding-plan": {
		baseURL: "https://ark.cn-beijing.volces.com/api/coding",
		apiKeyEnv: "ARK_CODING_PLAN_API_KEY",
		displayName: "Volcengine Ark Coding Plan"
	},
	"ark-coding-plan-cn": {
		baseURL: "https://ark.cn-beijing.volces.com/api/coding",
		apiKeyEnv: "ARK_CODING_PLAN_CN_API_KEY",
		displayName: "Volcengine Ark Coding Plan"
	},
	minimax: {
		baseURL: "https://api.minimax.io/anthropic",
		apiKeyEnv: "MINIMAX_API_KEY",
		displayName: "MiniMax"
	},
	"minimax-cn": {
		baseURL: "https://api.minimaxi.com/anthropic",
		apiKeyEnv: "MINIMAX_CN_API_KEY",
		displayName: "MiniMax CN"
	},
	zai: {
		baseURL: "https://api.z.ai/api/coding/paas/v4",
		apiKeyEnv: "ZAI_API_KEY",
		displayName: "Z.AI"
	},
	"zai-coding-cn": {
		baseURL: "https://open.bigmodel.cn/api/coding/paas/v4",
		apiKeyEnv: "ZAI_CODING_CN_API_KEY",
		displayName: "Z.AI Coding CN"
	},
	"qwen-token-plan": {
		baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
		apiKeyEnv: "QWEN_TOKEN_PLAN_API_KEY",
		displayName: "Qwen Token Plan"
	},
	"qwen-token-plan-cn": {
		baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
		apiKeyEnv: "QWEN_TOKEN_PLAN_CN_API_KEY",
		displayName: "Qwen Token Plan CN"
	},
	xiaomi: {
		baseURL: "https://api.xiaomimimo.com/v1",
		apiKeyEnv: "XIAOMI_API_KEY",
		displayName: "Xiaomi MiMo"
	},
	"xiaomi-token-plan-ams": {
		baseURL: "https://token-plan-ams.xiaomimimo.com/v1",
		apiKeyEnv: "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
		displayName: "Xiaomi Token Plan AMS"
	},
	"xiaomi-token-plan-cn": {
		baseURL: "https://token-plan-cn.xiaomimimo.com/v1",
		apiKeyEnv: "XIAOMI_TOKEN_PLAN_CN_API_KEY",
		displayName: "Xiaomi Token Plan CN"
	},
	"xiaomi-token-plan-sgp": {
		baseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
		apiKeyEnv: "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
		displayName: "Xiaomi Token Plan SGP"
	},
	opencode: {
		baseURL: "https://opencode.ai/zen/v1",
		apiKeyEnv: "OPENCODE_API_KEY",
		displayName: "OpenCode Zen"
	},
	"opencode-go": {
		baseURL: "https://opencode.ai/zen/go/v1",
		apiKeyEnv: "OPENCODE_API_KEY",
		displayName: "OpenCode Zen Go"
	},
	"azure-openai-responses": {
		apiKeyEnv: "AZURE_OPENAI_API_KEY",
		displayName: "Azure OpenAI"
	},
	"amazon-bedrock": {
		apiKeyEnv: "AWS_BEARER_TOKEN_BEDROCK",
		displayName: "Amazon Bedrock"
	},
	"cloudflare-workers-ai": { displayName: "Cloudflare Workers AI" },
	"cloudflare-ai-gateway": { displayName: "Cloudflare AI Gateway" }
};
/** Classify a provider endpoint by host; returns null for endpoints with no quota adapter. */
function kindOfBaseURL(baseURL) {
	for (const kind of PROVIDER_KINDS) if (ADAPTERS[kind].match.test(baseURL)) return kind;
	return null;
}
/**
* Whether a kind authenticates from refs it declares itself rather than from
* the route's key. Such a route is worth listing even when the settings
* profile names no `apiKeyEnv`, because its credential is resolved elsewhere.
*/
function ownsCredentials(kind) {
	return ADAPTERS[kind].credentialRefs !== void 0;
}
/**
* Best-effort human detail from a provider error body: Volcengine's OpenTOP
* `ResponseMetadata.Error` (whose `Code` carries the actionable part, e.g.
* `AccessDenied` or `InvalidAccessKey`), the OpenAI-shaped `error.message`,
* or a bare `message`/`msg`.
*/
function errorDetail(body) {
	const volc = body?.ResponseMetadata?.Error;
	if (volc !== null && typeof volc === "object") {
		const parts = [typeof volc.Code === "string" ? volc.Code : void 0, typeof volc.Message === "string" ? volc.Message : void 0].filter((part) => part !== void 0 && part !== "");
		if (parts.length > 0) return parts.join(": ");
	}
	const detail = body?.error?.message ?? body?.message ?? body?.msg;
	return typeof detail === "string" && detail !== "" ? detail : void 0;
}
/**
* GET a JSON endpoint, or POST one when `init` says so (the signed Volcengine
* plan RPCs do).
* @param apiKey - the route credential; omit it when `extraHeaders` already
*   carries the authorization (signed requests, `x-api-key` adapters).
*/
async function fetchJson(url, apiKey, signal, extraHeaders = {}, init = {}) {
	const hasAuth = Object.keys(extraHeaders).some((h) => {
		const lower = h.toLowerCase();
		return lower === "authorization" || lower === "x-api-key";
	});
	const response = await fetch(url, {
		method: init.method ?? "GET",
		headers: {
			accept: "application/json",
			...hasAuth || apiKey === void 0 ? {} : { authorization: `Bearer ${apiKey}` },
			...extraHeaders
		},
		...init.body === void 0 ? {} : { body: init.body },
		signal
	});
	const text = await response.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = void 0;
	}
	if (!response.ok) {
		const detail = errorDetail(body);
		throw new Error(`HTTP ${response.status}${detail === void 0 ? "" : `: ${detail}`}`);
	}
	return body;
}
/**
* POST one Volcengine plan RPC, retrying with an action alias only when the
* gateway does not know the primary name for this service version. The signed
* headers carry their own `Authorization`, so no Bearer key is attached.
*/
async function fetchVolcenginePlan(actions, credentials, signal) {
	const [accessKeyId, secretKey] = credentials ?? [];
	if (accessKeyId === void 0 || secretKey === void 0) throw new Error("Volcengine Ark plan quota needs an IAM AK/SK pair");
	let lastError;
	for (const action of actions) {
		const request = volcengineSignedRequest({
			accessKeyId,
			secretKey,
			action
		});
		try {
			return await fetchJson(request.url, void 0, signal, request.headers, {
				method: "POST",
				body: "{}"
			});
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("InvalidActionOrVersion")) throw error;
			lastError = error;
		}
	}
	throw lastError ?? /* @__PURE__ */ new Error("Volcengine Ark plan quota request failed");
}
function okView(base) {
	return {
		...base,
		status: "ok",
		message: null
	};
}
/** Retryable HTTP statuses below 500 (the whole 5xx range is retryable). */
const TRANSIENT_HTTP_STATUS = /* @__PURE__ */ new Set([
	408,
	425,
	429
]);
/**
* How long a "the stored Codex grant needs a new sign-in" verdict suppresses
* further token-endpoint calls. Long enough to stop a poll loop from hammering
* a dead grant, short enough to recover on its own from a misdiagnosis.
*/
const CODEX_REAUTH_BACKOFF_MS = 6e5;
/**
* Whether a failed provider query is worth retrying: per-attempt timeouts,
* undici network failures, HTTP 408/425/429/5xx (including OAuth refresh
* failures carrying `(HTTP <status>)`), and transient socket text. Permanent
* 4xx (400/401/403/404/422, e.g. a model-unsupported or invalid_grant reply)
* and adapter-side data errors fail immediately.
*/
function isTransientQueryError(error) {
	if (!(error instanceof Error)) return false;
	if (error.name === "TimeoutError" || error.name === "AbortError") return true;
	const status = Number(/HTTP (\d+)/.exec(error.message)?.[1] ?? NaN);
	if (Number.isFinite(status)) return status >= 500 || TRANSIENT_HTTP_STATUS.has(status);
	if (error instanceof TypeError) return true;
	return /\b(?:fetch failed|ECONN[A-Z]+|ETIMEDOUT|EAI_AGAIN|socket hang up|other side closed|premature close)\b/i.test(error.message);
}
/** Delay that resolves early (without throwing) when the outer signal aborts. */
function sleep(ms, signal) {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}
function failView(id, displayName, kind, status, message, active) {
	return {
		id,
		displayName,
		kind,
		status,
		message,
		balances: null,
		usages: null,
		active
	};
}
/** Strip trailing slashes from a route baseURL. */
function root(baseURL) {
	return baseURL.replace(/\/+$/, "");
}
const ADAPTERS = {
	deepseek: {
		view: "balance",
		match: /deepseek/i,
		async fetch(baseURL, apiKey, signal) {
			const body = await fetchJson(`${root(baseURL)}/user/balance`, apiKey, signal);
			return {
				balances: (Array.isArray(body?.balance_infos) ? body.balance_infos : []).map((info) => ({
					currency: String(info.currency ?? ""),
					total: String(info.total_balance ?? "0"),
					granted: String(info.granted_balance ?? "0"),
					toppedUp: String(info.topped_up_balance ?? "0")
				})),
				usages: null
			};
		}
	},
	"deepseek-account": {
		view: "balance",
		match: /platform\.deepseek\.com/i,
		async fetch(_baseURL, token, signal, _refresh, credentials) {
			const origin = root(credentials?.[0] ?? _baseURL);
			if (typeof token !== "string" || token === "") throw new Error("DeepSeek Account is not signed in");
			let body;
			try {
				body = await fetchJson(`${origin}/api/v0/users/get_user_summary`, void 0, signal, { "x-dsh-auth-token": token });
			} catch (error) {
				if (error instanceof Error && error.message.startsWith("HTTP 401")) throw new DeepSeekAccountAuthRequiredError();
				throw error;
			}
			const rows = parseAccountSummaryEnvelope(body);
			if (rows.length === 0) throw new Error("no wallet data in the account summary response");
			return {
				balances: rows,
				usages: null
			};
		}
	},
	"kimi-coding": {
		view: "usage",
		match: /api\.kimi\.com\/coding/i,
		headers: { "user-agent": "KimiCLI/1.6" },
		async fetch(baseURL, apiKey, signal) {
			const base = root(baseURL);
			const body = await fetchJson(base.endsWith("/v1") ? `${base}/usages` : `${base}/v1/usages`, apiKey, signal, this.headers);
			if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("unexpected usage response");
			const { usages, hasPlanData } = parseKimiUsages(body);
			if (usages.length > 0) return {
				balances: null,
				usages
			};
			if (!hasPlanData) throw new NoActiveSubscriptionError();
			throw new Error("no usage windows in the usage response");
		}
	},
	mistral: {
		view: "usage",
		match: /api\.mistral\.ai/i,
		async fetch(baseURL, apiKey, signal) {
			const base = root(baseURL);
			const billing = base.endsWith("/v1") ? `${base}/billing` : `${base}/v1/billing`;
			const budgetBody = await fetchJson(`${billing}/budget`, apiKey, signal);
			let subscriptionBody;
			try {
				subscriptionBody = await fetchJson(`${billing}/subscription`, apiKey, signal);
			} catch {
				subscriptionBody = void 0;
			}
			const { usages } = parseMistralUsage(budgetBody, subscriptionBody);
			if (usages.length > 0) return {
				balances: null,
				usages
			};
			throw new NoActiveSubscriptionError();
		}
	},
	moonshot: {
		view: "balance",
		match: /moonshot/i,
		async fetch(baseURL, apiKey, signal) {
			const data = (await fetchJson(`${root(baseURL)}/users/me/balance`, apiKey, signal))?.data ?? {};
			return {
				balances: [{
					currency: String(data.currency ?? "CNY"),
					total: String(data.available_balance ?? "0"),
					granted: String(data.voucher_balance ?? "0"),
					toppedUp: String(data.cash_balance ?? "0")
				}],
				usages: null
			};
		}
	},
	openrouter: {
		view: "usage",
		match: /openrouter\.ai/i,
		async fetch(baseURL, apiKey, signal) {
			const data = (await fetchJson(`${root(baseURL).replace(/\/api\/v1$/, "")}/api/v1/credits`, apiKey, signal))?.data ?? {};
			const limit = toNumber(data.total_credits);
			const used = toNumber(data.total_usage);
			return {
				balances: null,
				usages: [{
					label: "credits",
					used,
					limit,
					remaining: limit !== null && used !== null ? limit - used : null,
					percent: limit !== null && limit > 0 && used !== null ? used / limit * 100 : null,
					resetAt: null
				}]
			};
		}
	},
	"github-copilot": {
		view: "usage",
		match: /githubcopilot\.com|copilot/i,
		async fetch(_baseURL, apiKey, signal) {
			const body = await fetchJson("https://api.github.com/copilot_internal/user", apiKey, signal, {
				authorization: `token ${apiKey}`,
				"editor-version": "vscode/1.96.2",
				"editor-plugin-version": "copilot-chat/0.26.7",
				"user-agent": "GitHubCopilotChat/0.26.7",
				"x-github-api-version": "2025-04-01"
			});
			const rows = [];
			const resetAt = toResetAt(body?.quota_reset_date) ?? toResetAt(body?.limited_user_reset_date);
			const snapshots = body?.quota_snapshots;
			if (snapshots !== null && typeof snapshots === "object") for (const [key, snap] of Object.entries(snapshots)) {
				if (snap === null || typeof snap !== "object") continue;
				const entitlement = toNumber(snap.entitlement);
				const remaining = toNumber(snap.remaining);
				if (entitlement === null && remaining === null) continue;
				const percentRemaining = toNumber(snap.percent_remaining);
				const used = entitlement !== null && remaining !== null ? entitlement - remaining : null;
				const percent = percentRemaining !== null ? 100 - percentRemaining : entitlement !== null && entitlement > 0 && used !== null ? used / entitlement * 100 : null;
				rows.push({
					label: String(snap.quota_id ?? key),
					used,
					limit: entitlement,
					remaining,
					percent,
					resetAt
				});
			}
			else {
				const limited = body?.limited_user_quotas ?? {};
				const monthly = body?.monthly_quotas ?? {};
				for (const key of ["chat", "completions"]) {
					const limit = toNumber(monthly[key]);
					const remaining = toNumber(limited[key]);
					if (limit === null && remaining === null) continue;
					const used = limit !== null && remaining !== null ? limit - remaining : null;
					rows.push({
						label: key,
						used,
						limit,
						remaining,
						percent: limit !== null && limit > 0 && used !== null ? used / limit * 100 : null,
						resetAt
					});
				}
			}
			return {
				balances: null,
				usages: rows
			};
		}
	},
	"openai-codex": {
		view: "usage",
		match: /chatgpt\.com\/backend-api/i,
		headers: {
			originator: "pi",
			"user-agent": `dsh-provider-usage/${version}`
		},
		async fetch(baseURL, apiKey, signal, refresh) {
			const headers = (token) => {
				const accountId = openAiCodexAccountId(token);
				if (accountId === null) throw new Error("OpenAI Codex OAuth token has no ChatGPT account id");
				return {
					"chatgpt-account-id": accountId,
					...this.headers
				};
			};
			const attempt = async (token) => {
				return await fetchJson(`${root(baseURL)}/wham/usage`, token, signal, headers(token));
			};
			let body;
			try {
				body = await attempt(apiKey);
			} catch (error) {
				if (!((error instanceof Error ? Number(/^HTTP (\d+)/.exec(error.message)?.[1] ?? NaN) : NaN) === 401 && refresh !== void 0)) throw error;
				body = await attempt(await refresh(signal));
			}
			const rows = [];
			const windowRow = (label, win) => {
				if (win === null || typeof win !== "object") return;
				const percent = toNumber(win.used_percent);
				if (percent === null) return;
				rows.push({
					label,
					used: percent,
					limit: 100,
					remaining: 100 - percent,
					percent,
					resetAt: toResetAt(win.reset_at)
				});
			};
			windowRow("5h limit", body?.rate_limit?.primary_window);
			windowRow("weekly", body?.rate_limit?.secondary_window);
			const extra = body?.additional_rate_limits;
			if (Array.isArray(extra)) for (const item of extra) windowRow(String(item?.limit_name ?? item?.metered_feature ?? "limit"), item?.rate_limit?.primary_window);
			const credits = body?.credits;
			if (credits !== null && typeof credits === "object") {
				const balance = toNumber(credits.balance);
				if (balance !== null) rows.push({
					label: "credits",
					used: null,
					limit: null,
					remaining: balance,
					percent: null,
					resetAt: null
				});
			}
			const spend = body?.spend_control?.individual_limit;
			if (spend !== null && typeof spend === "object") {
				const spendLimit = toNumber(spend.limit);
				const spendUsed = toNumber(spend.used);
				const spendRemaining = toNumber(spend.remaining);
				if (spendLimit !== null || spendUsed !== null || spendRemaining !== null) rows.push({
					label: "spend control",
					used: spendUsed,
					limit: spendLimit,
					remaining: spendRemaining,
					percent: spendLimit !== null && spendLimit > 0 && spendUsed !== null ? spendUsed / spendLimit * 100 : null,
					resetAt: toResetAt(spend.reset_at)
				});
			}
			return {
				balances: null,
				usages: orderUsageRows(rows)
			};
		}
	},
	openai: {
		view: "usage",
		match: /api\.openai\.com/i,
		async fetch(baseURL, apiKey, signal) {
			const base = root(baseURL).replace(/\/v1$/, "");
			const monthStart = /* @__PURE__ */ new Date();
			monthStart.setUTCDate(1);
			monthStart.setUTCHours(0, 0, 0, 0);
			const body = await fetchJson(`${base}/v1/organization/costs?start_time=${Math.floor(monthStart.getTime() / 1e3)}`, apiKey, signal);
			let total = 0;
			let currency = "USD";
			for (const bucket of body?.data ?? []) for (const result of bucket?.results ?? []) {
				total += toNumber(result?.amount?.value) ?? 0;
				if (result?.amount?.currency) currency = String(result.amount.currency).toUpperCase();
			}
			return {
				balances: null,
				usages: [{
					label: `month spend (${currency})`,
					used: total,
					limit: null,
					remaining: null,
					percent: null,
					resetAt: null
				}]
			};
		}
	},
	anthropic: {
		view: "usage",
		match: /api\.anthropic\.com/i,
		async fetch(baseURL, apiKey, signal) {
			const monthStart = /* @__PURE__ */ new Date();
			monthStart.setUTCDate(1);
			monthStart.setUTCHours(0, 0, 0, 0);
			const body = await fetchJson(`${root(baseURL)}/v1/organizations/cost_report?starting_at=${encodeURIComponent(monthStart.toISOString())}`, apiKey, signal, {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01"
			});
			let total = 0;
			let currency = "USD";
			for (const bucket of body?.data ?? []) for (const result of bucket?.results ?? []) {
				total += toNumber(result?.amount) ?? 0;
				if (result?.currency) currency = String(result.currency).toUpperCase();
			}
			return {
				balances: null,
				usages: [{
					label: `month spend (${currency})`,
					used: total,
					limit: null,
					remaining: null,
					percent: null,
					resetAt: null
				}]
			};
		}
	},
	minimax: {
		view: "usage",
		match: /minimax/i,
		async fetch(baseURL, apiKey, signal) {
			const origin = new URL(baseURL).origin;
			const body = await fetchJson(`${origin}/v1/api/openplatform/coding_plan/remains`, apiKey, signal);
			const statusCode = toNumber(body?.base_resp?.status_code);
			if (statusCode !== null && statusCode !== 0) throw new Error(String(body?.base_resp?.status_msg ?? `MiniMax API error ${statusCode}`));
			const rows = [];
			const remains = Array.isArray(body?.model_remains) ? body.model_remains : [];
			const general = remains.find((item) => item?.model_name === "general") ?? remains[0];
			if (general !== null && typeof general === "object") {
				const intervalRemaining = toNumber(general.current_interval_remaining_percent);
				if (intervalRemaining !== null) rows.push({
					label: "5h limit",
					used: 100 - intervalRemaining,
					limit: 100,
					remaining: intervalRemaining,
					percent: 100 - intervalRemaining,
					resetAt: toResetAt(general.end_time)
				});
				if (toNumber(general.current_weekly_status) === 1) {
					const weeklyRemaining = toNumber(general.current_weekly_remaining_percent);
					if (weeklyRemaining !== null) rows.push({
						label: "weekly",
						used: 100 - weeklyRemaining,
						limit: 100,
						remaining: weeklyRemaining,
						percent: 100 - weeklyRemaining,
						resetAt: toResetAt(general.weekly_end_time)
					});
				}
			}
			return {
				balances: null,
				usages: orderUsageRows(rows)
			};
		}
	},
	zai: {
		view: "usage",
		match: /api\.z\.ai|bigmodel\.cn/i,
		async fetch(baseURL, apiKey, signal) {
			const origin = new URL(baseURL).origin;
			const body = await fetchJson(`${origin}/api/monitor/usage/quota/limit`, apiKey, signal, {
				authorization: apiKey,
				"content-type": "application/json",
				"accept-language": "en-US,en"
			});
			if (body?.success === false) throw new Error(String(body?.msg ?? body?.message ?? "z.ai quota query failed"));
			const tokenLimits = (Array.isArray(body?.data?.limits) ? body.data.limits : []).filter((item) => item?.type === "TOKENS_LIMIT").sort((a, b) => (toNumber(a?.nextResetTime) ?? Infinity) - (toNumber(b?.nextResetTime) ?? Infinity));
			const rows = [];
			tokenLimits.forEach((item, index) => {
				const percent = toNumber(item?.percentage);
				if (percent === null) return;
				rows.push({
					label: index === 0 ? "5h limit" : index === 1 ? "weekly" : `limit ${index + 1}`,
					used: percent,
					limit: 100,
					remaining: 100 - percent,
					percent,
					resetAt: toResetAt(item?.nextResetTime)
				});
			});
			return {
				balances: null,
				usages: orderUsageRows(rows)
			};
		}
	},
	opencode: {
		view: "usage",
		match: /opencode\.ai/i,
		async fetch(baseURL, apiKey, signal) {
			const base = root(baseURL);
			const body = await fetchJson(base.endsWith("/v1") ? `${base}/usage` : `${base}/v1/usage`, apiKey, signal);
			const rows = [];
			const windows = [
				["5h limit", body?.usage?.rolling],
				["weekly", body?.usage?.weekly],
				["monthly", body?.usage?.monthly]
			];
			for (const [label, win] of windows) {
				if (win === null || typeof win !== "object") continue;
				const percent = toNumber(win.percent);
				if (percent === null) continue;
				rows.push({
					label,
					used: percent,
					limit: 100,
					remaining: 100 - percent,
					percent,
					resetAt: toResetAt(win.resetsAt ?? win.resets_at)
				});
			}
			return {
				balances: null,
				usages: orderUsageRows(rows)
			};
		}
	},
	"vercel-ai-gateway": {
		view: "balance",
		match: /ai-gateway\.vercel\.sh/i,
		async fetch(baseURL, apiKey, signal) {
			const base = root(baseURL);
			const balance = (await fetchJson(base.endsWith("/v1") ? `${base}/credits` : `${base}/v1/credits`, apiKey, signal))?.balance;
			if (balance === void 0 || balance === null) throw new Error("no balance in the credits response");
			return {
				balances: [{
					currency: "USD",
					total: String(balance),
					granted: "0",
					toppedUp: "0"
				}],
				usages: null
			};
		}
	},
	xai: {
		view: "balance",
		match: /x\.ai/i,
		async fetch(baseURL, apiKey, signal) {
			const base = root(baseURL);
			const cents = toNumber((await fetchJson(/management-api\.x\.ai/i.test(base) ? `${base}/prepaid/balance` : `${base}/billing/credits`, apiKey, signal))?.total?.val);
			if (cents === null) throw new Error("no balance data in the billing response");
			const balance = (Math.abs(cents) / 100).toFixed(2);
			return {
				balances: [{
					currency: "USD",
					total: balance,
					granted: "0",
					toppedUp: balance
				}],
				usages: null
			};
		}
	},
	"volcengine-ark-agent": {
		view: "usage",
		match: /volces\.com\/api\/plan/i,
		credentialRefs: [ACCESS_KEY_REFS, SECRET_KEY_REFS],
		async fetch(_baseURL, _apiKey, signal, _refresh, credentials) {
			return {
				balances: null,
				usages: parseAgentPlanUsage(await fetchVolcenginePlan(AGENT_PLAN_ACTIONS, credentials, signal))
			};
		}
	},
	"volcengine-ark-coding": {
		view: "usage",
		match: /volces\.com\/api\/coding/i,
		credentialRefs: [ACCESS_KEY_REFS, SECRET_KEY_REFS],
		async fetch(_baseURL, _apiKey, signal, _refresh, credentials) {
			return {
				balances: null,
				usages: parseCodingPlanUsage(await fetchVolcenginePlan(CODING_PLAN_ACTIONS, credentials, signal))
			};
		}
	}
};
var UsageService = class extends TypertRemoteService {
	options;
	/**
	* Latched when upstream refuses the stored Codex refresh token. Keyed by the
	* dead token so a new authorization clears it with nothing to reset, and
	* time-boxed so a repaired credential is picked up even without a re-login.
	*/
	codexReauth;
	/** Latched so a host-seam report lands once per process, not once per poll. */
	hostSeamsProbed = false;
	constructor(ctx, options) {
		super(ctx, "usage");
		this.options = options;
	}
	/**
	* Fetch the live quota snapshot of every configured provider.
	* @param signal - optional cancellation signal carried over the RPC carrier.
	*/
	async list(signal) {
		this.reportMissingHostSeams();
		const specs = await this.collectSpecs();
		const activeProviderId = this.currentProviderId();
		const providers = await Promise.all(specs.map((spec) => this.fetchProvider(spec, activeProviderId, signal)));
		return {
			fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
			refreshSeconds: this.options().refreshSeconds,
			balanceRedThreshold: this.options().balanceRedThreshold,
			balanceYellowThreshold: this.options().balanceYellowThreshold,
			version,
			providers
		};
	}
	/**
	* Name the host seams this runtime no longer provides, once per process.
	*
	* The probe runs on the first query rather than at mount: Cordis provisions
	* services asynchronously, so `apply` can legitimately run before `llm` or
	* `credentials` exists, and judging them there would condemn a healthy
	* composition. By the first poll they are settled, so this line is what tells
	* a later reader that a card reading "no API key configured" actually meant
	* "this host has no credentials service" (see {@link missingHostSeams}).
	*/
	reportMissingHostSeams() {
		if (this.hostSeamsProbed) return;
		this.hostSeamsProbed = true;
		const read = (name) => {
			try {
				return this.ctx.get(name);
			} catch {
				return;
			}
		};
		const missing = missingHostSeams({
			credentials: read("credentials"),
			llm: read("llm")
		});
		if (missing.length === 0) return;
		this.ctx.logger?.warn?.(`provider-usage: this dsh provides no ${missing.join(", ")}; quota queries stay degraded until it does`);
	}
	/**
	* The provider route in use: the harness's current default model selection,
	* kept in sync whenever the composer's model seat selects a provider/model
	* (`session/selectModel` → `agent-default-model` settings). Null when the
	* service is not mounted or no selection is stored yet — the client then
	* falls back to judging every provider.
	*/
	currentProviderId() {
		const provider = this.ctx.get("agentDefaultModel")?.currentSelection?.().provider;
		return typeof provider === "string" && provider !== "" ? provider : null;
	}
	/** Enumerate provider routes (registry + settings), then apply manual overrides. */
	async collectSpecs() {
		const options = this.options();
		const specs = [];
		if (options.autoDetect) {
			const llm = this.ctx.get("llm");
			const settings = this.ctx.get("settings");
			const routes = llm?.listProviders?.() ?? [];
			for (const route of routes) {
				const spec = await this.resolveRoute(route, settings, llm);
				if (await isUnusedAccountRoute("unsupported" in spec ? void 0 : spec.kind, () => this.resolveDeepSeekAccountGrant())) continue;
				specs.push(spec);
			}
		}
		for (const extra of options.providers) {
			if (!extra.enabled) continue;
			const spec = {
				id: extra.id,
				displayName: extra.displayName || extra.id,
				kind: extra.kind,
				baseURL: extra.baseURL,
				apiKeyEnv: extra.apiKeyEnv
			};
			const index = specs.findIndex((existing) => !("unsupported" in existing) && existing.id === spec.id);
			if (index < 0) specs.push(spec);
			else specs[index] = spec;
		}
		return specs;
	}
	/**
	* Read one foreign plugin's live config section (see {@link readLiveSection}).
	* `configEditor` is fetched lazily and defensively: it appeared in the same
	* generation that removed the legacy `settings.get`, and an unavailable
	* service must degrade to "no section", never break the query.
	*/
	async readSection(settings, ns) {
		let configEditor;
		try {
			configEditor = this.ctx.get("configEditor");
		} catch {
			configEditor = void 0;
		}
		return readLiveSection(settings, configEditor, ns);
	}
	async resolveRoute(route, settings, llm) {
		const known = KNOWN_ROUTES[route.id];
		let baseURL;
		let apiKeyEnv;
		if (route.id === "deepseek-account") return {
			id: route.id,
			displayName: route.name || known?.displayName || route.id,
			kind: "deepseek-account",
			baseURL: known?.baseURL ?? "https://platform.deepseek.com"
		};
		if (route.id === "deepseek-official") {
			const section = await this.readSection(settings, "llm-deepseek");
			baseURL = section?.baseURL ?? launchEnvironmentOf(this.ctx).get("DEEPSEEK_BASE_URL")?.value ?? known?.baseURL;
			apiKeyEnv = section?.apiKeyEnv ?? known?.apiKeyEnv;
		} else {
			const profile = (await this.readSection(settings, settingsNsForRoute(llm, route.id)))?.providers?.[route.id];
			baseURL = profile?.baseURL ?? known?.baseURL;
			apiKeyEnv = profile?.apiKeyEnv ?? known?.apiKeyEnv;
		}
		if (baseURL !== void 0) {
			const kind = kindOfBaseURL(baseURL);
			if (kind !== null && (apiKeyEnv !== void 0 || kind === "openai-codex" || ownsCredentials(kind))) return {
				id: route.id,
				displayName: route.name || known?.displayName || route.id,
				kind,
				baseURL,
				...apiKeyEnv === void 0 ? {} : { apiKeyEnv }
			};
		}
		return {
			unsupported: true,
			route
		};
	}
	async resolveApiKey(ref) {
		const credentials = this.ctx.get("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(credentialRef(ref));
			if (hit !== void 0 && hit.value.length > 0) return hit.value;
			return;
		}
		const ambient = launchEnvironmentOf(this.ctx).get(ref);
		if (ambient !== void 0 && ambient.value.length > 0) return ambient.value;
	}
	/**
	* Resolve the Codex OAuth grant from the harness credential records,
	* refreshing it when close to expiry. The rotation itself runs inside the
	* credential store's exclusive lock (see {@link resolveOpenAiCodexGrant}),
	* and a grant upstream has already invalidated latches a re-auth verdict so
	* later polls report "sign in again" instead of spending a doomed round trip
	* on the token endpoint every interval.
	*/
	async resolveOpenAiCodexGrant(signal) {
		const credentials = this.ctx.get("credentials");
		if (credentials === void 0) return void 0;
		const key = credentialKey("llm-pi-ai", "openai-codex");
		const latched = this.codexReauth;
		if (latched !== void 0) {
			const record = await credentials.readRecord(key);
			const current = record === void 0 || record.kind !== "grant" ? null : parseOpenAiCodexGrant(record.payload);
			if (current !== null && current.refresh === latched.refreshToken && Date.now() < latched.until) throw new OpenAiCodexReauthRequiredError(latched.message, latched.refreshToken);
			this.codexReauth = void 0;
		}
		try {
			const toRecord = (grant) => ({
				kind: "grant",
				payload: grant
			});
			return await resolveOpenAiCodexGrant(credentials, key, toRecord, signal);
		} catch (error) {
			if (error instanceof OpenAiCodexReauthRequiredError) this.codexReauth = {
				refreshToken: error.refreshToken,
				message: error.message,
				until: Date.now() + CODEX_REAUTH_BACKOFF_MS
			};
			throw error;
		}
	}
	/**
	* Read the DeepSeek Account grant the harness's account platform persists
	* after the browser PKCE sign-in (`deepseek-account-platform/default`). The
	* token is long-lived and replaced only by another sign-in — there is no
	* refresh — so resolution is a plain record read. The grant's `issuer` (the
	* configured platformOrigin) travels with the token because the balance
	* endpoint answers only there.
	*/
	async resolveDeepSeekAccountGrant() {
		const credentials = this.ctx.get("credentials");
		if (credentials === void 0) return void 0;
		const record = await credentials.readRecord(DEEPSEEK_ACCOUNT_CREDENTIAL_KEY);
		if (record === void 0 || record.kind !== "grant") return void 0;
		return parseDeepSeekAccountGrant(record.payload) ?? void 0;
	}
	async fetchProvider(spec, activeProviderId, outerSignal) {
		if ("unsupported" in spec) return failView(spec.route.id, spec.route.name || spec.route.id, null, "unsupported", spec.route.id, spec.route.id === activeProviderId);
		const active = spec.id === activeProviderId;
		const adapter = ADAPTERS[spec.kind];
		const base = {
			id: spec.id,
			displayName: spec.displayName,
			kind: adapter.view,
			balances: null,
			usages: null,
			active
		};
		const options = this.options();
		const maxAttempts = options.queryRetries + 1;
		for (let attempt = 1;; attempt++) {
			const signal = AbortSignal.any([AbortSignal.timeout(options.queryTimeoutMs), ...outerSignal ? [outerSignal] : []]);
			try {
				let apiKey;
				let refresh;
				let credentials;
				if (adapter.credentialRefs !== void 0) {
					const slots = [];
					for (const slot of adapter.credentialRefs) {
						let hit;
						for (const ref of slot) {
							hit = await this.resolveApiKey(ref);
							if (hit !== void 0) break;
						}
						if (hit === void 0) {
							const hint = adapter.credentialRefs.map((candidates) => candidates[0]).join(" + ");
							return failView(spec.id, spec.displayName, adapter.view, "missing-credential", hint, active);
						}
						slots.push(hit);
					}
					credentials = slots;
					apiKey = slots[0];
				} else if (spec.kind === "openai-codex" && spec.apiKeyEnv === void 0) {
					let resolved;
					const grant = () => resolved ??= this.resolveOpenAiCodexGrant(signal);
					refresh = async (refreshSignal) => {
						const current = await (refreshSignal === signal ? grant() : this.resolveOpenAiCodexGrant(refreshSignal));
						if (current === void 0) throw new Error("OpenAI Codex OAuth authorization missing");
						return current.access;
					};
					const current = await grant();
					if (current === void 0) return failView(spec.id, spec.displayName, adapter.view, "missing-authorization", "llm-pi-ai/openai-codex", active);
					apiKey = current.access;
				} else if (spec.kind === "deepseek-account") {
					const grant = await this.resolveDeepSeekAccountGrant();
					if (grant === void 0) return failView(spec.id, spec.displayName, adapter.view, "missing-authorization", "DeepSeek Account", active);
					apiKey = grant.token;
					credentials = [grant.issuer];
				} else {
					const resolved = await this.resolveApiKey(spec.apiKeyEnv);
					if (resolved === void 0) return failView(spec.id, spec.displayName, adapter.view, "missing-credential", spec.apiKeyEnv, active);
					apiKey = resolved;
				}
				const payload = await adapter.fetch(spec.baseURL, apiKey, signal, refresh, credentials);
				return okView({
					...base,
					...payload
				});
			} catch (error) {
				if (outerSignal?.aborted) throw error;
				const message = error instanceof Error ? error.message : String(error);
				if (error instanceof OpenAiCodexReauthRequiredError) return failView(spec.id, spec.displayName, adapter.view, "reauth-required", message, active);
				if (error instanceof DeepSeekAccountAuthRequiredError) return failView(spec.id, spec.displayName, adapter.view, "reauth-required", message, active);
				if (error instanceof NoActiveSubscriptionError) return failView(spec.id, spec.displayName, adapter.view, "no-subscription", null, active);
				if (attempt >= maxAttempts || !isTransientQueryError(error)) return failView(spec.id, spec.displayName, adapter.view, "error", message, active);
				await sleep(Math.min(options.queryRetryDelayMs * 2 ** (attempt - 1), 1e4), outerSignal);
			}
		}
	}
};
/**
* Apply the standard-decorator Remote marker without decorator syntax (the
* bundle targets Node 22, which cannot parse decorator syntax). The marker
* table is keyed by prototype, so running the recorded initializer once
* against a prototype-chained pseudo instance registers the method for every
* future service instance (`remoteMethods` reads `Object.getPrototypeOf`).
*/
function markRemoteMethod(prototype, method, exportName) {
	const initializers = [];
	Remote(exportName)(void 0, {
		kind: "method",
		name: method,
		static: false,
		private: false,
		addInitializer: (fn) => {
			initializers.push(fn);
		}
	});
	const pseudo = Object.create(prototype);
	for (const initializer of initializers) initializer.call(pseudo);
}
markRemoteMethod(UsageService.prototype, "list", "list");
function apply(ctx, config) {
	let current = () => config;
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings?.installSection?.(ctx, NS, Config, config, {
			setSource: (source) => {
				current = source;
			},
			onChange: () => {}
		});
	});
	new UsageService(ctx, () => current());
}
//#endregion
export { Config, UsageService, apply, name, version };
