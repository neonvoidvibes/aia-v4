"use client"

import { useState } from "react"
import { Mic, MicOff, Pause } from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type TranscriptRecorderProps = {
  inline?: boolean
}

export default function TranscriptRecorder({ inline = false }: TranscriptRecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false)
      setIsPaused(false)
    } else {
      setIsRecording(true)
      setIsPaused(false)
    }
  }

  const togglePause = () => {
    setIsPaused(!isPaused)
  }

  if (inline) {
    return (
      <span onClick={toggleRecording} className="cursor-pointer relative">
        {isRecording ? (
          <span className="text-foreground/70">
            listen:{" "}
            {isPaused ? (
              <>
                no <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span>
              </>
            ) : (
              <>
                yes <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
              </>
            )}
          </span>
        ) : (
          <span className="text-foreground/70">listen: no</span>
        )}
      </span>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {isRecording && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={togglePause}>
                <Pause className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isPaused ? "Resume" : "Pause"} transcript</p>
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isRecording ? "destructive" : "outline"}
              size="icon"
              onClick={toggleRecording}
              className="relative"
            >
              {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}

              {/* Recording indicator */}
              {isRecording && !isPaused && (
                <AnimatePresence>
                  <motion.span
                    className="absolute top-0 right-0 h-3 w-3 rounded-full bg-red-500"
                    animate={{
                      opacity: [1, 0.5, 1],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut",
                    }}
                  />
                </AnimatePresence>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isRecording ? "Stop" : "Start"} transcript</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
