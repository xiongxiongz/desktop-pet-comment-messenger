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

export type PetSkin = 'cat' | 'dog' | 'robot' | 'custom'

/** 大小滑块作用于图片内容，或同时作用于图片所在的显示框。 */
export type SkinScaleMode = 'content' | 'frame'

export interface SkinPlacement {
  scale: number
  offsetX: number
  offsetY: number
  scaleMode: SkinScaleMode
}

export type CustomSkinShape = 'square' | 'circle'

/** 应用管理的单个自定义皮肤；只保存安全的应用文件名，不保存用户原始路径。 */
export interface CustomSkin {
  id: string
  name: string
  /** 空字符串代表“未分类”文件夹。 */
  folderId: string
  /** 桌宠显示时的裁切形状。 */
  shape: CustomSkinShape
  fileName: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  animated: boolean
  createdAt: string
}

/** renderer 使用的皮肤库条目，不含本地文件名。 */
export interface CustomSkinView {
  id: string
  name: string
  folderId: string
  shape: CustomSkinShape
  animated: boolean
  url: string
}

/** 皮肤库的逻辑文件夹；文件本身仍安全地存放在应用目录中。 */
export interface CustomSkinFolder {
  id: string
  name: string
  createdAt: string
}

export interface CustomSkinFolderView {
  id: string
  name: string
}

export interface CandidateSkinView {
  url: string
  defaultName: string
  animated: boolean
}

export interface Settings {
  petName: string // 桌宠名称，推荐设为粉丝称呼以强化陪伴感
  skin: PetSkin
  /** 仅保存由应用导入的皮肤文件名，绝不保存用户任意路径。 */
  customSkinFile: string
  /** 自定义皮肤的显示参数：缩放百分比及相对中心的像素偏移。 */
  customSkinScale: number
  customSkinOffsetX: number
  customSkinOffsetY: number
  /** 每种皮肤独立保存的显示参数，切换皮肤后会自动恢复。 */
  skinPlacements: Record<PetSkin, SkinPlacement>
  /** 自定义皮肤库及当前选择项。 */
  customSkins: CustomSkin[]
  customSkinFolders: CustomSkinFolder[]
  selectedCustomSkinId: string
  /** 每一张自定义皮肤独立保存显示位置。 */
  customSkinPlacements: Record<string, SkinPlacement>
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
export interface SettingsView extends Omit<Settings, 'llm' | 'customSkinFile' | 'customSkins' | 'customSkinFolders'> {
  customSkins: CustomSkinView[]
  customSkinFolders: CustomSkinFolderView[]
  llmEnabled: boolean
  llmHasKey: boolean
  /** 仅供 renderer 显示当前皮肤的受控地址，不暴露本机文件路径。 */
  customSkinUrl: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  petName: '朋友',
  skin: 'cat',
  customSkinFile: '',
  customSkinScale: 100,
  customSkinOffsetX: 0,
  customSkinOffsetY: 0,
  skinPlacements: {
    cat: { scale: 100, offsetX: 0, offsetY: 0, scaleMode: 'content' },
    dog: { scale: 100, offsetX: 0, offsetY: 0, scaleMode: 'content' },
    robot: { scale: 100, offsetX: 0, offsetY: 0, scaleMode: 'content' },
    custom: { scale: 100, offsetX: 0, offsetY: 0, scaleMode: 'content' }
  },
  customSkins: [],
  customSkinFolders: [],
  selectedCustomSkinId: '',
  customSkinPlacements: {},
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
