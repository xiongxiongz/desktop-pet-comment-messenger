import type { BrowserWindow } from 'electron'
import type { PushOneResult, PushPayload, TaggedComment } from './types'
import { getSettings, isFavorited } from './store'
import { clearShown, hasUnshown, markShown, pickNext, size } from './queue'

// 推送调度器：单个递归 setTimeout，每次间隔随机；门控活跃时段/免打扰/每日上限/去重。
// 计时器活在 main 进程，通过 webContents.send('comment:show') 推给桌宠窗口。

const RECHECK_MS = 60_000 // 条件不满足时的复查间隔

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** 同日窗口判断（MVP 假设 start <= end，不跨午夜） */
function inWindow(win: { start: string; end: string }, cur: number): boolean {
  return cur >= toMinutes(win.start) && cur < toMinutes(win.end)
}

function toPayload(c: TaggedComment): PushPayload {
  return {
    id: c.id,
    author: c.author,
    text: c.text,
    videoTitle: c.videoTitle,
    tag: c.tag,
    likeCount: c.likeCount,
    kind: c.kind,
    favorited: isFavorited(c.id)
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private dailyCount = 0
  private currentDay = todayStr() // 内存态：跨天时重置计数与去重
  private petWin: BrowserWindow | null = null

  attach(win: BrowserWindow): void {
    this.petWin = win
  }

  start(): void {
    this.stop()
    this.reschedule(this.nextInterval())
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 重启计时（例如设置变更后立即按新参数运行） */
  restart(): void {
    this.start()
  }

  private nextInterval(): number {
    const { minIntervalSec, maxIntervalSec } = getSettings()
    const lo = Math.max(5, minIntervalSec)
    const hi = Math.max(lo, maxIntervalSec)
    return (lo + Math.random() * (hi - lo)) * 1000
  }

  private reschedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.tick(), delayMs)
  }

  /**
   * 手动"来一条"：忽略间隔/上限，仍尊重去重与偏好。
   * ok=已推送；empty=队列空（未筛选）；exhausted=筛了但所选类型无更多可推评论
   */
  pushOne(): PushOneResult {
    const settings = getSettings()
    const comment = pickNext(settings.preferredTags)
    if (comment) {
      this.emit(comment)
      return 'ok'
    }
    return size() === 0 ? 'empty' : 'exhausted'
  }

  private emit(comment: TaggedComment): void {
    if (!this.petWin || this.petWin.isDestroyed()) return
    this.petWin.webContents.send('comment:show', toPayload(comment))
    markShown(comment.id)
  }

  private tick(): void {
    const settings = getSettings()

    // 跨天：重置每日计数与去重记录（均为内存态，同生命周期）
    const today = todayStr()
    if (today !== this.currentDay) {
      this.currentDay = today
      this.dailyCount = 0
      clearShown()
    }

    // 1) 推送关闭 → 复查
    if (!settings.pushEnabled) return this.reschedule(RECHECK_MS)

    const cur = nowMinutes()

    // 2) 不在活跃时段 → 复查
    if (!inWindow(settings.activeWindow, cur)) return this.reschedule(RECHECK_MS)

    // 3) 免打扰时段 → 复查
    if (inWindow(settings.dndWindow, cur)) return this.reschedule(RECHECK_MS)

    // 4) 达到每日上限 → 复查（跨天会重置）
    if (this.dailyCount >= settings.dailyCap) return this.reschedule(RECHECK_MS)

    // 5) 无匹配未展示评论 → 不推空内容，复查
    if (!hasUnshown(settings.preferredTags)) return this.reschedule(RECHECK_MS)

    // 6) 正常推送
    const comment = pickNext(settings.preferredTags)
    if (comment) {
      this.emit(comment)
      this.dailyCount++
    }
    this.reschedule(this.nextInterval())
  }
}

export const scheduler = new Scheduler()
