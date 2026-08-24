import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Comment } from '../types'
import { openCollectionDataProvider, type CollectedItem } from './data-provider'

// 让 data-provider 从主进程入口可达，避免 Vite tree-shake 掉只读查询层。
// 打包后采集库以只读快照形式随 dmg 分发；开发期读 local-data/collections.sqlite。

/** 采集库路径：打包后落在 Resources，开发期在项目根 local-data。 */
export function resolveCollectionDbPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'collections.sqlite')
    : join(__dirname, '../../local-data/collections.sqlite')
}

function toComment(item: CollectedItem): Comment {
  return {
    id: item.platformId,
    videoTitle: item.videoTitle,
    author: item.kind === 'comment' ? item.author : (item.authorHash || '匿名'),
    text: item.text,
    likeCount: item.kind === 'comment' ? item.likeCount : 0,
    publishedAt: item.publishedAt,
    kind: item.kind === 'comment' ? 'comment' : 'danmu'
    // tag 不填：由 runFilter 产出，采集库不含 ground-truth 标签
  }
}

/** 读采集快照；库不存在或为空时返回空数组，交由调用方回退到 comments.json。 */
export function loadCollectedComments(): Comment[] {
  const dbPath = resolveCollectionDbPath()
  if (!existsSync(dbPath)) return []
  const provider = openCollectionDataProvider(dbPath)
  try {
    return provider.listItems().map(toComment)
  } finally {
    provider.close()
  }
}
