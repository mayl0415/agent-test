import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent 平台',
  description: 'Skill 驱动的通用 Agent 执行引擎',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  )
}
