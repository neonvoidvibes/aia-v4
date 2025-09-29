// Mobile recording capability detection and codec fallbacks
// Implements the MIME type ladder: WebM/Opus -> MP4/AAC -> PCM fallback

export interface AudioCapabilities {
  supportedMimeType: string | null;
  isSupported: boolean;
  isMobile: boolean;
  requiresPCMFallback: boolean;
  recommendedTimeslice: number;
  contentType: string;
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  supportsPCMStream: boolean;
  supportsAudioWorklet: boolean;
  pcmFrameDurationMs: number;
  pcmFrameSamples: number;
}

export interface AudioHeader {
  contentType: string;
  rate: number;
  channels: number;
  bitDepth?: number;
}

export interface PCMFrameEnvelope {
  seq: number;
  timestamp: number;
  sampleRate: number;
  frameDurationMs: number;
  frameSamples: number;
  channels: number;
  format: 'pcm16';
  payload: ArrayBuffer;
}

export const PCM_FRAME_MAGIC = 0x314d4350; // 'PCM1' in little-endian
export const PCM_FRAME_HEADER_BYTES = 32;

export function encodePCMFrame(frame: PCMFrameEnvelope): ArrayBuffer {
  const buffer = new ArrayBuffer(PCM_FRAME_HEADER_BYTES + frame.payload.byteLength);
  const view = new DataView(buffer);

  view.setUint32(0, PCM_FRAME_MAGIC, true);
  view.setUint32(4, frame.seq, true);
  view.setFloat64(8, frame.timestamp, true);
  view.setUint16(16, frame.frameSamples, true);
  view.setUint16(18, Math.max(0, Math.round(frame.frameDurationMs)), true);
  view.setUint32(20, frame.sampleRate, true);
  view.setUint16(24, frame.channels, true);
  view.setUint16(26, 1, true); // 1 == PCM16 little-endian
  view.setUint32(28, frame.payload.byteLength, true);

  const payloadView = new Uint8Array(buffer, PCM_FRAME_HEADER_BYTES);
  payloadView.set(new Uint8Array(frame.payload));

  return buffer;
}

// MIME type ladder in order of preference
const MIME_TYPE_LADDER = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2', // AAC-LC
  'audio/mpeg', // Fallback for some mobile browsers
];

// Mobile user agent patterns
const MOBILE_PATTERNS = [
  /Android/i,
  /iPhone|iPad|iPod/i,
  /Opera Mini/i,
  /IEMobile/i,
  /Mobile|Tablet/i
];

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_PATTERNS.some(pattern => pattern.test(navigator.userAgent));
}

export function detectAudioCapabilities(): AudioCapabilities {
  const isMobile = isMobileDevice();
  const AudioContextClass = typeof window !== 'undefined'
    ? (window.AudioContext || (window as any).webkitAudioContext)
    : null;
  const audioContextSupported = !!AudioContextClass;
  const audioWorkletSupported = !!(audioContextSupported && AudioContextClass && AudioContextClass.prototype && 'audioWorklet' in AudioContextClass.prototype);
  const pcmFrameDurationMs = 20;
  const pcmFrameSamples = Math.round(16000 * (pcmFrameDurationMs / 1000));

  // Default fallback values
  let result: AudioCapabilities = {
    supportedMimeType: null,
    isSupported: false,
    isMobile,
    requiresPCMFallback: false,
    recommendedTimeslice: isMobile ? 1000 : 3000, // Shorter timeslice for mobile
    contentType: 'audio/pcm',
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    supportsPCMStream: audioContextSupported,
    supportsAudioWorklet: audioWorkletSupported,
    pcmFrameDurationMs,
    pcmFrameSamples
  };

  // Check if MediaRecorder is available
  if (typeof MediaRecorder === 'undefined') {
    return result;
  }

  // Try each MIME type in the ladder
  for (const mimeType of MIME_TYPE_LADDER) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      result.supportedMimeType = mimeType;
      result.isSupported = true;
      result.contentType = mimeType;

      // Adjust settings based on detected format
      if (mimeType.includes('webm') && mimeType.includes('opus')) {
        result.sampleRate = 48000; // Opus prefers 48kHz
        result.channels = 1;
      } else if (mimeType.includes('mp4')) {
        result.sampleRate = 44100; // AAC standard rate
        result.channels = 1;
      }

      return result;
    }
  }

  // If no native codec support, check for Web Audio API (PCM fallback)
  if (audioContextSupported) {
    result.isSupported = true;
    result.requiresPCMFallback = true;
    result.contentType = 'audio/pcm';
    result.sampleRate = 16000; // Standard for STT
    result.channels = 1;
    result.bitDepth = 16;
    result.recommendedTimeslice = isMobile ? 1500 : 3000; // Slightly longer for PCM processing
    result.supportsPCMStream = true;
    result.supportsAudioWorklet = audioWorkletSupported;
  }

  return result;
}

// Create audio header for WebSocket protocol
export function createAudioHeader(capabilities: AudioCapabilities): AudioHeader {
  return {
    contentType: capabilities.contentType,
    rate: capabilities.sampleRate,
    channels: capabilities.channels,
    ...(capabilities.bitDepth && { bitDepth: capabilities.bitDepth })
  };
}

export interface PCMAudioProcessorOptions {
  targetSampleRate?: number;
  frameDurationMs?: number;
}

// PCM processor that prefers AudioWorklet and falls back to ScriptProcessor
export class PCMAudioProcessor {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private mode: 'worklet' | 'script' | null = null;
  private frameCallback: ((frame: Float32Array) => void) | null = null;
  private targetSampleRate = 16000;
  private frameDurationMs = 20;
  private frameSampleCount = 320;
  private active = false;

  private scriptMonoBuffer: number[] = [];
  private scriptOutputBuffer: number[] = [];
  private scriptResamplePosition = 0;

  async initialize(stream: MediaStream, onFrame: (frame: Float32Array) => void, options: PCMAudioProcessorOptions = {}): Promise<void> {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API not supported');
    }

    this.targetSampleRate = options.targetSampleRate ?? 16000;
    this.frameDurationMs = options.frameDurationMs ?? 20;
    this.frameSampleCount = Math.max(1, Math.round(this.targetSampleRate * (this.frameDurationMs / 1000)));
    this.frameCallback = onFrame;

    this.audioContext = new AudioContextClass();
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    if (this.audioContext.audioWorklet) {
      try {
        await this.audioContext.audioWorklet.addModule('/worklets/pcm-worklet.js');
        const processorOptions = {
          targetSampleRate: this.targetSampleRate,
          frameDurationMs: this.frameDurationMs,
        };
        this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-frame-processor', { processorOptions });
        this.workletNode.port.onmessage = this.handleWorkletMessage;
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
        this.mode = 'worklet';
      } catch (error) {
        console.warn('[PCMAudioProcessor] AudioWorklet unavailable, falling back to ScriptProcessor', error);
        this.mode = null;
      }
    }

    if (!this.mode) {
      this.mode = 'script';
      const channelCount = Math.max(1, this.sourceNode.channelCount || stream.getAudioTracks()[0]?.getSettings()?.channelCount || 1);
      this.scriptProcessor = this.audioContext.createScriptProcessor(2048, channelCount, 1);
      this.scriptProcessor.onaudioprocess = (event) => {
        this.handleScriptAudio(event.inputBuffer);
      };
      this.sourceNode.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
    }

    try {
      await this.audioContext.resume();
    } catch (error) {
      console.warn('[PCMAudioProcessor] Failed to resume AudioContext', error);
    }

    this.active = true;
  }

  private handleWorkletMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'frame') {
      const samples = data.samples instanceof Float32Array
        ? data.samples
        : new Float32Array(data.samples?.buffer ?? data.samples);
      if (samples.length) {
        this.frameCallback?.(samples);
      }
    }
  };

  private handleScriptAudio(buffer: AudioBuffer) {
    if (!this.audioContext) return;
    const inputRate = this.audioContext.sampleRate || buffer.sampleRate || 48000;
    const channelCount = buffer.numberOfChannels || 1;

    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex++) {
      let mixed = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        mixed += buffer.getChannelData(channel)[sampleIndex] || 0;
      }
      this.scriptMonoBuffer.push(mixed / channelCount);
    }

    const ratio = inputRate / this.targetSampleRate;
    let position = this.scriptResamplePosition;

    while (position + 1 < this.scriptMonoBuffer.length) {
      const baseIndex = Math.floor(position);
      const frac = position - baseIndex;
      const sample0 = this.scriptMonoBuffer[baseIndex];
      const sample1 = this.scriptMonoBuffer[baseIndex + 1] ?? sample0;
      const interpolated = sample0 + (sample1 - sample0) * frac;
      this.scriptOutputBuffer.push(interpolated);
      position += ratio;

      if (this.scriptOutputBuffer.length >= this.frameSampleCount) {
        const frameSamples = this.scriptOutputBuffer.splice(0, this.frameSampleCount);
        this.frameCallback?.(Float32Array.from(frameSamples));
      }
    }

    const consumed = Math.floor(position);
    if (consumed > 0) {
      this.scriptMonoBuffer.splice(0, consumed);
      position -= consumed;
    }
    this.scriptResamplePosition = position;
  }

  stop(): void {
    this.active = false;
    if (this.workletNode) {
      try { this.workletNode.port.onmessage = null; } catch {}
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }
    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch {}
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this.mode = null;
    this.scriptMonoBuffer = [];
    this.scriptOutputBuffer = [];
    this.scriptResamplePosition = 0;
  }

  isActive(): boolean {
    return this.active;
  }

  getMode(): 'worklet' | 'script' | null {
    return this.mode;
  }

  getFrameSampleCount(): number {
    return this.frameSampleCount;
  }

  getFrameDurationMs(): number {
    return this.frameDurationMs;
  }

  getTargetSampleRate(): number {
    return this.targetSampleRate;
  }
}

// Convert Float32Array to 16-bit PCM ArrayBuffer
export function float32ToPCM16(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    // Convert float (-1 to 1) to 16-bit signed integer
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    const pcmSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(i * 2, pcmSample, true); // little endian
  }

  return buffer;
}
