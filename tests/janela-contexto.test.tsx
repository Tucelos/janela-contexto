import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionContextBreakdown, SessionContextUsage } from 'claude-code'

const PLUGIN = 'janela-contexto'
const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const
/** What the desktop app asks for its prompt-footer chip, word for word. */
const CHIP = { component: 'SessionMode', props: { modes: [] } } as const
/** The band above the prompt, as the desktop app asks for it. */
function band(isWorking = false, hasSurvey = false) {
  return {
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isWorking,
      maxRows: 12,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  } as const
}

const LIVE: SessionContextUsage = { tokens: 104_000, percent: 52, window: 200_000 }
const FRESH: SessionContextUsage = { window: 200_000 }

function breakdown(): SessionContextBreakdown {
  return {
    categories: [
      { name: 'System prompt', tokens: 3_000, color: 'inactive', isDeferred: false, kind: 'used' },
      { name: 'System tools', tokens: 14_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
      { name: 'Messages', tokens: 87_000, color: 'permission', isDeferred: false, kind: 'used' },
      { name: 'MCP tools', tokens: 9_000, color: 'ide', isDeferred: true, kind: 'deferred' },
      { name: 'Free space', tokens: 51_000, color: 'inactive', isDeferred: false, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 45_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    ],
    totalTokens: 104_000,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    autocompactSource: 'model-default',
    percentage: 52,
    gridRows: [],
    model: 'claude-opus-5-5',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold: 155_000,
    isAutoCompactEnabled: true,
    apiUsage: null,
  }
}

/** Answers the usage reads from `current()` and echoes the measurements. */
function world(on: On, current: () => SessionContextUsage): void {
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: e.breakdown === undefined ? current() : { ...current(), breakdown: breakdown() },
      rateLimits: [],
    },
  }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

/** Stands for the engine's own drawing beneath the plugin. */
function engineDraws(on: On): void {
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine:${e.props.modes.join('&')}`}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine:band</Text>
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`${e.props.hint} ${e.props.tail ?? ''}`}</Text>
  })
}

describe('janela-contexto', () => {
  test('o chip do rodapé mostra só a barra e a porcentagem', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    const button = await chip.find({ type: 'Button', key: 'contexto' })
    expect(button?.props.label).toMatch(/^[█▒░]{10} 52%$/)
    expect(button?.text).toMatch(/^[█▒░]{10} 52%$/)
    expect(await chip.find({ text: /104k|200k/ })).toBeUndefined()
    await chip.unmount()
  })

  test('clicar no chip abre os detalhes acima do prompt, e Fechar fecha', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band() })
    expect(await card.find({ type: 'Text', text: 'engine:band' })).toBeDefined()

    await chip.press({ key: 'contexto' })
    expect(await card.find({ type: 'Text', text: 'Janela de contexto' })).toBeDefined()
    expect(await card.find({ type: 'Text', text: '104k de 200k tokens' })).toBeDefined()
    expect(await card.find({ type: 'Text', text: 'Compactação automática em 155k · faltam 51k' })).toBeDefined()
    expect(await card.find({ type: 'Text', text: 'Mensagens 87k' })).toBeDefined()
    expect(await card.find({ type: 'Text', text: 'Ferramentas MCP' })).toBeUndefined()
    expect(await card.find({ type: 'Button', key: 'compactar' })).toBeDefined()
    // Used space in blocks, the reserve and the free space in thin lines: no shade glyphs.
    expect(await card.find({ type: 'Text', text: /^█{17}╌{7}─{8}$/ })).toBeDefined()
    expect(await card.find({ type: 'Text', text: /[░▒]/ })).toBeUndefined()

    await card.press({ key: 'fechar' })
    expect(await card.find({ type: 'Text', text: 'engine:band' })).toBeDefined()
    await card.unmount()
    await chip.unmount()
  })

  test('o botão Compactar compacta a conversa e mostra o resultado', async ($, on) => {
    let context = LIVE
    world(on, () => context)
    engineDraws(on)
    let calls = 0
    on('session.compact', () => {
      calls += 1
      context = FRESH
      return { messages: [{ role: 'user', text: 'Resumo da conversa', toolUses: [] }], tokensBefore: 104_000, tokensAfter: 12_000 }
    })
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band() })
    await chip.press({ key: 'contexto' })
    await card.press({ key: 'compactar' })

    expect(calls).toBe(1)
    expect(await card.find({ type: 'Text', text: 'Conversa compactada: 104k → 12k tokens.' })).toBeDefined()
    expect((await chip.find({ type: 'Button', key: 'contexto' }))?.props.label).toMatch(/~52%$/)
    await card.unmount()
    await chip.unmount()
  })

  test('reabrir o cartão não mostra o resultado da compactação anterior', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    on('session.compact', () => ({ messages: [{ role: 'user', text: 'Resumo da conversa', toolUses: [] }], tokensBefore: 104_000, tokensAfter: 12_000 }))
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band() })
    await chip.press({ key: 'contexto' })
    await card.press({ key: 'compactar' })
    await chip.press({ key: 'contexto' })
    await chip.press({ key: 'contexto' })
    expect(await card.find({ type: 'Text', text: 'Conversa compactada' })).toBeUndefined()
    await card.unmount()
    await chip.unmount()
  })

  test('uma compactação recusada diz o motivo', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    on('session.compact', () => ({ skip: 'um hook vetou' }))
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band() })
    await chip.press({ key: 'contexto' })
    await card.press({ key: 'compactar' })
    expect(await card.find({ type: 'Text', text: 'A compactação não aconteceu: um hook vetou' })).toBeDefined()
    await card.unmount()
    await chip.unmount()
  })

  test('durante um turno o botão Compactar dá lugar a um aviso', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band(true) })
    await chip.press({ key: 'contexto' })
    expect(await card.find({ type: 'Button', key: 'compactar' })).toBeUndefined()
    expect(await card.find({ type: 'Text', text: 'quando o turno terminar' })).toBeDefined()
    expect(await card.find({ type: 'Button', key: 'fechar' })).toBeDefined()
    await card.unmount()
    await chip.unmount()
  })

  test('o cartão cede a faixa às pesquisas do app', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    await chip.press({ key: 'contexto' })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band(false, true) })
    expect(await card.find({ type: 'Text', text: 'engine:band' })).toBeDefined()
    await card.unmount()
    await chip.unmount()
  })

  test('mantém os rótulos de modo que vierem de outros mods', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'SessionMode',
      props: { modes: ['memória pausada'] },
    })
    expect(await chip.find({ type: 'Text', text: 'memória pausada · ' })).toBeDefined()
    expect(await chip.find({ type: 'Button', key: 'contexto' })).toBeDefined()
    await chip.unmount()
  })

  test('no terminal, só a barra e a porcentagem no fim da linha de dicas', async ($, on) => {
    world(on, () => LIVE)
    let tail: string | undefined
    on('ui.render', { component: 'PromptHint' }, ($, e) => {
      tail = e.props.tail
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{`${e.props.hint} ${e.props.tail ?? ''}`}</Text>
    })
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine:modes</Text>
    })
    await $.session.measure({ context: LIVE, rateLimits: [], changed: ['context'] })

    const hint = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...HINT })
    expect(tail).toMatch(/^contexto [█▒░]{10} 52%$/)
    await hint.unmount()

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...CHIP })
    expect(await chip.find({ type: 'Text', text: 'engine:modes' })).toBeDefined()
    await chip.unmount()
  })

  test('mostra uma estimativa antes da primeira resposta', async ($, on) => {
    world(on, () => FRESH)
    engineDraws(on)
    await $.session.measure({ context: FRESH, rateLimits: [], changed: ['context'] })

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    expect((await chip.find({ type: 'Button', key: 'contexto' }))?.props.label).toMatch(/ ~52%$/)
    await chip.press({ key: 'contexto' })
    const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...band() })
    expect(await card.find({ type: 'Text', text: '~104k de 200k tokens' })).toBeDefined()
    expect(await card.find({ type: 'Text', text: 'Estimativa até a primeira resposta.' })).toBeDefined()
    await card.unmount()
    await chip.unmount()
  })

  test('acompanha sozinho as mudanças da janela, como após /model', async ($, on) => {
    const clock = mock.clock(on)
    let context: SessionContextUsage = { tokens: 20_000, percent: 10, window: 200_000 }
    world(on, () => context)
    engineDraws(on)

    await $.session.start({ cwd: '/projeto', surface: 'desktop', isInteractive: false })
    await clock.advance(3_000)
    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    expect((await chip.find({ type: 'Button', key: 'contexto' }))?.props.label).toMatch(/ 10%$/)

    context = { tokens: 150_000, percent: 15, window: 1_000_000 }
    await clock.advance(3_000)
    expect((await chip.find({ type: 'Button', key: 'contexto' }))?.props.label).toMatch(/ 15%$/)
    await chip.unmount()
  })

  test('deixa o chip com o motor antes da primeira medição', async ($, on) => {
    world(on, () => LIVE)
    engineDraws(on)

    const chip = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...CHIP })
    expect(await chip.find({ type: 'Text', text: 'engine:' })).toBeDefined()
    expect(await chip.find({ type: 'Button', key: 'contexto' })).toBeUndefined()
    await chip.unmount()
  })
})
