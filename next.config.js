/** @type {import('next').NextConfig} */
const nextConfig = {
  // ★追加: GitHub Pagesで動かすための必須設定
  output: 'export', 
  images: {
    unoptimized: true, // 画像最適化を無効化（これがないとエラーになります）
  },

  // --- 以下は元々あった設定（そのまま残しています） ---
  
  // 1. 細かいエラーは無視する
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // 2. エラーの原因になるパッケージを強制的に変換対象にする
  transpilePackages: ['undici', 'firebase', '@firebase/auth'],

  // 3. スマホ（クライアント）側では、undici を「空っぽ」に置き換えて無効化する
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'undici': false,
      }
    }
    return config
  },
}

module.exports = nextConfig
