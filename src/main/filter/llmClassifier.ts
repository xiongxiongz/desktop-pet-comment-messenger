import type { Comment, CommentTag, LlmSettings, ReactionSpec, ReactionIntent } from '../types'
import { COMMENT_TAGS } from '../types'
import { recordLlmOperation } from '../llmCache'

// glm-5.2 语义分类适配器（OpenAI 兼容协议）。
// 仅在 LLM 启用且有 key 时调用；任何错误由 pipeline 捕获并回退规则标签。
// `openai` 包在此懒加载，是唯一引入 LLM 依赖的文件。

const TAG_SET = new Set<string>(COMMENT_TAGS)
const INTENTS = new Set<string>(['action', 'emotion', 'expression', 'scene', 'interaction', 'other'])

function buildPrompt(comments: Comment[]): string {
  const list = comments
    .map((c) => `${c.id}\t${c.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    .join('\n')
  return [
    '你是一个 B 站 UP 主的评论分类助手。请把每条评论归入以下类别之一：',
    '「鼓励与认可」「有趣互动」「选题建议」「内容改进意见」。',
    '若评论只是灌水、单纯占楼（如「第一」「沙发」「mark」「路过」）或与以上四类都无关，归为「无关」。',
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
  const prompt = buildPrompt(comments)
  try {
    const res = await client.chat.completions.create({
      model: llm.model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
    const content = res.choices[0]?.message?.content ?? '{}'
    const raw = JSON.parse(content) as { results?: Array<{ id?: string; tag?: string }> } | Array<{ id?: string; tag?: string }>
    const parsed = Array.isArray(raw) ? { results: raw } : raw
    const map = new Map<string, CommentTag>()
    for (const r of parsed.results ?? []) {
      if (r.id && r.tag && TAG_SET.has(r.tag)) map.set(r.id, r.tag as CommentTag)
    }
    recordLlmOperation({ operation: 'classification', model: llm.model, comments, prompt, result: parsed })
    return map
  } catch (err) {
    recordLlmOperation({ operation: 'classification', model: llm.model, comments, prompt, error: err })
    throw err
  }
}

/**
 * 轻量校验 key：发一次 max_tokens=1 的 chat completion，
 * 既验 key，又验 model 名与端点是否真的可分类。失败抛出（带 .status 的 OpenAI 错误）。
 */
export async function llmTestKey(llm: LlmSettings, apiKey: string): Promise<void> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, baseURL: llm.baseURL })
  const prompt = 'ping'
  try {
    await client.chat.completions.create({
      model: llm.model,
      max_tokens: 1,
      messages: [{ role: 'user', content: prompt }]
    })
  } catch (err) {
    recordLlmOperation({ operation: 'key-test', model: llm.model, comments: [], prompt, error: err })
    throw err
  }
}

export async function llmReact(comments: Comment[], llm: LlmSettings, apiKey: string): Promise<Map<string, ReactionSpec>> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, baseURL: llm.baseURL })
  const list = comments.map((c) => `${c.id}\t${c.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
  const prompt = [
    '你是桌宠评论反应设计助手。判断评论是否包含值得视觉演出的动作、情绪、表情、场景或互动。',
    '普通问候、建议、事实陈述和无明显反应返回 shouldGenerate=false。',
    'intents 只能使用 action、emotion、expression、scene、interaction、other，可多选；不要输出具体动作枚举。',
    'visualPrompt 用简短中文描述单个角色应呈现的姿势、表情、道具和局部环境，不要包含文字内容，最多 180 字。',
    '只输出 JSON：{"results":[{"id":"...","shouldGenerate":true,"intents":["action"],"visualPrompt":"..."}]}',
    '', '评论列表（每行 id<TAB>文本）：', list
  ].join('\n')
  try {
    const res = await client.chat.completions.create({ model: llm.model, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] })
    const raw = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { results?: Array<{ id?: string; shouldGenerate?: boolean; intents?: string[]; visualPrompt?: string }> } | Array<{ id?: string; shouldGenerate?: boolean; intents?: string[]; visualPrompt?: string }>
    const parsed = Array.isArray(raw) ? { results: raw } : raw
    const map = new Map<string, ReactionSpec>()
    for (const item of parsed.results ?? []) {
      if (!item.id || !item.shouldGenerate || !item.visualPrompt) continue
      const intents = (item.intents ?? []).filter((v): v is ReactionIntent => INTENTS.has(v)).slice(0, 4)
      if (intents.length) map.set(item.id, { shouldGenerate: true, intents, visualPrompt: item.visualPrompt.slice(0, 180) })
    }
    recordLlmOperation({ operation: 'reaction-analysis', model: llm.model, comments, prompt, result: parsed })
    return map
  } catch (err) {
    recordLlmOperation({ operation: 'reaction-analysis', model: llm.model, comments, prompt, error: err })
    throw err
  }
}
