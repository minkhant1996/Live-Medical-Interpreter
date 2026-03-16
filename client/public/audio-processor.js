/**
 * AudioWorklet processor that captures PCM audio at 16kHz mono.
 * Also detects speech pauses (0.5s silence) for turn detection.
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetRate = 16000;
    // Send chunks every ~100ms worth of 16kHz audio = 1600 samples
    this._chunkSize = 1600;

    // Pause detection settings
    this._silenceThreshold = 0.01; // RMS below this = silence
    this._pauseDurationMs = 500;   // 0.5 second pause = end of speech
    this._minSpeechMs = 200;       // Minimum speech duration to count

    // State tracking
    this._isSpeaking = false;
    this._silenceStartTime = null;
    this._speechStartTime = null;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // Calculate RMS energy for this frame
    let sumSquares = 0;
    for (let i = 0; i < input.length; i++) {
      sumSquares += input[i] * input[i];
    }
    const rms = Math.sqrt(sumSquares / input.length);
    const isSilent = rms < this._silenceThreshold;
    const now = currentTime * 1000; // Convert to ms

    // State machine for pause detection
    if (!isSilent) {
      // Sound detected
      if (!this._isSpeaking) {
        // Speech just started
        this._isSpeaking = true;
        this._speechStartTime = now;
        this._silenceStartTime = null;
        this.port.postMessage({ type: "speech_start" });
      } else {
        // Still speaking - reset silence timer
        this._silenceStartTime = null;
      }
    } else {
      // Silence detected
      if (this._isSpeaking) {
        // Was speaking, now silent
        if (!this._silenceStartTime) {
          this._silenceStartTime = now;
        } else if (now - this._silenceStartTime >= this._pauseDurationMs) {
          // 0.5s pause detected - end of speech
          const speechDuration = now - this._speechStartTime;
          if (speechDuration >= this._minSpeechMs) {
            this.port.postMessage({ type: "speech_end" });
          }
          this._isSpeaking = false;
          this._speechStartTime = null;
          this._silenceStartTime = null;
        }
      }
    }

    // Downsample from native rate to 16kHz using averaging filter
    const ratio = sampleRate / this._targetRate;
    const outputLength = Math.floor(input.length / ratio);

    for (let i = 0; i < outputLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), input.length);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += input[j];
      }
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this._buffer.push(int16);
    }

    // When we have enough samples, send a chunk
    while (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.splice(0, this._chunkSize);
      const int16Array = new Int16Array(chunk);
      this.port.postMessage(
        { type: "pcm", buffer: int16Array.buffer },
        [int16Array.buffer]
      );
    }

    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
