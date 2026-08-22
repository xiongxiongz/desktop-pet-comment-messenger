import type { Comment, CommentTag, LlmSettings } from '../types'
import { COMMENT_TAGS } from '../types'

// glm-5.2 语义分类适配器（OpenAI 兼容协议）。
// 仅在 LLM 启用且有 key 时调用；任何错误由 pipeline 捕获并回退规则标签。
// `openai` 包在此懒加载，是唯一引入 LLM 依赖的文件。

const TAG_SET = new Set<string>(COMMENT_TAGS)

function buildPrompt(comments: Comment[]): string {
  const list = comments
    .map((c) => `${c.id}\t${c.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    .join('\n')
  return [
    '你是一个 B 站 UP 主的评论分类助手。请把每条评论归入且仅归入以下四类之一：',
    '「鼓励与认可」「有趣互动」「选题建议」「内容改进意见」。',
    '若都不符合，归为「鼓励与认可」（保守兜底）。',
    '',
    '评论列表（每行格式：id<TAB>文本）：',
    list,
    '',
    '只输出 JSON，格式为 {"results":[{"id":"...","tag":"..."}]}，不要多余文字。'
  ].join('\n')
}

/** 返回 id -> tag 映射；调用方负责 try/catch 回退 */
export async function llmClassify(
  comments: Comment[],
  llm: LlmSettings,
  apiKey: string
): Promise<Map<string, CommentTag>> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, baseURL: llm.baseURL })

  const res = await client.chat.completions.create({
    model: llm.model,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: buildPrompt(comments) }]
  })

  const content = res.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(content) as { results?: Array<{ id?: string; tag?: string }> }
  const map = new Map<string, CommentTag>()
  for (const r of parsed.results ?? []) {
    if (r.id && r.tag && TAG_SET.has(r.tag)) {
      map.set(r.id, r.tag as CommentTag)
    }
  }
  return map
}
