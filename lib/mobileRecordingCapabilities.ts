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
}

export interface AudioHeader {
  contentType: string;
  rate: number;
  channels: number;
  bitDepth?: number;
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
    bitDepth: 16
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
  if (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined') {
    result.isSupported = true;
    result.requiresPCMFallback = true;
    result.contentType = 'audio/pcm';
    result.sampleRate = 16000; // Standard for STT
    result.channels = 1;
    result.bitDepth = 16;
    result.recommendedTimeslice = isMobile ? 1500 : 3000; // Slightly longer for PCM processing
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

// PCM audio worklet processor (for fallback recording)
export class PCMAudioProcessor {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private onDataCallback: ((data: Float32Array) => void) | null = null;

  async initialize(stream: MediaStream, onData: (data: Float32Array) => void): Promise<void> {
    this.stream = stream;
    this.onDataCallback = onData;

    // Create audio context
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();

    // Create source from stream
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Create processor (deprecated but widely supported)
    // Buffer size: 4096 samples for ~85ms at 48kHz
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);

      // Convert to 16kHz mono if needed
      const downsampledData = this.downsample(inputData, this.audioContext!.sampleRate, 16000);
      this.onDataCallback?.(downsampledData);
    };

    // Connect the chain
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  private downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return buffer;

    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const sourceIndex = Math.round(i * ratio);
      result[i] = buffer[Math.min(sourceIndex, buffer.length - 1)];
    }

    return result;
  }

  stop(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
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