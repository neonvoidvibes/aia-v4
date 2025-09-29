import { encodePCMFrame, PCM_FRAME_HEADER_BYTES, PCM_FRAME_MAGIC } from "../mobileRecordingCapabilities";

describe("encodePCMFrame", () => {
  it("produces a header followed by payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    const frame = {
      seq: 42,
      timestamp: 1234.5,
      sampleRate: 16000,
      frameDurationMs: 20,
      frameSamples: 320,
      channels: 1,
      format: "pcm16" as const,
      payload,
    };

    const encoded = encodePCMFrame(frame);
    expect(encoded.byteLength).toBe(PCM_FRAME_HEADER_BYTES + payload.byteLength);

    const view = new DataView(encoded);
    expect(view.getUint32(0, true)).toBe(PCM_FRAME_MAGIC);
    expect(view.getUint32(4, true)).toBe(42);
    expect(view.getFloat64(8, true)).toBeCloseTo(1234.5, 5);
    expect(view.getUint16(16, true)).toBe(320);
    expect(view.getUint16(18, true)).toBe(20);
    expect(view.getUint32(20, true)).toBe(16000);
    expect(view.getUint16(24, true)).toBe(1);
    expect(view.getUint16(26, true)).toBe(1);
    expect(view.getUint32(28, true)).toBe(payload.byteLength);

    const payloadView = new Uint8Array(encoded, PCM_FRAME_HEADER_BYTES);
    expect(Array.from(payloadView)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
