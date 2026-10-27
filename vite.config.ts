import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const isCloudflare = process.env.BUILD_TARGET === 'cloudflare'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    isCloudflare && cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    !isCloudflare &&
      nitro({
        preset: 'bun',
        plugins: [
          './server/plugins/boot.ts',
          './server/plugins/quiet-client-abort.ts',
        ],
      }),
    viteReact(),
  ],
})

export default config
