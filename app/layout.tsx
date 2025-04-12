import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import ClientLayout from "./client"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "River AI",
  description: "Next-gen super-slick chat interface for an AI chat agent",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <ClientLayout>{children}</ClientLayout>
}


import './globals.css'