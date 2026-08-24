import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'electron-vite'

// 原生模块（better-sqlite3）必须 external：其内部用 bindings() 动态 require 加载 .node，
// 若被 bundle 进 asar，动态 require 解析失败。external 后运行时从 node_modules 加载，
// .node 由 electron-builder 解包到 app.asar.unpacked，electron 透明重定向。
const external = [
  'better-sqlite3',
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html')
        }
      }
    }
  }
})
