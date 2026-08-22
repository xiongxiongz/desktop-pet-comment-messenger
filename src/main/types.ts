// 共享数据 schema：main / preload / renderer 皆引用（renderer 仅做类型导入）

export type CommentTag = '鼓励与认可' | '有趣互动' | '选题建议' | '内容改进意见'

export const COMMENT_TAGS: CommentTag[] = ['鼓励与认可', '有趣互动', '选题建议', '内容改进意见']

/** 预置 JSON 的原始评论形态 */
export interface Comment {
  id: string
  videoTitle: string
  author: string // 脱敏
  text: string
  likeCount: number
  publishedAt: string // ISO
  kind: 'comment' | 'danmu'
  tag?: CommentTag // 可选 ground-truth，供 demo 验证分类准确率
}

/** 经流水线分类后的评论 */
export interface TaggedComment extends Comment {
  tag: CommentTag
  score: number
  source: 'rule' | 'llm'
}

export interface TimeWindow {
  start: string // 'HH:MM'
  end: string // 'HH:MM'
}

export interface LlmSettings {
  provider: 'bili-glm'
  model: 'glm-5.2'
  apiKey: string
  baseURL: string
  enabled: boolean
}

export interface Settings {
  petName: string // 桌宠名称，推荐设为粉丝称呼以强化陪伴感
  skin: 'cat' | 'dog' | 'robot'
  preferredTags: CommentTag[]
  activeWindow: TimeWindow
  dndWindow: TimeWindow
  dailyCap: number
  pushEnabled: boolean
  minIntervalSec: number
  maxIntervalSec: number
  llm: LlmSettings
}

export interface PersistedState {
  settings: Settings
  favorites: string[]
}

/** 传给 renderer 的桌宠气泡负载（不含敏感字段） */
export interface PushPayload {
  id: string
  author: string
  text: string
  videoTitle: string
  tag: CommentTag
  likeCount: number
  kind: 'comment' | 'danmu'
  favorited: boolean
}

/** 设置页拿到的筛选汇总 */
export interface FilterResult {
  filtered: number
  total: number
  usedLlm: boolean
}

/** 收藏列表项（设置页展示用） */
export interface FavoriteItem {
  id: string
  author: string
  text: string
  videoTitle: string
  likeCount: number
  kind: 'comment' | 'danmu'
  tag?: CommentTag
}

/** 暴露给 renderer 的安全设置视图（llm 只给布尔） */
export interface SettingsView extends Omit<Settings, 'llm'> {
  llmEnabled: boolean
  llmHasKey: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  petName: '朋友',
  skin: 'cat',
  preferredTags: ['鼓励与认可', '有趣互动', '选题建议', '内容改进意见'],
  activeWindow: { start: '09:00', end: '23:00' },
  dndWindow: { start: '12:00', end: '13:00' },
  dailyCap: 20,
  pushEnabled: true,
  minIntervalSec: 30,
  maxIntervalSec: 120,
  llm: {
    provider: 'bili-glm',
    model: 'glm-5.2',
    apiKey: '',
    baseURL: 'http://llmapi.bilibili.co/v1',
    enabled: false
  }
}
