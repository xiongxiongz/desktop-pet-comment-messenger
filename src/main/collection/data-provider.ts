import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'

export type CollectedKind = 'comment' | 'danmu'

export interface CollectionQuery {
  bvid?: string
  kind?: CollectedKind
  publishedAfter?: string
  publishedBefore?: string
  limit?: number
  offset?: number
}

export interface CollectedComment {
  id: string
  kind: 'comment'
  bvid: string
  aid: string
  videoTitle: string
  platformId: string
  author: string
  authorId: string
  text: string
  likeCount: number
  replyCount: number
  subReplyCount: number
  state: number
  invisible: boolean
  publishedAt: string
  firstCollectedAt: string
  lastSeenAt: string
}

export interface CollectedDanmaku {
  id: string
  kind: 'danmu'
  bvid: string
  aid: string
  videoTitle: string
  platformId: string
  authorHash: string
  text: string
  publishedAt: string
  progressMs: number
  mode: number
  sourcePage: number
  sourceCid: string
  segmentIndex: number
  firstCollectedAt: string
  lastSeenAt: string
}

export type CollectedItem = CollectedComment | CollectedDanmaku

export interface CollectedVideoPage {
  page: number
  cid: string
  part: string
  duration: number
}

export interface CollectedVideo {
  bvid: string
  aid: string
  title: string
  pubdate: string
  lastCollectedAt: string
  commentCount: number
  danmakuCount: number
  collectionRunCount: number
  pages: CollectedVideoPage[]
}

export interface CollectionPageStats {
  page: number
  cid: string
  platformReportedCount: number
  pageSizeMs: number
  segmentCount: number
  commandDanmakuCount: number
  specialDanmakuPackageCount: number
}

export interface CollectionRun {
  id: number
  bvid: string
  collectedAt: string
  commentCount: number
  danmakuCount: number
  commentPages: number
  danmakuPages: CollectionPageStats[]
}

export interface CollectionDataProvider {
  listItems(query?: CollectionQuery): CollectedItem[]
  listComments(query?: Omit<CollectionQuery, 'kind'>): CollectedComment[]
  listDanmaku(query?: Omit<CollectionQuery, 'kind'>): CollectedDanmaku[]
  listVideos(): CollectedVideo[]
  getVideo(bvid: string): CollectedVideo | undefined
  listRuns(bvid?: string): CollectionRun[]
  close(): void
}

interface QueryParams {
  bvid?: string
  publishedAfter?: string
  publishedBefore?: string
  limit?: number
  offset?: number
}

interface CommentRow {
  bvid: string
  aid: string
  video_title: string
  platform_id: string
  author: string
  author_id: string
  content: string
  like_count: number
  reply_count: number
  sub_reply_count: number
  state: number
  invisible: number
  published_at: string
  first_collected_at: string
  last_seen_at: string
}

interface DanmakuRow {
  bvid: string
  aid: string
  video_title: string
  platform_id: string
  author_hash: string
  content: string
  published_at: string
  progress_ms: number
  mode: number
  page: number
  cid: string
  segment_index: number
  first_collected_at: string
  last_seen_at: string
}

interface ItemRow {
  kind: CollectedKind
  bvid: string
  aid: string
  video_title: string
  platform_id: string
  author: string
  author_id: string
  author_hash: string | null
  content: string
  like_count: number
  reply_count: number | null
  sub_reply_count: number | null
  state: number | null
  invisible: number | null
  published_at: string
  progress_ms: number | null
  mode: number | null
  source_page: number | null
  source_cid: string | null
  segment_index: number | null
  first_collected_at: string
  last_seen_at: string
}

interface VideoRow {
  bvid: string
  aid: string
  title: string
  pubdate: string
  last_collected_at: string
  comment_count: number
  danmaku_count: number
  collection_run_count: number
}

interface PageRow {
  bvid: string
  page: number
  cid: string
  part: string
  duration: number
}

interface RunRow {
  id: number
  bvid: string
  collected_at: string
  comment_count: number
  danmaku_count: number
  comment_pages: number
  danmaku_pages_json: string
}

function validatePaging(query: CollectionQuery): void {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
    throw new RangeError('采集数据查询的 limit 必须是正整数')
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    throw new RangeError('采集数据查询的 offset 必须是非负整数')
  }
}

function buildWhere(alias: string, query: CollectionQuery): { sql: string; params: QueryParams } {
  validatePaging(query)
  const clauses: string[] = []
  const params: QueryParams = {}
  if (query.bvid) {
    clauses.push(`${alias}.bvid = @bvid`)
    params.bvid = query.bvid
  }
  if (query.publishedAfter) {
    clauses.push(`${alias}.published_at >= @publishedAfter`)
    params.publishedAfter = query.publishedAfter
  }
  if (query.publishedBefore) {
    clauses.push(`${alias}.published_at < @publishedBefore`)
    params.publishedBefore = query.publishedBefore
  }
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  }
}

function pagingSql(query: CollectionQuery): string {
  if (query.limit !== undefined) {
    return `LIMIT @limit${query.offset !== undefined ? ' OFFSET @offset' : ''}`
  }
  return query.offset !== undefined ? 'LIMIT -1 OFFSET @offset' : ''
}

function pagingParams(query: CollectionQuery): Pick<QueryParams, 'limit' | 'offset'> {
  const params: Pick<QueryParams, 'limit' | 'offset'> = {}
  if (query.limit !== undefined) params.limit = query.limit
  if (query.offset !== undefined) params.offset = query.offset
  return params
}

function itemId(kind: CollectedKind, platformId: string): string {
  return `${kind}:${platformId}`
}

function mapComment(row: CommentRow): CollectedComment {
  return {
    id: itemId('comment', row.platform_id),
    kind: 'comment',
    bvid: row.bvid,
    aid: row.aid,
    videoTitle: row.video_title,
    platformId: row.platform_id,
    author: row.author,
    authorId: row.author_id,
    text: row.content,
    likeCount: row.like_count,
    replyCount: row.reply_count,
    subReplyCount: row.sub_reply_count,
    state: row.state,
    invisible: row.invisible === 1,
    publishedAt: row.published_at,
    firstCollectedAt: row.first_collected_at,
    lastSeenAt: row.last_seen_at
  }
}

function mapDanmaku(row: DanmakuRow): CollectedDanmaku {
  return {
    id: itemId('danmu', row.platform_id),
    kind: 'danmu',
    bvid: row.bvid,
    aid: row.aid,
    videoTitle: row.video_title,
    platformId: row.platform_id,
    authorHash: row.author_hash,
    text: row.content,
    publishedAt: row.published_at,
    progressMs: row.progress_ms,
    mode: row.mode,
    sourcePage: row.page,
    sourceCid: row.cid,
    segmentIndex: row.segment_index,
    firstCollectedAt: row.first_collected_at,
    lastSeenAt: row.last_seen_at
  }
}

function mapItem(row: ItemRow): CollectedItem {
  if (row.kind === 'comment') {
    return {
      id: itemId('comment', row.platform_id),
      kind: 'comment',
      bvid: row.bvid,
      aid: row.aid,
      videoTitle: row.video_title,
      platformId: row.platform_id,
      author: row.author,
      authorId: row.author_id,
      text: row.content,
      likeCount: row.like_count,
      replyCount: row.reply_count ?? 0,
      subReplyCount: row.sub_reply_count ?? 0,
      state: row.state ?? 0,
      invisible: row.invisible === 1,
      publishedAt: row.published_at,
      firstCollectedAt: row.first_collected_at,
      lastSeenAt: row.last_seen_at
    }
  }
  return {
    id: itemId('danmu', row.platform_id),
    kind: 'danmu',
    bvid: row.bvid,
    aid: row.aid,
    videoTitle: row.video_title,
    platformId: row.platform_id,
    authorHash: row.author_hash ?? '',
    text: row.content,
    publishedAt: row.published_at,
    progressMs: row.progress_ms ?? 0,
    mode: row.mode ?? 0,
    sourcePage: row.source_page ?? 0,
    sourceCid: row.source_cid ?? '',
    segmentIndex: row.segment_index ?? 0,
    firstCollectedAt: row.first_collected_at,
    lastSeenAt: row.last_seen_at
  }
}

function parseDanmakuPages(json: string): CollectionPageStats[] {
  try {
    const pages = JSON.parse(json) as unknown
    return Array.isArray(pages) ? pages as CollectionPageStats[] : []
  } catch {
    return []
  }
}

export function openCollectionDataProvider(dbPath: string): CollectionDataProvider {
  if (!existsSync(dbPath)) {
    throw new Error(`采集数据库不存在：${dbPath}`)
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  db.pragma('query_only = ON')

  const listComments = (query: Omit<CollectionQuery, 'kind'> = {}): CollectedComment[] => {
    const where = buildWhere('c', query)
    const params = { ...where.params, ...pagingParams(query) }
    const rows = db.prepare(`
      SELECT
        c.bvid, v.aid, v.title AS video_title, c.platform_id,
        c.author, c.author_id, c.content, c.like_count,
        c.reply_count, c.sub_reply_count, c.state, c.invisible,
        c.published_at, c.first_collected_at, c.last_seen_at
      FROM comments c
      JOIN videos v ON v.bvid = c.bvid
      ${where.sql}
      ORDER BY c.published_at DESC, c.platform_id DESC
      ${pagingSql(query)}
    `).all(params) as CommentRow[]
    return rows.map(mapComment)
  }

  const listDanmaku = (query: Omit<CollectionQuery, 'kind'> = {}): CollectedDanmaku[] => {
    const where = buildWhere('d', query)
    const params = { ...where.params, ...pagingParams(query) }
    const rows = db.prepare(`
      SELECT
        d.bvid, v.aid, v.title AS video_title, d.platform_id,
        d.author_hash, d.content, d.published_at, d.progress_ms,
        d.mode, d.page, d.cid, d.segment_index,
        d.first_collected_at, d.last_seen_at
      FROM danmaku d
      JOIN videos v ON v.bvid = d.bvid
      ${where.sql}
      ORDER BY d.published_at DESC, d.platform_id DESC
      ${pagingSql(query)}
    `).all(params) as DanmakuRow[]
    return rows.map(mapDanmaku)
  }

  const listItems = (query: CollectionQuery = {}): CollectedItem[] => {
    validatePaging(query)
    const selects: string[] = []
    const params: QueryParams = { ...pagingParams(query) }
    if (!query.kind || query.kind === 'comment') {
      const where = buildWhere('c', query)
      selects.push(`
        SELECT
          'comment' AS kind, c.bvid, v.aid, v.title AS video_title,
          c.platform_id, c.author, c.author_id, NULL AS author_hash,
          c.content, c.like_count, c.reply_count, c.sub_reply_count,
          c.state, c.invisible, c.published_at,
          NULL AS progress_ms, NULL AS mode, NULL AS source_page,
          NULL AS source_cid, NULL AS segment_index,
          c.first_collected_at, c.last_seen_at
        FROM comments c
        JOIN videos v ON v.bvid = c.bvid
        ${where.sql}
      `)
      Object.assign(params, where.params)
    }
    if (!query.kind || query.kind === 'danmu') {
      const where = buildWhere('d', query)
      selects.push(`
        SELECT
          'danmu' AS kind, d.bvid, v.aid, v.title AS video_title,
          d.platform_id, d.author_hash AS author, '' AS author_id,
          d.author_hash, d.content, 0 AS like_count,
          NULL AS reply_count, NULL AS sub_reply_count,
          NULL AS state, NULL AS invisible, d.published_at,
          d.progress_ms, d.mode, d.page AS source_page,
          d.cid AS source_cid, d.segment_index,
          d.first_collected_at, d.last_seen_at
        FROM danmaku d
        JOIN videos v ON v.bvid = d.bvid
        ${where.sql}
      `)
      Object.assign(params, where.params)
    }
    if (selects.length === 0) return []
    const rows = db.prepare(`
      ${selects.join('\nUNION ALL\n')}
      ORDER BY published_at DESC, platform_id DESC
      ${pagingSql(query)}
    `).all(params) as ItemRow[]
    return rows.map(mapItem)
  }

  const listVideos = (): CollectedVideo[] => {
    const rows = db.prepare(`
      SELECT
        v.bvid, v.aid, v.title, v.pubdate, v.last_collected_at,
        (SELECT COUNT(*) FROM comments c WHERE c.bvid = v.bvid) AS comment_count,
        (SELECT COUNT(*) FROM danmaku d WHERE d.bvid = v.bvid) AS danmaku_count,
        (SELECT COUNT(*) FROM collection_runs r WHERE r.bvid = v.bvid) AS collection_run_count
      FROM videos v
      ORDER BY v.last_collected_at DESC, v.bvid ASC
    `).all() as VideoRow[]
    const pageRows = db.prepare(`
      SELECT bvid, page, cid, part, duration
      FROM video_pages
      ORDER BY bvid ASC, page ASC
    `).all() as PageRow[]
    const pagesByVideo = new Map<string, CollectedVideoPage[]>()
    for (const page of pageRows) {
      const pages = pagesByVideo.get(page.bvid) || []
      pages.push({ page: page.page, cid: page.cid, part: page.part, duration: page.duration })
      pagesByVideo.set(page.bvid, pages)
    }
    return rows.map((row) => ({
      bvid: row.bvid,
      aid: row.aid,
      title: row.title,
      pubdate: row.pubdate,
      lastCollectedAt: row.last_collected_at,
      commentCount: row.comment_count,
      danmakuCount: row.danmaku_count,
      collectionRunCount: row.collection_run_count,
      pages: pagesByVideo.get(row.bvid) || []
    }))
  }

  const listRuns = (bvid?: string): CollectionRun[] => {
    const rows = bvid
      ? db.prepare(`
          SELECT id, bvid, collected_at, comment_count, danmaku_count,
            comment_pages, danmaku_pages_json
          FROM collection_runs
          WHERE bvid = @bvid
          ORDER BY collected_at DESC, id DESC
        `).all({ bvid }) as RunRow[]
      : db.prepare(`
          SELECT id, bvid, collected_at, comment_count, danmaku_count,
            comment_pages, danmaku_pages_json
          FROM collection_runs
          ORDER BY collected_at DESC, id DESC
        `).all() as RunRow[]
    return rows.map((row) => ({
      id: row.id,
      bvid: row.bvid,
      collectedAt: row.collected_at,
      commentCount: row.comment_count,
      danmakuCount: row.danmaku_count,
      commentPages: row.comment_pages,
      danmakuPages: parseDanmakuPages(row.danmaku_pages_json)
    }))
  }

  const videos = listVideos
  return {
    listItems,
    listComments,
    listDanmaku,
    listVideos,
    getVideo: (bvid) => videos().find((video) => video.bvid === bvid),
    listRuns,
    close: () => db.close()
  }
}
