"use client"

import React, { useEffect, useRef } from 'react'

interface DynamicWaveformProps {
  isActive: boolean
  audioLevel?: number
  className?: string
  color?: string
  lineCount?: number
}

export function DynamicWaveform({ 
  isActive, 
  audioLevel = 0, 
  className = "", 
  color = "currentColor",
  lineCount = 3
}: DynamicWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>()
  const timeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    
    ctx.scale(dpr, dpr)
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'

    const animate = () => {
      if (!isActive) {
        // Ultra slow, barely perceptible movement when inactive
        timeRef.current += 0.005
        
        ctx.clearRect(0, 0, rect.width, rect.height)
        
        const centerY = rect.height / 2
        const baseAmplitude = 0.8 // Very minimal movement
        
        // Single gentle line when inactive
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.15
        ctx.lineWidth = 1
        ctx.lineCap = 'round'
        
        ctx.beginPath()
        for (let x = 0; x <= rect.width; x += 4) {
          const wave = Math.sin(x * 0.006 + timeRef.current) * baseAmplitude
          const y = centerY + wave
          
          if (x === 0) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.stroke()
        
        animationRef.current = requestAnimationFrame(animate)
        return
      }

      // Active animation - much slower and calmer
      timeRef.current += 0.04 + audioLevel * 0.08
      
      ctx.clearRect(0, 0, rect.width, rect.height)
      
      const centerY = rect.height / 2
      const baseAmplitude = 3 + audioLevel * 8 // Much more gentle
      
      // Draw multiple flowing waveform lines
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        const opacity = 0.4 - lineIndex * 0.08
        const frequency = 0.008 + lineIndex * 0.003
        const phase = lineIndex * Math.PI * 0.5
        const amplitude = baseAmplitude * (1 - lineIndex * 0.15)
        
        ctx.strokeStyle = color
        ctx.globalAlpha = opacity + audioLevel * 0.2
        ctx.lineWidth = 1.5 - lineIndex * 0.2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        
        ctx.beginPath()
        
        for (let x = 0; x <= rect.width; x += 1) {
          // Gentler sine waves for calm movement
          const wave1 = Math.sin(x * frequency + timeRef.current + phase) * amplitude
          const wave2 = Math.sin(x * frequency * 1.6 + timeRef.current * 0.7 + phase) * amplitude * 0.3
          
          // Much simpler wave combination for less stress
          const y = centerY + wave1 + wave2
          
          if (x === 0) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
        
        ctx.stroke()
        
        // Subtle glow only for very high audio levels
        if (audioLevel > 0.8) {
          ctx.shadowColor = color
          ctx.shadowBlur = 2 + audioLevel * 3
          ctx.stroke()
          ctx.shadowBlur = 0
        }
      }
      
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isActive, audioLevel, color, lineCount])

  return (
    <div className={`w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}