import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '文化祭予約システム',
  description: 'Created for School Festival',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
