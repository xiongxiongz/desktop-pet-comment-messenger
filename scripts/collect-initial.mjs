import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openCollectionDatabase } from './collection-db.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(projectRoot, '.env')
const databasePath = join(projectRoot, 'local-data', 'collections.sqlite')

const DEFAULT_BVID = 'BV1xV8j6eEUR'
const PAGE_SIZE = 20
const REQUEST_DELAY_MS = 180

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43,
  5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7,
  16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21,
  56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

function parseEnv(text) {
  const result = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function getBvid() {
  const explicit = process.argv.find((arg) => arg.startsWith('--bvid='))
  return explicit ? explicit.slice('--bvid='.length) : DEFAULT_BVID
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isoFromSeconds(seconds) {
  return new Date(Number(seconds) * 1000).toISOString()
}

function getHeaders(sessdata) {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    Referer: 'https://www.bilibili.com/',
    Cookie: `SESSDATA=${sessdata}`
  }
}

async function getJson(url, headers) {
  let lastMessage = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers })
    const data = await response.json()
    if (data.code === 0) return data
    lastMessage = `${data.code}: ${data.message || 'unknown error'}`
    if (data.code !== -799 && data.code !== -412) break
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`B 站接口失败：${lastMessage}`)
}

async function getBinary(url, headers) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`弹幕接口 HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes[0] === 0x7b) throw new Error(`弹幕接口返回 JSON：${bytes.toString('utf8').slice(0, 160)}`)
  return bytes
}

function readVarint(buffer, start) {
  let value = 0n
  let shift = 0n
  let offset = start
  while (offset < buffer.length) {
    const byte = buffer[offset]
    offset += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7n
    if (shift > 70n) throw new Error('protobuf varint 太长')
  }
  throw new Error('protobuf 数据不完整')
}

function readBytes(buffer, start) {
  const length = readVarint(buffer, start)
  const end = length.offset + Number(length.value)
  if (end > buffer.length) throw new Error('protobuf 字段越界')
  return { value: buffer.subarray(length.offset, end), offset: end }
}

function skipField(buffer, start, wireType) {
  if (wireType === 0) return readVarint(buffer, start).offset
  if (wireType === 1) return start + 8
  if (wireType === 2) return readBytes(buffer, start).offset
  if (wireType === 5) return start + 4
  throw new Error(`不支持的 protobuf wire type: ${wireType}`)
}

function parseDanmakuElem(buffer) {
  const elem = {}
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const field = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (wireType === 0) {
      const fieldValue = readVarint(buffer, offset)
      offset = fieldValue.offset
      if (field === 1) elem.id = fieldValue.value.toString()
      if (field === 2) elem.progress = Number(fieldValue.value)
      if (field === 3) elem.mode = Number(fieldValue.value)
      if (field === 4) elem.fontsize = Number(fieldValue.value)
      if (field === 5) elem.color = Number(fieldValue.value)
      if (field === 8) elem.ctime = Number(fieldValue.value)
      if (field === 9) elem.weight = Number(fieldValue.value)
      if (field === 11) elem.pool = Number(fieldValue.value)
      if (field === 13) elem.attr = Number(fieldValue.value)
      continue
    }
    if (wireType === 2) {
      const fieldValue = readBytes(buffer, offset)
      offset = fieldValue.offset
      if (field === 6) elem.midHash = fieldValue.value.toString('utf8')
      if (field === 7) elem.content = fieldValue.value.toString('utf8')
      if (field === 10) elem.action = fieldValue.value.toString('utf8')
      if (field === 12) elem.idStr = fieldValue.value.toString('utf8')
      continue
    }
    offset = skipField(buffer, offset, wireType)
  }
  return elem
}

function parseDanmakuReply(buffer) {
  if (buffer[0] === 0x7b) throw new Error(`弹幕接口返回 JSON：${buffer.toString('utf8').slice(0, 160)}`)
  const elems = []
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const field = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (field === 1 && wireType === 2) {
      const fieldValue = readBytes(buffer, offset)
      offset = fieldValue.offset
      elems.push(parseDanmakuElem(fieldValue.value))
    } else {
      offset = skipField(buffer, offset, wireType)
    }
  }
  return elems
}

function parseDmSegConfig(buffer) {
  const config = {}
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const field = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (wireType === 0 && (field === 1 || field === 2)) {
      const fieldValue = readVarint(buffer, offset)
      offset = fieldValue.offset
      if (field === 1) config.pageSize = Number(fieldValue.value)
      if (field === 2) config.total = Number(fieldValue.value)
      continue
    }
    offset = skipField(buffer, offset, wireType)
  }
  return config
}

function parseCommandDanmaku(buffer) {
  const item = {}
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const field = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (wireType === 0) {
      const fieldValue = readVarint(buffer, offset)
      offset = fieldValue.offset
      if (field === 1) item.id = fieldValue.value.toString()
      if (field === 2) item.oid = fieldValue.value.toString()
      if (field === 3) item.mid = fieldValue.value.toString()
      if (field === 6) item.progress = Number(fieldValue.value)
      continue
    }
    if (wireType === 2) {
      const fieldValue = readBytes(buffer, offset)
      offset = fieldValue.offset
      if (field === 4) item.command = fieldValue.value.toString('utf8')
      if (field === 5) item.content = fieldValue.value.toString('utf8')
      if (field === 7) item.ctime = fieldValue.value.toString('utf8')
      if (field === 8) item.mtime = fieldValue.value.toString('utf8')
      if (field === 9) item.extra = fieldValue.value.toString('utf8')
      if (field === 10) item.idStr = fieldValue.value.toString('utf8')
      continue
    }
    offset = skipField(buffer, offset, wireType)
  }
  return item
}

function parseDanmakuView(buffer) {
  const view = {
    state: 0,
    count: 0,
    segmentConfig: {},
    specialDms: [],
    commandDms: []
  }
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const field = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (wireType === 0) {
      const fieldValue = readVarint(buffer, offset)
      offset = fieldValue.offset
      if (field === 1) view.state = Number(fieldValue.value)
      if (field === 8) view.count = Number(fieldValue.value)
      continue
    }
    if (wireType === 2) {
      const fieldValue = readBytes(buffer, offset)
      offset = fieldValue.offset
      if (field === 4) view.segmentConfig = parseDmSegConfig(fieldValue.value)
      if (field === 6) view.specialDms.push(fieldValue.value.toString('utf8'))
      if (field === 9) view.commandDms.push(parseCommandDanmaku(fieldValue.value))
      continue
    }
    offset = skipField(buffer, offset, wireType)
  }
  return view
}

function wbiKeysFromNav(nav) {
  const imgUrl = nav?.data?.wbi_img?.img_url
  const subUrl = nav?.data?.wbi_img?.sub_url
  if (!imgUrl || !subUrl) throw new Error('无法获取 B 站 WBI key')
  return {
    imgKey: imgUrl.split('/').pop().split('.')[0],
    subKey: subUrl.split('/').pop().split('.')[0]
  }
}

function signWbi(params, imgKey, subKey) {
  const mixinKey = MIXIN_KEY_ENC_TAB.map((index) => `${imgKey}${subKey}`[index]).join('').slice(0, 32)
  const wts = Math.floor(Date.now() / 1000).toString()
  const signing = { ...params, wts }
  const query = Object.keys(signing).sort().map((key) => {
    const value = String(signing[key]).replace(/[!'()*]/g, '')
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }).join('&')
  const wRid = createHash('md5').update(query + mixinKey).digest('hex')
  return new URLSearchParams({ ...params, wts, w_rid: wRid })
}

async function getWbiKeys(headers) {
  const navUrl = new URL('https://api.bilibili.com/x/web-interface/nav')
  return wbiKeysFromNav(await getJson(navUrl, headers))
}

async function getWbiJson(endpoint, params, headers, keys) {
  const url = new URL(endpoint)
  url.search = signWbi(params, keys.imgKey, keys.subKey)
  return getJson(url, headers)
}

async function collectComments(aid, video, headers, wbiKeys) {
  const comments = []
  const seen = new Set()
  let pageCount = 0
  let platformReportedCount = null
  let nextOffset = null
  while (true) {
    const params = {
      type: '1',
      oid: String(aid),
      mode: '2',
      plat: '1',
      web_location: '1315875'
    }
    if (nextOffset) params.pagination_str = JSON.stringify({ offset: nextOffset })
    const data = await getWbiJson('https://api.bilibili.com/x/v2/reply/wbi/main', params, headers, wbiKeys)
    pageCount += 1
    platformReportedCount = data.data?.cursor?.all_count ?? platformReportedCount
    for (const item of data.data?.replies || []) {
      const id = String(item.rpid)
      if (seen.has(id)) continue
      seen.add(id)
      comments.push({
        id: `comment:${id}`,
        platformId: id,
        sourceVideoId: video.bvid,
        videoTitle: video.title,
        author: item.member?.uname || '匿名用户',
        authorId: String(item.mid ?? ''),
        text: item.content?.message || '',
        likeCount: Number(item.like || 0),
        replyCount: Number(item.rcount ?? 0),
        subReplyCount: Number(item.count ?? 0),
        state: Number(item.state ?? 0),
        invisible: item.invisible ? 1 : 0,
        publishedAt: isoFromSeconds(item.ctime),
        kind: 'comment'
      })
    }
    const cursor = data.data?.cursor
    console.log(`评论游标第 ${pageCount} 页，已收集 ${comments.length} 条`)
    if (cursor?.is_end || !cursor?.pagination_reply?.next_offset || !(data.data?.replies || []).length) break
    nextOffset = cursor.pagination_reply.next_offset
    await sleep(REQUEST_DELAY_MS)
  }
  return { comments, platformReportedCount, pageCount }
}

async function collectDanmakuPage(video, page, headers, seen) {
  const viewUrl = new URL('https://api.bilibili.com/x/v2/dm/web/view')
  viewUrl.search = new URLSearchParams({
    type: '1',
    oid: String(page.cid),
    pid: String(video.aid)
  })
  const view = parseDanmakuView(await getBinary(viewUrl, headers))
  const pageSizeMs = Number(view.segmentConfig.pageSize || 360000)
  const segmentCount = Number(
    view.segmentConfig.total || Math.ceil((Number(page.duration) * 1000) / pageSizeMs)
  )
  const pageStats = {
    page: page.page,
    cid: String(page.cid),
    platformReportedCount: view.count,
    pageSizeMs,
    segmentCount,
    commandDanmakuCount: view.commandDms.length,
    specialDanmakuPackageCount: view.specialDms.length
  }

  if (view.state !== 0 || segmentCount === 0) {
    console.log(`弹幕 P${page.page}：弹幕关闭或没有分段`)
    return { danmaku: [], stats: pageStats }
  }

  const danmaku = []
  for (let segmentIndex = 1; segmentIndex <= segmentCount; segmentIndex += 1) {
    const segmentUrl = new URL('https://api.bilibili.com/x/v2/dm/web/seg.so')
    segmentUrl.search = new URLSearchParams({
      type: '1',
      oid: String(page.cid),
      pid: String(video.aid),
      segment_index: String(segmentIndex)
    })
    const segmentItems = parseDanmakuReply(await getBinary(segmentUrl, headers))
    let added = 0
    for (const item of segmentItems) {
      const platformId = item.idStr || item.id
      if (!platformId || seen.has(platformId) || !item.content) continue
      seen.add(platformId)
      danmaku.push({
        id: `danmu:${platformId}`,
        platformId,
        sourceVideoId: video.bvid,
        sourcePage: page.page,
        sourceCid: String(page.cid),
        videoTitle: video.title,
        author: item.midHash || '匿名弹幕用户',
        text: item.content,
        likeCount: 0,
        publishedAt: item.ctime ? isoFromSeconds(item.ctime) : new Date().toISOString(),
        kind: 'danmu',
        progressMs: item.progress ?? 0,
        mode: item.mode ?? 0,
        segmentIndex
      })
      added += 1
    }
    console.log(`弹幕 P${page.page} 分段 ${segmentIndex}/${segmentCount}：本段 ${added} 条，累计 ${danmaku.length} 条`)
    await sleep(REQUEST_DELAY_MS)
  }
  return { danmaku, stats: pageStats }
}

async function collectDanmaku(video, headers) {
  const danmaku = []
  const seen = new Set()
  const pages = []
  for (const page of video.pages) {
    const result = await collectDanmakuPage(video, page, headers, seen)
    danmaku.push(...result.danmaku)
    pages.push(result.stats)
  }
  return { danmaku, pages }
}

async function main() {
  const env = parseEnv(readFileSync(envPath, 'utf8'))
  const sessdata = env.BILI_SESSDATA?.trim()
  if (!sessdata) throw new Error('缺少 BILI_SESSDATA，请填写项目根目录 .env')

  const bvid = getBvid()
  const headers = getHeaders(sessdata)
  const viewUrl = new URL('https://api.bilibili.com/x/web-interface/view')
  viewUrl.search = new URLSearchParams({ bvid })
  const view = await getJson(viewUrl, headers)
  const video = view.data
  if (!video?.aid || !video.pages?.length) throw new Error('视频信息缺少 aid 或 cid')

  console.log(`开始采集：${video.bvid} ${video.title}`)
  const wbiKeys = await getWbiKeys(headers)
  const commentResult = await collectComments(video.aid, video, headers, wbiKeys)
  const danmakuResult = await collectDanmaku(video, headers)
  const collectedAt = new Date().toISOString()
  const database = openCollectionDatabase(databasePath)
  try {
    database.saveCollection({
      video,
      comments: commentResult.comments,
      danmaku: danmakuResult.danmaku,
      collectedAt,
      commentResult,
      danmakuResult
    })
    console.log(`采集完成，已写入 SQLite：${databasePath}`)
    console.log(JSON.stringify({
      currentRun: {
        comments: commentResult.comments.length,
        commentPlatformReportedCount: commentResult.platformReportedCount,
        commentPages: commentResult.pageCount,
        danmaku: danmakuResult.danmaku.length,
        danmakuPages: danmakuResult.pages
      },
      stored: database.getCounts(video.bvid)
    }, null, 2))
  } finally {
    database.close()
  }
}

main().catch((error) => {
  console.error(`采集失败：${error.message}`)
  process.exitCode = 1
})
