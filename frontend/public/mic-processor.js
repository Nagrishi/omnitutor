// MicProcessor: runs in the AudioWorklet context at sampleRate = 24000 Hz.
// Gemini Live API expects PCM audio at 16000 Hz, so we downsample 3:2
// using a simple linear interpolation before posting to the main thread.

class MicProcessor extends AudioWorkletProcessor {

  constructor() {
    super();
    this._buffer = [];
    this._ratio = 16000 / 24000; // target / source = 0.6667
  }

  process(inputs) {
    const input = inputs[0];

    if (input.length > 0) {
      const channelData = input[0]; // Float32Array at 24000 Hz

      // Downsample to 16000 Hz via linear interpolation
      const inputLen = channelData.length;
      const outputLen = Math.round(inputLen * this._ratio);
      const downsampled = new Float32Array(outputLen);

      for (let i = 0; i < outputLen; i++) {
        // Map output index back to a (possibly fractional) input index
        const srcIdx = i / this._ratio;
        const srcFloor = Math.floor(srcIdx);
        const srcCeil = Math.min(srcFloor + 1, inputLen - 1);
        const frac = srcIdx - srcFloor;
        downsampled[i] = channelData[srcFloor] * (1 - frac) + channelData[srcCeil] * frac;
      }

      // Post the 16000 Hz Float32 data back to the main thread
      this.port.postMessage(downsampled);
    }

    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);