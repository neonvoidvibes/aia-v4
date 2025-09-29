// AudioWorkletProcessor that converts incoming audio to mono 16 kHz frames.
// Frames are emitted as Float32Array payloads via the processor port.

class PCMFrameProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 16000;
    this.frameDurationMs = opts.frameDurationMs || 20;
    this.frameSampleCount = Math.max(1, Math.round(this.targetSampleRate * (this.frameDurationMs / 1000)));
    this.inputSampleRate = sampleRate;
    this.resampleRatio = this.inputSampleRate / this.targetSampleRate;
    this.monoBuffer = [];
    this.outputBuffer = [];
    this.resamplePosition = 0;

    this.port.postMessage({
      type: 'ready',
      inputSampleRate: this.inputSampleRate,
      targetSampleRate: this.targetSampleRate,
      frameDurationMs: this.frameDurationMs,
    });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelCount = input.length;
    if (channelCount === 0) {
      return true;
    }

    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let mixed = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        mixed += input[channel][i] || 0;
      }
      this.monoBuffer.push(mixed / channelCount);
    }

    let position = this.resamplePosition;
    while (position + 1 < this.monoBuffer.length) {
      const baseIndex = Math.floor(position);
      const frac = position - baseIndex;
      const sample0 = this.monoBuffer[baseIndex];
      const sample1 = this.monoBuffer[baseIndex + 1] ?? sample0;
      const interpolated = sample0 + (sample1 - sample0) * frac;

      this.outputBuffer.push(interpolated);
      position += this.resampleRatio;

      if (this.outputBuffer.length >= this.frameSampleCount) {
        const frameSamples = this.outputBuffer.splice(0, this.frameSampleCount);
        const payload = new Float32Array(frameSamples);
        this.port.postMessage(
          {
            type: 'frame',
            samples: payload,
            frameDurationMs: this.frameDurationMs,
            sampleRate: this.targetSampleRate,
          },
          [payload.buffer]
        );
      }
    }

    const consumed = Math.floor(position);
    if (consumed > 0) {
      this.monoBuffer = this.monoBuffer.slice(consumed);
      position -= consumed;
    }
    this.resamplePosition = position;

    return true;
  }
}

registerProcessor('pcm-frame-processor', PCMFrameProcessor);
