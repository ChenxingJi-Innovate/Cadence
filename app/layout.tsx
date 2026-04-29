import "./globals.css"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Cadence — Ask data in plain language",
  description: "Schema-aware NL→SQL analytics for music & artist teams.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
