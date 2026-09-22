class AudioInputProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input[0]) {
      // Transfer Float32Array slice to main thread
      const channelData = input[0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this.port.postMessage({
        audioData: copy,
        capturedAt: currentTime
      }, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('audio-input-processor', AudioInputProcessor);
