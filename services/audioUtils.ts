/**
 * Decode base64 string to Uint8Array
 */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode audio data (MP3, WAV, etc.) using Web Audio API
 * This properly handles compressed formats like MP3 from OpenAI TTS
 * 
 * Note: sampleRate and numChannels parameters are kept for backwards compatibility
 * but are ignored - the Web Audio API determines these from the audio file itself
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext | OfflineAudioContext,
  _sampleRate: number = 24000,
  _numChannels: number = 1,
): Promise<AudioBuffer> {
  // Use Web Audio API's native decodeAudioData which handles MP3, WAV, AAC, etc.
  // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues and detachment
  const arrayBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(arrayBuffer).set(data);
  
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(
      arrayBuffer,
      (audioBuffer) => resolve(audioBuffer),
      (error) => reject(new Error(`Failed to decode audio: ${error}`))
    );
  });
}