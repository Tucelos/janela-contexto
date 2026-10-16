import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextBreakdown,
  SessionContextUsage,
} from 'claude-code'

import type { Compaction, ContextSlice, ContextSnapshot } from '../types'

/** The plain usage read costs nothing, so a short period keeps the meter live mid-turn. */
const POLL_MS = 3000
/** The desktop's prompt-footer chip holds 24 characters: a 10-cell bar and the percentage fit. */
const CHIP_CELLS = 10
const TERMINAL_CELLS = 10
/** The details card's bar, before it is fitted to the band's width. */
const CARD_CELLS = 32

const FULL = '█'
const BUFFER = '▒'
const FREE = '░'
/**
 * The card's unused space: thin lines, centred on the row. The shade glyphs fill the whole
 * cell and, from a fallback font, run wider and taller than it, into the row above.
 */
const THIN_BUFFER = '╌'
const THIN_FREE = '─'
const SQUARE = '■'
const DOT = '·'
const DASH = '—'
const ARROW = '→'

const IDLE: Compaction = { status: 'idle', text: null }
const RUNNING: Compaction = { status: 'running', text: null }

const snapshot = atom({ plugin: 'janela-contexto', key: 'snapshot' } as const, null)
const isOpen = atom({ plugin: 'janela-contexto', key: 'isOpen' } as const, false)
const compaction = atom({ plugin: 'janela-contexto', key: 'compaction' } as const, IDLE)

/** Portuguese names for the rows /context prints; any other row keeps its own name. */
const LABELS: Readonly<Record<string, string>> = {
  'System prompt': 'Prompt do sistema',
  'System tools': 'Ferramentas do sistema',
  'MCP tools': 'Ferramentas MCP',
  'Custom agents': 'Agentes',
  'Memory files': 'Memória',
  Skills: 'Skills',
  Messages: 'Mensagens',
  'Free space': 'Livre',
  'Autocompact buffer': 'Reserva de compactação',
}

type Level = 'success' | 'warning' | 'error'

type Segment = { color: string; cells: number }

type Meter = {
  /** Tokens in use, or null before anything was measured or estimated. */
  used: number | null
  max: number
  percent: number | null
  isEstimate: boolean
  level: Level
  compactAt: number | null
  untilCompact: number | null
  filled: Segment[]
  bufferCells: number
  freeCells: number
}

/** 950 → "950", 8400 → "8,4k", 104000 → "104k", 1000000 → "1M". */
function formatTokens(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 999_500) {
    return abs < 10_000 ? `${decimal(n / 1000, 1)}k` : `${Math.round(n / 1000)}k`
  }
  return `${decimal(n / 1_000_000, abs < 10_000_000 ? 2 : 1)}M`
}

function decimal(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return trimmed.replace('.', ',')
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function levelOf(used: number | null, limit: number): Level {
  if (used === null || limit <= 0) return 'success'
  const ratio = used / limit
  if (ratio < 0.6) return 'success'
  return ratio < 0.85 ? 'warning' : 'error'
}

/** Splits `total` cells among the slices by their tokens (largest remainder). */
function apportion(slices: readonly ContextSlice[], total: number): Segment[] {
  const sum = slices.reduce((acc, slice) => acc + slice.tokens, 0)
  if (total <= 0 || sum <= 0) return []
  const shares = slices.map(slice => {
    const exact = (slice.tokens / sum) * total
    return { color: slice.color, cells: Math.floor(exact), rest: exact - Math.floor(exact) }
  })
  let left = total - shares.reduce((acc, share) => acc + share.cells, 0)
  for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break
    share.cells += 1
    left -= 1
  }
  return shares.filter(share => share.cells > 0).map(({ color, cells }) => ({ color, cells }))
}

function meterOf(snap: ContextSnapshot, cells: number): Meter {
  const isLive = snap.tokens !== null
  const used = snap.tokens ?? snap.estimateTokens
  const max = isLive ? snap.window : (snap.estimateMax ?? snap.window)
  const percent =
    used === null
      ? null
      : isLive && snap.percent !== null
        ? snap.percent
        : Math.round((used / max) * 100)
  const compactAt = snap.autoCompactAt
  const level = levelOf(used, compactAt ?? max * 0.8)
  const filledCells =
    used === null || used <= 0 ? 0 : clamp(Math.round(((percent ?? 0) / 100) * cells), 1, cells)
  const usedSlices = snap.slices.filter(slice => slice.kind === 'used' && slice.tokens > 0)
  const filled =
    usedSlices.length > 0
      ? apportion(usedSlices, filledCells)
      : filledCells > 0
        ? [{ color: level, cells: filledCells }]
        : []
  const bufferTokens =
    compactAt === null
      ? 0
      : snap.slices
          .filter(slice => slice.kind === 'buffer')
          .reduce((acc, slice) => acc + slice.tokens, 0)
  const bufferCells = clamp(Math.round((bufferTokens / max) * cells), 0, cells - filledCells)

  return {
    used,
    max,
    percent,
    isEstimate: !isLive && used !== null,
    level,
    compactAt,
    untilCompact: compactAt === null || used === null ? null : compactAt - used,
    filled,
    bufferCells,
    freeCells: cells - filledCells - bufferCells,
  }
}

function barOf(meter: Meter): string {
  const filled = meter.filled.reduce((acc, segment) => acc + segment.cells, 0)
  return FULL.repeat(filled) + BUFFER.repeat(meter.bufferCells) + FREE.repeat(meter.freeCells)
}

function percentText(meter: Meter): string {
  return meter.percent === null ? DASH : `${meter.isEstimate ? '~' : ''}${meter.percent}%`
}

function usageText(meter: Meter): string {
  const used = meter.used === null ? DASH : `${meter.isEstimate ? '~' : ''}${formatTokens(meter.used)}`
  return `${used} de ${formatTokens(meter.max)} tokens`
}

function compactLine(meter: Meter): string {
  if (meter.compactAt === null) return 'Compactação automática desligada'
  if (meter.untilCompact === null || meter.untilCompact > 0) {
    const left = meter.untilCompact === null ? '' : ` ${DOT} faltam ${formatTokens(meter.untilCompact)}`
    return `Compactação automática em ${formatTokens(meter.compactAt)}${left}`
  }
  return 'Compactação automática iminente'
}

function legendOf(snap: ContextSnapshot): { label: string; tokens: number; color: string }[] {
  return snap.slices
    .filter(slice => slice.kind !== 'deferred' && slice.tokens > 0)
    .map(slice => ({ label: LABELS[slice.name] ?? slice.name, tokens: slice.tokens, color: slice.color }))
}

async function snapshotOf($: EngineInterface, context: SessionContextUsage): Promise<ContextSnapshot> {
  let breakdown: SessionContextBreakdown | undefined
  try {
    breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  } catch {
    breakdown = undefined
  }

  return {
    tokens: context.tokens ?? null,
    window: context.window,
    percent: context.percent ?? null,
    estimateTokens: breakdown?.totalTokens ?? null,
    estimateMax: breakdown?.rawMaxTokens ?? null,
    autoCompactAt:
      breakdown !== undefined && breakdown.isAutoCompactEnabled
        ? (breakdown.autoCompactThreshold ?? null)
        : null,
    slices: (breakdown?.categories ?? [])
      .filter(category => category.kind !== 'deferred')
      .map(category => ({
        name: category.name,
        tokens: category.tokens,
        color: category.color,
        kind: category.kind,
      })),
  }
}

// The refresh loop's own bookkeeping: a reload starts it over, which only costs one recompute.
let lastKey: string | null = null
let isRunning = false
let isPending = false
let poll: { cancel: () => void } | null = null

/** Reads the window and, when its fill or size moved, the breakdown, then stores both. */
async function refresh($: EngineInterface): Promise<void> {
  if (isRunning) {
    isPending = true
    return
  }
  isRunning = true
  try {
    do {
      isPending = false
      const { context } = await $.session.usage()
      const key = `${context.tokens ?? '-'}/${context.window}`
      if (key !== lastKey) {
        const fresh = await snapshotOf($, context)
        await update($, snapshot, () => fresh)
        lastKey = key
      }
    } while (isPending)
  } finally {
    isRunning = false
  }
}

/** The poll catches what no event announces: /model, /compact, /clear, mid-turn growth. */
function startPolling($: EngineInterface): void {
  if (poll !== null) return
  poll = $.clock.every(POLL_MS, () => {
    void refresh($).catch(() => undefined)
  })
}

function stopPolling(): void {
  poll?.cancel()
  poll = null
}

/** The chip's press: opens the card (with no stale result in it) or closes it. */
async function toggleDetails($: EngineInterface): Promise<void> {
  const open = await update($, isOpen, current => !current)
  if (!open) return
  const current = await read($, compaction)
  if (current.status !== 'running') await update($, compaction, () => IDLE)
}

async function closeDetails($: EngineInterface): Promise<void> {
  await update($, isOpen, () => false)
}

/** The card's button: the same compaction /compact runs, between turns only. */
async function compactNow($: EngineInterface): Promise<void> {
  const current = await read($, compaction)
  if (current.status === 'running') return
  await update($, compaction, () => RUNNING)

  let outcome: Compaction
  try {
    const result = await $.session.compact()
    const skip = 'skip' in result ? result.skip : undefined
    if (typeof skip === 'string') {
      outcome = { status: 'skipped', text: skip }
    } else {
      const before = 'tokensBefore' in result ? result.tokensBefore : undefined
      const after = 'tokensAfter' in result ? result.tokensAfter : undefined
      const sizes =
        before !== undefined && after !== undefined
          ? `${formatTokens(before)} ${ARROW} ${formatTokens(after)} tokens`
          : null
      outcome = { status: 'done', text: sizes }
    }
  } catch (error) {
    outcome = { status: 'failed', text: error instanceof Error ? error.message : String(error) }
  }

  await update($, compaction, () => outcome)
  lastKey = null
  await refresh($).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.isInteractive || e.surface !== null) startPolling($)
    void refresh($).catch(() => undefined)

    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    startPolling($)
    void refresh($).catch(() => undefined)

    return attached
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('context')) {
      startPolling($)
      try {
        await refresh($)
      } catch {
        // The next poll tries again.
      }
    }

    return measured
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      lastKey = null
    } else {
      stopPolling()
    }

    return next(e)
  })

  // Terminal: the bar and the percentage ride at the end of the hint line under the prompt.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const meter = meterOf(snap, TERMINAL_CELLS)
    const mine = `contexto ${barOf(meter)} ${percentText(meter)}`
    const theirs = e.props.tail
    const tail = theirs === undefined || theirs === '' ? mine : `${theirs}  ${mine}`

    return next({ ...e, props: { ...e.props, tail } })
  })

  // Desktop: the app draws a mod's SessionMode tree as a chip in the prompt's footer. The chip
  // is one button, the bar and the percentage; a press opens or closes the details card.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const meter = meterOf(snap, CHIP_CELLS)
    const modes = e.props.modes.filter(mode => mode !== '')
    const { Box, Button, Text } = $.ui.resolve(e)

    // A Button never sits inside a Text: the row is a Box, the modes of other mods beside it.
    return (
      <Box flexDirection="row" alignItems="center">
        {modes.length > 0 && <Text dimColor>{`${modes.join(' & ')} ${DOT} `}</Text>}
        <Button
          key="contexto"
          plain
          label={`${barOf(meter)} ${percentText(meter)}`}
          onPress={() => {
            void toggleDetails($).catch(() => undefined)
          }}
        >
          <Text mono>
            {meter.filled.map(segment => (
              <Text color={segment.color}>{FULL.repeat(segment.cells)}</Text>
            ))}
            {meter.bufferCells > 0 && <Text dimColor>{BUFFER.repeat(meter.bufferCells)}</Text>}
            {meter.freeCells > 0 && <Text dimColor>{FREE.repeat(meter.freeCells)}</Text>}
          </Text>
          <Text color={meter.level}>{` ${percentText(meter)}`}</Text>
        </Button>
      </Box>
    )
  })

  // The details card, directly above the prompt while it is open: the numbers, the rows of
  // /context, and the compact button. It yields the band to the app's surveys.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return next(e)
    if (!(await read($, isOpen))) return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const state = await read($, compaction)
    const meter = meterOf(snap, clamp(e.props.bodyColumns - 2, 8, CARD_CELLS))
    const legend = legendOf(snap)
    const isCompacting = state.status === 'running'
    const canCompact = !isCompacting && !e.props.isWorking
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Text weight="semibold">Janela de contexto</Text>
          <Text weight="semibold" color={meter.level}>
            {percentText(meter)}
          </Text>
          <Text dimColor>{usageText(meter)}</Text>
        </Box>
        <Box marginTop="xs">
          <Text mono>
            {meter.filled.map(segment => (
              <Text color={segment.color}>{FULL.repeat(segment.cells)}</Text>
            ))}
            {meter.bufferCells > 0 && (
              <Text dimColor>{THIN_BUFFER.repeat(meter.bufferCells)}</Text>
            )}
            {meter.freeCells > 0 && <Text dimColor>{THIN_FREE.repeat(meter.freeCells)}</Text>}
          </Text>
        </Box>
        <Text dimColor>{compactLine(meter)}</Text>
        {meter.isEstimate && (
          <Text dimColor italic>
            Estimativa até a primeira resposta.
          </Text>
        )}
        {legend.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap="md">
            {legend.map(row => (
              <Text>
                <Text color={row.color}>{SQUARE}</Text>
                <Text dimColor>{` ${row.label} ${formatTokens(row.tokens)}`}</Text>
              </Text>
            ))}
          </Box>
        )}
        {state.status === 'running' && <Text>Compactando a conversa…</Text>}
        {state.status === 'done' && (
          <Text color="success">
            {state.text === null ? 'Conversa compactada.' : `Conversa compactada: ${state.text}.`}
          </Text>
        )}
        {state.status === 'skipped' && (
          <Text color="warning">{`A compactação não aconteceu: ${state.text ?? ''}`}</Text>
        )}
        {state.status === 'failed' && (
          <Text color="error">{`Não deu para compactar: ${state.text ?? ''}`}</Text>
        )}
        <Box flexDirection="row" alignItems="center" gap="sm">
          {canCompact && (
            <Button
              key="compactar"
              variant="primary"
              label="Compactar agora"
              onPress={() => {
                void compactNow($).catch(() => undefined)
              }}
            />
          )}
          {!isCompacting && e.props.isWorking && (
            <Text dimColor>Dá para compactar quando o turno terminar.</Text>
          )}
          <Button
            key="fechar"
            role="dismiss"
            label="Fechar"
            onPress={() => {
              void closeDetails($).catch(() => undefined)
            }}
          />
        </Box>
      </Box>
    )
  })
}
