import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // すべてのテストが同じ Emulator のデータを使うので、並列に実行しない
    fileParallelism: false,
  },
})
