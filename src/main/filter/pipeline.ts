import type { Comment, Settings, TaggedComment } from '../types'
import { ruleClassifyOne } from './ruleClassifier'
import { llmClassify } from './llmClassifier'

export interface FilterOutcome {
  tagged: TaggedComment[]
  total: number
  usedLlm: boolean
}

// id → 已分类结果缓存（内存，随进程生灭，与 demo 队列同生命周期）。
// 用户改偏好重新筛选时命中缓存，不重复打 LLM。
const tagCache = new Map<string, TaggedComment>()

/** 解析生效的 LLM key：设置页优先，其次 .env */
export function resolveLlmKey(settings: Settings): string {
  return settings.llm.apiKey.trim() || (process.env.BILI_LLM_KEY ?? '').trim()
}

/** 规则分类：无命中的评论丢弃 */
function classifyByRule(comments: Comment[]): TaggedComment[] {
  return comments
    .map((c) => {
      const tag = ruleClassifyOne(c)
      return tag ? ({ ...c, tag, source: 'rule' } as TaggedComment) : null
    })
    .filter((c): c is TaggedComment => c !== null)
}

/**
 * LLM 分类（成本受控）：
 * - Top-K 预裁剪：按点赞降序取前 topK 条，成本上限固定
 * - 缓存命中：已分类的直接取缓存，不入请求
 * - 只保留 tag 属于 4 类的评论（LLM 判「无关」的噪声天然被丢弃）
 * 任何异常向上抛出，由 runFilter 落回规则分支。
 */
async function classifyByLlm(
  comments: Comment[],
  settings: Settings,
  key: string
): Promise<TaggedComment[]> {
  const topK = Math.max(1, settings.llm.topK)
  const ranked = [...comments].sort((a, b) => b.likeCount - a.likeCount).slice(0, topK)

  const cached: TaggedComment[] = []
  const toClassify: Comment[] = []
  for (const c of ranked) {
    const hit = tagCache.get(c.id)
    if (hit) cached.push(hit)
    else toClassify.push(c)
  }

  const fresh: TaggedComment[] = []
  let dropped = 0
  if (toClassify.length > 0) {
    const map = await llmClassify(toClassify, settings.llm, key)
    for (const c of toClassify) {
      const tag = map.get(c.id)
      if (!tag) {
        dropped++
        continue // 不在 map = LLM 判「无关」或漏答，丢弃
      }
      const tc: TaggedComment = { ...c, tag, source: 'llm' }
      tagCache.set(c.id, tc)
      fresh.push(tc)
    }
  }

  // 可观测：连续两次筛选可见「新调用」从 N 降到 0（缓存命中）
  console.log(
    `[LLM] top-K=${ranked.length} 命中缓存=${cached.length} 新调用=${toClassify.length} ` +
      `保留=${fresh.length} 判无关丢弃=${dropped} 缓存总量=${tagCache.size}`
  )

  return [...cached, ...fresh]
}

/**
 * 完整筛选流水线：
 * 1) 分类：LLM 激活（enabled && key）走 LLM 分支，否则/失败走规则分支
 * 2) 按偏好标签过滤
 * 3) 按 (点赞 desc, 时间 desc) 排序
 */
export async function runFilter(comments: Comment[], settings: Settings): Promise<FilterOutcome> {
  let tagged: TaggedComment[]
  let usedLlm = false

  const key = resolveLlmKey(settings)
  if (settings.llm.enabled && key) {
    try {
      tagged = await classifyByLlm(comments, settings, key)
      usedLlm = true
    } catch (err) {
      console.error('[pipeline] LLM 分类失败，回退规则分类:', err)
      tagged = classifyByRule(comments)
    }
  } else {
    tagged = classifyByRule(comments)
  }

  // 偏好过滤
  const filtered = tagged.filter((c) => settings.preferredTags.includes(c.tag))

  // 排序：点赞降序，其次时间降序
  filtered.sort((a, b) => {
    if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount
    return b.publishedAt.localeCompare(a.publishedAt)
  })

  return { tagged: filtered, total: comments.length, usedLlm }
}
