import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface Journal {
  log(event: string, data?: Record<string, unknown>): void
}

/**
 * Append-only JSONL journal (CLAUDE.md guardrail: log everything). Writes to
 * userData/logs/journal.log plus the console. A richer SQLite journal can
 * replace this later without changing call sites.
 */
export function createJournal(): Journal {
  let file: string | null = null
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'journal.log')
  } catch (err) {
    console.error('Journal disabled (no log dir):', err)
  }

  return {
    log(event, data = {}) {
      const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data })
      if (file) {
        try {
          appendFileSync(file, entry + '\n')
        } catch {
          /* never let logging break trading */
        }
      }
      console.log('[journal]', entry)
    }
  }
}
