"use client"

import { useEffect, useRef, useState } from 'react'

interface UseAudioLevelProps {
  stream?: MediaStream | null
  audioElement?: HTMLAudioElement | null
  isActive: boolean
}

export function useAudioLevel({ stream, audioElement, isActive }: UseAudioLevelProps) {
  const [audioLevel, setAudioLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Uint8Array | null>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    let audioContext: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null

    if (!isActive) {
      setAudioLevel(0)
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current)
      }
      return
    }

    const setupAnalyser = async () => {
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        
        if (stream) {
          source = audioContext.createMediaStreamSource(stream)
        } else if (audioElement) {
          source = audioContext.createMediaElementSource(audioElement)
        } else {
          return
        }

        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        
        source.connect(analyser)
        
        if (audioElement) {
          analyser.connect(audioContext.destination)
        }
        
        analyserRef.current = analyser
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount)
        
        const updateLevel = () => {
          if (!analyserRef.current || !dataArrayRef.current || !isActive) {
            return
          }
          
          analyserRef.current.getByteFrequencyData(dataArrayRef.current)
          
          let sum = 0
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            sum += dataArrayRef.current[i]
          }
          
          const average = sum / dataArrayRef.current.length
          const normalizedLevel = Math.min(average / 128, 1)
          
          setAudioLevel(normalizedLevel)
          animationRef.current = requestAnimationFrame(updateLevel)
        }
        
        updateLevel()
      } catch (error) {
        console.warn('Audio analysis not available:', error)
        setAudioLevel(0.5)
      }
    }

    setupAnalyser()

    return () => {
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current)
      }
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close()
      }
    }
  }, [stream, audioElement, isActive])

  return audioLevel
}
