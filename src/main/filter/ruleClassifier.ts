import type { Comment, CommentTag } from '../types'
import { COMMENT_TAGS } from '../types'
import { KEYWORDS } from './keywords'

export interface RuleTag {
  tag: CommentTag | null // null = 未分类（无任何关键词命中）
  score: number
}

/**
 * 规则分类：对每类标签统计关键词命中数，取命中最多的标签。
 * score = 命中数 × (1 + 点赞对数权重)，供后续排序参考。
 * 无任何命中 → tag=null（流水线中丢弃）。
 */
export function ruleClassifyOne(comment: Comment): RuleTag {
  let bestTag: CommentTag | null = null
  let bestHits = 0

  for (const tag of COMMENT_TAGS) {
    let hits = 0
    for (const kw of KEYWORDS[tag]) {
      if (comment.text.includes(kw)) hits++
    }
    if (hits > bestHits) {
      bestHits = hits
      bestTag = tag
    }
  }

  if (bestTag === null) return { tag: null, score: 0 }

  const likeWeight = 1 + Math.log10(Math.max(1, comment.likeCount))
  return { tag: bestTag, score: bestHits * likeWeight }
}
