"use client"

import React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface ThinkingIndicatorProps {
  elapsedTime: number
  className?: string
}

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ elapsedTime, className }) => {
  const thinkingText = "Thinking"
  const formattedTime = elapsedTime.toFixed(1)

  const textVariants = {
    hidden: { opacity: 0.4 },
    visible: (i: number) => ({
      opacity: [0.4, 1, 0.4],
      transition: {
        duration: 1.5,
        repeat: Infinity,
        delay: i * 0.1,
        ease: "easeInOut",
      },
    }),
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("flex self-start mb-1 mt-1 ml-3 items-center gap-3", className)}
    >
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        {thinkingText.split("").map((char, i) => (
          <motion.span key={`${char}-${i}`} custom={i} variants={textVariants} initial="hidden" animate="visible">
            {char}
          </motion.span>
        ))}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{formattedTime}s</span>
    </motion.div>
  )
}

export default ThinkingIndicator