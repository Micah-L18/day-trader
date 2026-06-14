import { describe, expect, it } from 'vitest'
import { LIVE_CONFIRM_PHRASE } from '../../src/shared/types'
import { evaluateArm } from '../../src/main/risk/liveGate'

describe('evaluateArm (live-trading gate)', () => {
  const base = { capable: true, confirm: LIVE_CONFIRM_PHRASE, hasLiveKeys: true }

  it('arms only when all three gates hold', () => {
    expect(evaluateArm(base).ok).toBe(true)
  })

  it('refuses without the env capability (mode=live + ALLOW_LIVE_TRADING)', () => {
    expect(evaluateArm({ ...base, capable: false }).ok).toBe(false)
  })

  it('refuses on the wrong confirmation phrase', () => {
    expect(evaluateArm({ ...base, confirm: 'enable live' }).ok).toBe(false)
    expect(evaluateArm({ ...base, confirm: '' }).ok).toBe(false)
  })

  it('refuses without live API keys', () => {
    expect(evaluateArm({ ...base, hasLiveKeys: false }).ok).toBe(false)
  })
})
