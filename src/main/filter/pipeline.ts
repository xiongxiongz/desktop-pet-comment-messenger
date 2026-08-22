import type { Comment, Settings, TaggedComment } from '../types'
import { ruleClassifyOne } from './ruleClassifier'
import { llmClassify } from './llmClassifier'

export interface FilterOutcome {
  tagged: TaggedComment[]
  total: number
  usedLlm: boolean
}

/** 解析生效的 LLM key：设置页优先，其次 .env */
export function resolveLlmKey(settings: Settings): string {
  return settings.llm.apiKey.trim() || (process.env.BILI_LLM_KEY ?? '').trim()
}

/**
 * 完整筛选流水线：
 * 1) 规则分类（基线，恒跑）—— 无命中的评论直接丢弃
 * 2) LLM 启用且有 key 时，覆盖标签（任何错误静默回退规则标签）
 * 3) 按偏好标签过滤
 * 4) 按 (点赞 desc, 时间 desc) 排序
 */
export async function runFilter(comments: Comment[], settings: Settings): Promise<FilterOutcome> {
  // 1) 规则分类
  const ruled = comments
    .map((c) => {
      const { tag, score } = ruleClassifyOne(c)
      return tag ? ({ ...c, tag, score, source: 'rule' } as TaggedComment) : null
    })
    .filter((c): c is TaggedComment => c !== null)

  // 2) LLM 覆盖（可选）
  let usedLlm = false
  const key = resolveLlmKey(settings)
  if (settings.llm.enabled && key) {
    try {
      const map = await llmClassify(ruled, settings.llm, key)
      if (map.size > 0) {
        usedLlm = true
        for (const c of ruled) {
          const t = map.get(c.id)
          if (t) {
            c.tag = t
            c.source = 'llm'
          }
        }
      }
    } catch (err) {
      console.error('[pipeline] LLM 分类失败，回退规则标签:', err)
    }
  }

  // 3) 偏好过滤
  const filtered = ruled.filter((c) => settings.preferredTags.includes(c.tag))

  // 4) 排序：点赞降序，其次时间降序
  filtered.sort((a, b) => {
    if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount
    return b.publishedAt.localeCompare(a.publishedAt)
  })

  return { tagged: filtered, total: comments.length, usedLlm }
}
