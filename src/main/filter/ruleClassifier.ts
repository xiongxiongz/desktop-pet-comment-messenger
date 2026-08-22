import type { Comment, CommentTag } from '../types'
import { COMMENT_TAGS } from '../types'
import { KEYWORDS } from './keywords'

/**
 * 规则分类：对每类标签统计关键词命中数，取命中最多的标签。
 * 无任何命中 → null（流水线中丢弃）。
 */
export function ruleClassifyOne(comment: Comment): CommentTag | null {
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

  return bestTag
}
