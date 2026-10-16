/** What a breakdown row is, as /context sorts them. */
export type ContextSliceKind = 'used' | 'free' | 'buffer' | 'deferred'

/** One row of the /context breakdown, kept for the bar and its legend. */
export type ContextSlice = {
  name: string
  tokens: number
  /** The theme key /context draws the row in. */
  color: string
  kind: ContextSliceKind
}

/** The context window as last measured, the figures the meter draws. */
export type ContextSnapshot = {
  /** Input tokens of the last response, or null before the window's first one. */
  tokens: number | null
  /** The model's context window, in tokens. */
  window: number
  /** tokens over window, a whole percentage, or null with tokens. */
  percent: number | null
  /** The breakdown's estimate of the tokens in use, when it was computed. */
  estimateTokens: number | null
  /** The window the estimate is measured against. */
  estimateMax: number | null
  /** The token count at which auto-compaction runs, or null when it is off. */
  autoCompactAt: number | null
  slices: ContextSlice[]
}

/** Where the details card's compact button stands. */
export type CompactionStatus = 'idle' | 'running' | 'done' | 'skipped' | 'failed'

/** The last compaction the card started, and what it said. */
export type Compaction = {
  status: CompactionStatus
  /** The sizes before and after, the veto, or the error; null when there is nothing to say. */
  text: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'janela-contexto': {
      snapshot: ContextSnapshot | null
      /** Whether the details card above the prompt is open. */
      isOpen: boolean
      compaction: Compaction
    }
  }
}
