import type { CommentTag, TaggedComment } from './types'

// 内存队列：进程存活期间保存已筛选的评论。
// shownIds（去重记录）与队列同生命周期——都是运行时状态，不落盘；
// 重启后队列从 comments.json 重建、shownIds 天然为空，二者一致。
let items: TaggedComment[] = []
const shownIds = new Set<string>()

export function setQueue(next: TaggedComment[]): void {
  items = next
  shownIds.clear() // 换一批评论即干净重来，整批可重新推送
}

export function markShown(id: string): void {
  shownIds.add(id)
}

export function clearShown(): void {
  shownIds.clear()
}

export function getQueue(): TaggedComment[] {
  return items
}

export function size(): number {
  return items.length
}

/** 从偏好标签内、未展示过的评论里随机取一条；无则返回 null（不推空内容） */
export function pickNext(preferredTags: CommentTag[]): TaggedComment | null {
  const candidates = items.filter(
    (c) => preferredTags.includes(c.tag) && !shownIds.has(c.id)
  )
  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** 是否还有可推送的未展示评论 */
export function hasUnshown(preferredTags: CommentTag[]): boolean {
  return items.some((c) => preferredTags.includes(c.tag) && !shownIds.has(c.id))
}

export function findById(id: string): TaggedComment | undefined {
  return items.find((c) => c.id === id)
}
