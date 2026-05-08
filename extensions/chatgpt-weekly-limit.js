/**
 * Show ChatGPT Pro/Codex weekly usage percentage inline in pi's footer.
 *
 * Uses ChatGPT's usage endpoint:
 *   GET https://chatgpt.com/backend-api/wham/usage
 */

import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"

const CHATGPT_BASE_URL = (
  process.env.CHATGPT_BASE_URL || "https://chatgpt.com/backend-api"
).replace(/\/+$/, "")
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth"
const OPENAI_PROFILE_CLAIM = "https://api.openai.com/profile"
const FIVE_HOUR_SECONDS = 5 * 60 * 60
const WEEK_SECONDS = 7 * 24 * 60 * 60
const CONFIG_ENTRY_TYPE = "chatgpt-limit-config"

const DEFAULT_FOOTER_CONFIG = {
  quotaWindow: "weekly",
  displayMode: "used",
}

const QUOTA_WINDOW_OPTIONS = [
  { label: "Weekly usage (default)", value: "weekly" },
  { label: "5-hour usage", value: "fiveHour" },
  { label: "Both 5-hour and weekly", value: "both" },
  { label: "Hide usage from footer", value: "hidden" },
]

const DISPLAY_MODE_OPTIONS = [
  { label: "Used percent, e.g. W 42%", value: "used" },
  { label: "Remaining percent, e.g. W 58% left", value: "remaining" },
  { label: "Compact with reset, e.g. W 42% · ~2d", value: "compact" },
]

let usageSnapshot
let footerConfig = { ...DEFAULT_FOOTER_CONFIG }
let refreshTimer
let requestRender = () => {}

/** @param {string | undefined} provider */
function isOpenAICodexProvider(provider) {
  return (
    provider === "openai-codex" || /^openai-codex-\d+$/.test(provider || "")
  )
}

/** @param {number} count */
function formatTokens(count) {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

/** @param {string} token */
function decodeJwtPayload(token) {
  const parts = token.split(".")
  if (parts.length < 2) return {}

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  } catch {
    return {}
  }
}

/** @param {string} token */
function getTokenMetadata(token) {
  const payload = decodeJwtPayload(token)
  const auth =
    payload && typeof payload === "object"
      ? payload[OPENAI_AUTH_CLAIM]
      : undefined
  const profile =
    payload && typeof payload === "object"
      ? payload[OPENAI_PROFILE_CLAIM]
      : undefined

  return {
    accountId:
      auth && typeof auth.chatgpt_account_id === "string"
        ? auth.chatgpt_account_id
        : undefined,
    planType:
      auth && typeof auth.chatgpt_plan_type === "string"
        ? auth.chatgpt_plan_type
        : undefined,
    email:
      profile && typeof profile.email === "string" ? profile.email : undefined,
  }
}

/** @param {unknown} value */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined
}

/** @param {unknown} value */
function normalizeWindow(value) {
  const record = asRecord(value)
  if (!record) return undefined

  const usedPercent =
    typeof record.used_percent === "number" ? record.used_percent : undefined
  const windowSeconds =
    typeof record.limit_window_seconds === "number"
      ? record.limit_window_seconds
      : undefined
  const resetAt =
    typeof record.reset_at === "number" ? record.reset_at : undefined

  if (usedPercent === undefined || windowSeconds === undefined) return undefined
  return { usedPercent, windowSeconds, resetAt }
}

/** @param {unknown} data */
function parseUsageSnapshot(data) {
  const raw = asRecord(data)
  const rateLimit = asRecord(raw?.rate_limit)
  const windows = [
    normalizeWindow(rateLimit?.primary_window),
    normalizeWindow(rateLimit?.secondary_window),
  ].filter(Boolean)

  return {
    planType: typeof raw?.plan_type === "string" ? raw.plan_type : undefined,
    email: typeof raw?.email === "string" ? raw.email : undefined,
    fiveHour: windows.find(
      (window) => Math.abs(window.windowSeconds - FIVE_HOUR_SECONDS) <= 120,
    ),
    weekly: windows.find(
      (window) => Math.abs(window.windowSeconds - WEEK_SECONDS) <= 120,
    ),
    fetchedAt: Date.now(),
  }
}

/** @param {{ usedPercent: number } | undefined} window */
function formatUsedPercent(window) {
  if (!window) return "?%"
  return `${Math.round(Math.max(0, Math.min(100, window.usedPercent)))}%`
}

/** @param {{ usedPercent: number } | undefined} window */
function formatRemainingPercent(window) {
  if (!window) return "?%"
  return `${Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent)))}%`
}

/** @param {number | undefined} resetAt */
function formatResetShort(resetAt) {
  if (!resetAt) return "?"

  const minutes = Math.max(0, Math.round((resetAt * 1000 - Date.now()) / 60000))
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)

  if (days > 0) return `~${days}d`
  if (hours > 0) return `~${hours}h`
  return `~${minutes}m`
}

/** @param {number | undefined} resetAt */
function formatResetLong(resetAt) {
  if (!resetAt) return "unknown"

  const minutes = Math.max(0, Math.round((resetAt * 1000 - Date.now()) / 60000))
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const mins = minutes % 60

  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${mins}m`
  return `in ${mins}m`
}

function normalizeFooterConfig(value) {
  const record = asRecord(value)
  const quotaWindow = QUOTA_WINDOW_OPTIONS.some(
    (option) => option.value === record?.quotaWindow,
  )
    ? record.quotaWindow
    : DEFAULT_FOOTER_CONFIG.quotaWindow
  const displayMode = DISPLAY_MODE_OPTIONS.some(
    (option) => option.value === record?.displayMode,
  )
    ? record.displayMode
    : DEFAULT_FOOTER_CONFIG.displayMode

  return { quotaWindow, displayMode }
}

function restoreFooterConfig(ctx) {
  footerConfig = { ...DEFAULT_FOOTER_CONFIG }
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === CONFIG_ENTRY_TYPE) {
      footerConfig = normalizeFooterConfig(entry.data)
    }
  }
}

function describeFooterConfig() {
  const quotaWindow = QUOTA_WINDOW_OPTIONS.find(
    (option) => option.value === footerConfig.quotaWindow,
  )
  const displayMode = DISPLAY_MODE_OPTIONS.find(
    (option) => option.value === footerConfig.displayMode,
  )
  return `${quotaWindow?.label || "Weekly usage"}; ${displayMode?.label || "Used percent"}`
}

function saveFooterConfig(pi, nextConfig) {
  footerConfig = normalizeFooterConfig(nextConfig)
  pi.appendEntry(CONFIG_ENTRY_TYPE, footerConfig)
  requestRender()
}

/** @param {import('@mariozechner/pi-ai').AssistantMessage['usage']} usage */
function addUsage(total, usage) {
  total.input += usage?.input ?? 0
  total.output += usage?.output ?? 0
  total.cacheRead += usage?.cacheRead ?? 0
  total.cacheWrite += usage?.cacheWrite ?? 0
  total.cost += usage?.cost?.total ?? 0
}

function formatFooterUsagePart(label, window) {
  if (!window) return undefined

  if (footerConfig.displayMode === "remaining") {
    return `${label} ${formatRemainingPercent(window)} left`
  }

  const used = formatUsedPercent(window)
  if (footerConfig.displayMode === "compact") {
    return `${label} ${used} · ${formatResetShort(window.resetAt)}`
  }

  return `${label} ${used}`
}

function formatFooterUsage() {
  if (footerConfig.quotaWindow === "hidden") return undefined

  const parts = []
  if (
    footerConfig.quotaWindow === "fiveHour" ||
    footerConfig.quotaWindow === "both"
  ) {
    const part = formatFooterUsagePart("5h", usageSnapshot?.fiveHour)
    if (part) parts.push(part)
  }
  if (
    footerConfig.quotaWindow === "weekly" ||
    footerConfig.quotaWindow === "both"
  ) {
    const part = formatFooterUsagePart("W", usageSnapshot?.weekly)
    if (part) parts.push(part)
  }

  return parts.length > 0 ? parts.join(" / ") : undefined
}

function getHighestDisplayedUsagePercent() {
  const values = []
  if (
    footerConfig.quotaWindow === "fiveHour" ||
    footerConfig.quotaWindow === "both"
  ) {
    values.push(usageSnapshot?.fiveHour?.usedPercent)
  }
  if (
    footerConfig.quotaWindow === "weekly" ||
    footerConfig.quotaWindow === "both"
  ) {
    values.push(usageSnapshot?.weekly?.usedPercent)
  }

  return Math.max(
    0,
    ...values
      .filter((value) => typeof value === "number")
      .map((value) => Math.max(0, Math.min(100, value))),
  )
}

function renderFooter(pi, ctx, footerData, theme, width) {
  const model = ctx.model

  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      addUsage(total, entry.message.usage)
    }
  }

  const contextUsage = ctx.getContextUsage()
  const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0
  const contextPercentValue = contextUsage?.percent ?? 0
  const contextPercent =
    contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?"

  let pwd = ctx.sessionManager.getCwd()
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`

  const branch = footerData.getGitBranch()
  if (branch) pwd = `${pwd} (${branch})`

  const sessionName = ctx.sessionManager.getSessionName()
  if (sessionName) pwd = `${pwd} • ${sessionName}`

  const statsParts = []
  if (total.input) statsParts.push(`↑${formatTokens(total.input)}`)
  if (total.output) statsParts.push(`↓${formatTokens(total.output)}`)
  if (total.cacheRead) statsParts.push(`R${formatTokens(total.cacheRead)}`)
  if (total.cacheWrite) statsParts.push(`W${formatTokens(total.cacheWrite)}`)

  const usingSubscription = model
    ? ctx.modelRegistry.isUsingOAuth(model)
    : false
  if (total.cost || usingSubscription)
    statsParts.push(
      `$${total.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
    )

  const contextDisplay =
    contextPercent === "?"
      ? `?/${formatTokens(contextWindow)}`
      : `${contextPercent}%/${formatTokens(contextWindow)}`
  const contextColored =
    contextPercentValue > 90
      ? theme.fg("error", contextDisplay)
      : contextPercentValue > 70
        ? theme.fg("warning", contextDisplay)
        : contextDisplay
  statsParts.push(contextColored)

  let statsLeft = statsParts.join(" ")
  let statsLeftWidth = visibleWidth(statsLeft)
  if (statsLeftWidth > width) {
    statsLeft = truncateToWidth(statsLeft, width, "...")
    statsLeftWidth = visibleWidth(statsLeft)
  }

  const modelName = model?.id || "no-model"
  let rightSideWithoutProvider = modelName
  if (model?.reasoning) {
    const thinkingLevel = pi.getThinkingLevel ? pi.getThinkingLevel() : "off"
    rightSideWithoutProvider =
      thinkingLevel === "off"
        ? `${modelName} • thinking off`
        : `${modelName} • ${thinkingLevel}`
  }

  if (isOpenAICodexProvider(model?.provider)) {
    const footerUsage = formatFooterUsage()
    if (footerUsage) {
      const used = getHighestDisplayedUsagePercent()
      const color = used >= 90 ? "error" : used >= 70 ? "muted" : "dim"
      rightSideWithoutProvider += ` • ${theme.fg(color, footerUsage)}`
    }
  }

  let rightSide = rightSideWithoutProvider
  if (footerData.getAvailableProviderCount() > 1 && model) {
    rightSide = `(${model.provider}) ${rightSideWithoutProvider}`
    if (statsLeftWidth + 2 + visibleWidth(rightSide) > width)
      rightSide = rightSideWithoutProvider
  }

  const rightSideWidth = visibleWidth(rightSide)
  const minPadding = 2
  let statsLine
  if (statsLeftWidth + minPadding + rightSideWidth <= width) {
    statsLine =
      statsLeft +
      " ".repeat(width - statsLeftWidth - rightSideWidth) +
      rightSide
  } else {
    const availableForRight = width - statsLeftWidth - minPadding
    if (availableForRight > 0) {
      const truncatedRight = truncateToWidth(rightSide, availableForRight, "")
      statsLine =
        statsLeft +
        " ".repeat(
          Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight)),
        ) +
        truncatedRight
    } else {
      statsLine = statsLeft
    }
  }

  const pwdLine = truncateToWidth(
    theme.fg("dim", pwd),
    width,
    theme.fg("dim", "..."),
  )
  const remainder = statsLine.slice(statsLeft.length)
  return [pwdLine, theme.fg("dim", statsLeft) + theme.fg("dim", remainder)]
}

/** @param {import('@mariozechner/pi-coding-agent').ExtensionContext} ctx */
function installFooter(pi, ctx) {
  ctx.ui.setFooter((tui, theme, footerData) => {
    requestRender = () => tui.requestRender()
    const unsub = footerData.onBranchChange(() => tui.requestRender())
    return {
      dispose() {
        unsub?.()
      },
      invalidate() {},
      render(width) {
        return renderFooter(pi, ctx, footerData, theme, width)
      },
    }
  })
}

/** @param {import('@mariozechner/pi-coding-agent').ExtensionContext} ctx */
async function updateUsage(ctx) {
  const model = ctx.model
  if (!isOpenAICodexProvider(model?.provider)) {
    usageSnapshot = undefined
    requestRender()
    return undefined
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok || !auth.apiKey) {
    usageSnapshot = undefined
    requestRender()
    return undefined
  }

  const tokenMetadata = getTokenMetadata(auth.apiKey)
  const headers = {
    Authorization: `Bearer ${auth.apiKey}`,
    Accept: "application/json",
    "User-Agent": "pi-chatgpt-weekly-limit",
    ...(tokenMetadata.accountId
      ? { "chatgpt-account-id": tokenMetadata.accountId }
      : {}),
  }

  try {
    const response = await fetch(`${CHATGPT_BASE_URL}/wham/usage`, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      usageSnapshot = undefined
      requestRender()
      return undefined
    }

    usageSnapshot = parseUsageSnapshot(await response.json())
    if (!usageSnapshot.email && tokenMetadata.email)
      usageSnapshot.email = tokenMetadata.email
    if (!usageSnapshot.planType && tokenMetadata.planType)
      usageSnapshot.planType = tokenMetadata.planType
    requestRender()
    return usageSnapshot
  } catch {
    usageSnapshot = undefined
    requestRender()
    return undefined
  }
}

function buildUsageDetails(snapshot, provider) {
  const lines = []
  lines.push(`provider: ${provider}`)
  lines.push(`plan: ${snapshot?.planType || "unknown"}`)
  if (snapshot?.email) lines.push(`email: ${snapshot.email}`)
  lines.push(
    `5-hour: ${formatUsedPercent(snapshot?.fiveHour)} used, ${formatRemainingPercent(snapshot?.fiveHour)} left, resets ${formatResetLong(snapshot?.fiveHour?.resetAt)}`,
  )
  lines.push(
    `weekly: ${formatUsedPercent(snapshot?.weekly)} used, ${formatRemainingPercent(snapshot?.weekly)} left, resets ${formatResetLong(snapshot?.weekly?.resetAt)}`,
  )
  if (snapshot?.fetchedAt)
    lines.push(`fetched: ${new Date(snapshot.fetchedAt).toLocaleString()}`)
  lines.push(`footer: ${describeFooterConfig()}`)
  lines.push(`endpoint: ${CHATGPT_BASE_URL}/wham/usage`)
  return lines
}

async function configureQuotaWindow(pi, ctx) {
  const labels = QUOTA_WINDOW_OPTIONS.map((option) =>
    option.value === footerConfig.quotaWindow
      ? `✓ ${option.label}`
      : option.label,
  )
  const choice = await ctx.ui.select(
    "Display which ChatGPT limit in footer?",
    labels,
  )
  const selected = QUOTA_WINDOW_OPTIONS.find((option) =>
    choice?.endsWith(option.label),
  )
  if (!selected) return

  saveFooterConfig(pi, { ...footerConfig, quotaWindow: selected.value })
  ctx.ui.notify(`ChatGPT footer display: ${selected.label}`, "info")
}

async function configureDisplayMode(pi, ctx) {
  const labels = DISPLAY_MODE_OPTIONS.map((option) =>
    option.value === footerConfig.displayMode
      ? `✓ ${option.label}`
      : option.label,
  )
  const choice = await ctx.ui.select(
    "How should the footer value be shown?",
    labels,
  )
  const selected = DISPLAY_MODE_OPTIONS.find((option) =>
    choice?.endsWith(option.label),
  )
  if (!selected) return

  saveFooterConfig(pi, { ...footerConfig, displayMode: selected.value })
  ctx.ui.notify(`ChatGPT footer mode: ${selected.label}`, "info")
}

export default function (pi) {
  let inFlight = Promise.resolve()

  function queueUpdate(ctx) {
    inFlight = inFlight.catch(() => undefined).then(() => updateUsage(ctx))
    return inFlight
  }

  function queueUpdateInBackground(ctx) {
    void queueUpdate(ctx).catch(() => undefined)
  }

  pi.on("session_start", (_event, ctx) => {
    restoreFooterConfig(ctx)
    installFooter(pi, ctx)
    queueUpdateInBackground(ctx)
  })

  pi.on("model_select", (_event, ctx) => queueUpdateInBackground(ctx))
  pi.on("agent_end", (_event, ctx) => queueUpdateInBackground(ctx))

  pi.on("session_shutdown", async () => {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = undefined
    requestRender = () => {}
  })

  pi.registerCommand("chatgpt-limit", {
    description: "Show ChatGPT Codex 5-hour and weekly usage limits",
    handler: async (_args, ctx) => {
      const action = await ctx.ui.select("ChatGPT Codex usage limits", [
        "Show current usage details",
        `Configure footer limit (${describeFooterConfig()})`,
        "Configure footer display mode",
      ])

      if (action === "Configure footer display mode") {
        await configureDisplayMode(pi, ctx)
        return
      }

      if (action?.startsWith("Configure footer limit")) {
        await configureQuotaWindow(pi, ctx)
        return
      }

      if (!action) return

      if (!isOpenAICodexProvider(ctx.model?.provider)) {
        ctx.ui.notify(
          "ChatGPT limits are only available for openai-codex models.",
          "info",
        )
        return
      }

      const snapshot = await queueUpdate(ctx)
      if (!snapshot) {
        ctx.ui.notify("Could not load ChatGPT usage limits.", "warning")
        return
      }

      await ctx.ui.select(
        "ChatGPT Codex usage limits",
        buildUsageDetails(snapshot, ctx.model?.provider),
      )
    },
  })
}
