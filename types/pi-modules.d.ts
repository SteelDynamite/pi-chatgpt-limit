declare module "@earendil-works/pi-tui" {
  export const Key: {
    up: unknown
    down: unknown
    enter: unknown
    escape: unknown
    ctrl(key: string): unknown
  }

  export function matchesKey(data: unknown, key: unknown): boolean
  export function truncateToWidth(
    text: string,
    width: number,
    ellipsis: string,
  ): string
  export function visibleWidth(text: string): number
}

interface PiAssistantUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: {
    total?: number
  }
}

interface PiTheme {
  fg(color: string, text: string): string
  bold(text: string): string
}

interface PiFooterData {
  getGitBranch(): string | undefined
  getAvailableProviderCount(): number
  onBranchChange(callback: () => void): (() => void) | undefined
}

interface PiModel {
  id?: string
  provider?: string
  contextWindow?: number
  reasoning?: unknown
}

interface PiExtensionContext {
  mode?: string
  hasUI?: boolean
  model?: PiModel
  getContextUsage():
    | {
        contextWindow?: number
        percent?: number | null
      }
    | undefined
  modelRegistry: {
    isUsingOAuth(model: PiModel): boolean
    getApiKeyAndHeaders(model: PiModel): Promise<{
      ok: boolean
      apiKey?: string
    }>
  }
  sessionManager: {
    getBranch(): Array<{
      type?: string
      customType?: string
      data?: unknown
    }>
    getEntries(): Array<{
      type?: string
      message?: {
        role?: string
        usage?: PiAssistantUsage
      }
    }>
    getCwd(): string
    getSessionName(): string | undefined
  }
  ui: {
    setFooter(
      factory: (
        tui: { requestRender(): void },
        theme: PiTheme,
        footerData: PiFooterData,
      ) => {
        dispose(): void
        invalidate(): void
        render(width: number): string[]
      },
    ): void
    custom(
      factory: (
        tui: { requestRender(): void },
        theme: PiTheme,
        keybindings: unknown,
        done: (value: unknown) => void,
      ) => {
        invalidate(): void
        handleInput(data: unknown): void
        render(width: number): string[]
      },
    ): Promise<unknown>
    select(title: string, options: string[]): Promise<string | undefined>
    confirm(title: string, message: string): Promise<boolean>
    notify(message: string, type: string): void
  }
}
