/**
 * Audio Utilities for ChimpNews
 * 
 * Provides audio decoding, normalization, and enhancement functions
 * using Web Audio API for professional-quality audio output.
 */

// =============================================================================================
// CONSTANTS
// =============================================================================================

// Target loudness for broadcast audio (EBU R128 / ITU-R BS.1770)
const TARGET_LOUDNESS_LUFS = -16; // Standard for streaming/podcast
const TRUE_PEAK_LIMIT = -1.5; // dBTP
const LOUDNESS_RANGE = 11; // LRA

// =============================================================================================
// BASIC DECODING
// =============================================================================================

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
 * Encode Uint8Array to base64 string
 */
export function encode(bytes: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
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

// =============================================================================================
// AUDIO ANALYSIS
// =============================================================================================

/**
 * Calculate RMS (Root Mean Square) loudness of audio buffer
 */
export function calculateRMS(audioBuffer: AudioBuffer): number {
  let sumOfSquares = 0;
  let totalSamples = 0;
  
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < channelData.length; i++) {
      sumOfSquares += channelData[i] * channelData[i];
      totalSamples++;
    }
  }
  
  return Math.sqrt(sumOfSquares / totalSamples);
}

/**
 * Calculate peak amplitude of audio buffer
 */
export function calculatePeak(audioBuffer: AudioBuffer): number {
  let peak = 0;
  
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < channelData.length; i++) {
      const absSample = Math.abs(channelData[i]);
      if (absSample > peak) {
        peak = absSample;
      }
    }
  }
  
  return peak;
}

/**
 * Convert linear amplitude to decibels
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Convert decibels to linear amplitude
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Approximate LUFS calculation (simplified, not full ITU-R BS.1770)
 * For accurate LUFS, use a dedicated library like 'loudness' on backend
 */
export function approximateLUFS(audioBuffer: AudioBuffer): number {
  const rms = calculateRMS(audioBuffer);
  const dbRMS = linearToDb(rms);
  // Approximate LUFS from RMS (rough estimate, not accurate for all content)
  return dbRMS - 0.691; // Rough offset
}

// =============================================================================================
// AUDIO NORMALIZATION
// =============================================================================================

export interface NormalizationOptions {
  targetLUFS?: number;      // Target loudness in LUFS (default: -16)
  truePeakLimit?: number;   // True peak limit in dB (default: -1.5)
  applyCompression?: boolean; // Apply dynamic compression (default: false)
  compressionRatio?: number;  // Compression ratio if enabled (default: 3)
  compressionThreshold?: number; // Threshold in dB (default: -20)
}

/**
 * Normalize audio buffer to target loudness
 * Uses peak normalization with loudness targeting
 */
export async function normalizeAudio(
  audioBuffer: AudioBuffer,
  options: NormalizationOptions = {}
): Promise<AudioBuffer> {
  const {
    targetLUFS = TARGET_LOUDNESS_LUFS,
    truePeakLimit = TRUE_PEAK_LIMIT,
    applyCompression = false,
    compressionRatio = 3,
    compressionThreshold = -20
  } = options;
  
  // Calculate current loudness
  const currentLUFS = approximateLUFS(audioBuffer);
  const currentPeak = calculatePeak(audioBuffer);
  const currentPeakDb = linearToDb(currentPeak);
  
  console.log(`🔊 [Audio] Current: ${currentLUFS.toFixed(1)} LUFS, Peak: ${currentPeakDb.toFixed(1)} dB`);
  
  // Calculate required gain
  let gainDb = targetLUFS - currentLUFS;
  
  // Limit gain to prevent clipping (respect true peak limit)
  const maxGainDb = truePeakLimit - currentPeakDb;
  if (gainDb > maxGainDb) {
    console.log(`🔊 [Audio] Limiting gain from ${gainDb.toFixed(1)} to ${maxGainDb.toFixed(1)} dB (peak limiting)`);
    gainDb = maxGainDb;
  }
  
  const gainLinear = dbToLinear(gainDb);
  
  // Create new audio buffer for normalized audio
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  // Copy and normalize
  const normalizedBuffer = ctx.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const inputData = audioBuffer.getChannelData(channel);
    const outputData = normalizedBuffer.getChannelData(channel);
    
    for (let i = 0; i < inputData.length; i++) {
      let sample = inputData[i] * gainLinear;
      
      // Apply soft compression if enabled
      if (applyCompression) {
        const thresholdLinear = dbToLinear(compressionThreshold);
        const absSample = Math.abs(sample);
        
        if (absSample > thresholdLinear) {
          // Soft knee compression
          const overThreshold = absSample - thresholdLinear;
          const compressed = thresholdLinear + (overThreshold / compressionRatio);
          sample = (sample >= 0 ? 1 : -1) * compressed;
        }
      }
      
      // Hard limiter to prevent clipping
      const peakLimitLinear = dbToLinear(truePeakLimit);
      if (Math.abs(sample) > peakLimitLinear) {
        sample = (sample >= 0 ? 1 : -1) * peakLimitLinear;
      }
      
      outputData[i] = sample;
    }
  }
  
  const finalLUFS = approximateLUFS(normalizedBuffer);
  const finalPeak = linearToDb(calculatePeak(normalizedBuffer));
  console.log(`✅ [Audio] Normalized: ${finalLUFS.toFixed(1)} LUFS, Peak: ${finalPeak.toFixed(1)} dB`);
  
  return normalizedBuffer;
}

// =============================================================================================
// AUDIO ENHANCEMENT
// =============================================================================================

/**
 * Apply simple noise gate to reduce background noise
 */
export function applyNoiseGate(
  audioBuffer: AudioBuffer,
  thresholdDb: number = -50,
  attackMs: number = 5,
  releaseMs: number = 50
): AudioBuffer {
  const threshold = dbToLinear(thresholdDb);
  const attackSamples = Math.floor((attackMs / 1000) * audioBuffer.sampleRate);
  const releaseSamples = Math.floor((releaseMs / 1000) * audioBuffer.sampleRate);
  
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  const outputBuffer = ctx.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const inputData = audioBuffer.getChannelData(channel);
    const outputData = outputBuffer.getChannelData(channel);
    
    let gateOpen = false;
    let gateLevel = 0;
    
    for (let i = 0; i < inputData.length; i++) {
      const sample = inputData[i];
      const absSample = Math.abs(sample);
      
      // Determine gate state
      if (absSample > threshold) {
        gateOpen = true;
      } else if (gateOpen && absSample < threshold * 0.5) {
        gateOpen = false;
      }
      
      // Smooth gate transition
      const targetLevel = gateOpen ? 1 : 0;
      const smoothingFactor = gateOpen ? (1 / attackSamples) : (1 / releaseSamples);
      gateLevel += (targetLevel - gateLevel) * smoothingFactor;
      
      outputData[i] = sample * gateLevel;
    }
  }
  
  return outputBuffer;
}

/**
 * Apply high-pass filter to remove low-frequency rumble
 */
export async function applyHighPassFilter(
  audioBuffer: AudioBuffer,
  cutoffHz: number = 80
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  // Create source
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  
  // Create high-pass filter
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = cutoffHz;
  filter.Q.value = 0.707; // Butterworth
  
  // Connect
  source.connect(filter);
  filter.connect(ctx.destination);
  
  // Render
  source.start(0);
  return ctx.startRendering();
}

/**
 * NEW: Apply parametric EQ for professional audio mixing
 * Enhances voice clarity and presence
 */
export async function applyParametricEQ(
  audioBuffer: AudioBuffer,
  options: {
    lowShelf?: { frequency: number; gain: number }; // Bass boost/cut
    midBoost?: { frequency: number; gain: number; Q: number }; // Presence boost
    highShelf?: { frequency: number; gain: number }; // Treble boost/cut
  } = {}
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  
  let currentNode: AudioNode = source;
  
  // Low shelf (bass)
  if (options.lowShelf) {
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = options.lowShelf.frequency;
    lowShelf.gain.value = options.lowShelf.gain;
    currentNode.connect(lowShelf);
    currentNode = lowShelf;
  }
  
  // Mid boost (presence - for voice clarity)
  if (options.midBoost) {
    const midBoost = ctx.createBiquadFilter();
    midBoost.type = 'peaking';
    midBoost.frequency.value = options.midBoost.frequency;
    midBoost.gain.value = options.midBoost.gain;
    midBoost.Q.value = options.midBoost.Q;
    currentNode.connect(midBoost);
    currentNode = midBoost;
  }
  
  // High shelf (treble)
  if (options.highShelf) {
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = options.highShelf.frequency;
    highShelf.gain.value = options.highShelf.gain;
    currentNode.connect(highShelf);
    currentNode = highShelf;
  }
  
  currentNode.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

/**
 * NEW: Apply subtle reverb for ambient feel
 * Adds depth without being obvious
 */
export async function applyReverb(
  audioBuffer: AudioBuffer,
  options: {
    roomSize?: number; // 0-1, default 0.3 (subtle)
    damping?: number; // 0-1, default 0.5
    wetLevel?: number; // 0-1, default 0.15 (subtle)
  } = {}
): Promise<AudioBuffer> {
  const {
    roomSize = 0.3,
    damping = 0.5,
    wetLevel = 0.15 // Subtle reverb
  } = options;
  
  const ctx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  
  // Create convolver for reverb (simplified - uses impulse response)
  // For production, use a proper impulse response file
  // For now, use a simple delay-based reverb simulation
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.03; // 30ms delay
  
  const gain = ctx.createGain();
  gain.gain.value = wetLevel;
  
  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - wetLevel;
  
  // Mix dry and wet signals
  source.connect(dryGain);
  source.connect(delay);
  delay.connect(gain);
  
  const merger = ctx.createChannelMerger(audioBuffer.numberOfChannels);
  dryGain.connect(merger, 0, 0);
  if (audioBuffer.numberOfChannels > 1) {
    dryGain.connect(merger, 0, 1);
  }
  gain.connect(merger, 0, 0);
  if (audioBuffer.numberOfChannels > 1) {
    gain.connect(merger, 0, 1);
  }
  
  merger.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

/**
 * NEW: Professional audio mixing function
 * Applies all enhancements: EQ, compression, normalization, reverb
 */
export async function applyProfessionalAudioMixing(
  audioBuffer: AudioBuffer,
  options: {
    normalize?: boolean;
    targetLUFS?: number;
    applyEQ?: boolean;
    applyCompression?: boolean;
    applyReverb?: boolean;
    voiceType?: 'male' | 'female';
  } = {}
): Promise<AudioBuffer> {
  const {
    normalize = true,
    targetLUFS = TARGET_LOUDNESS_LUFS,
    applyEQ = true,
    applyCompression = true,
    applyReverb = false, // Disabled by default
    voiceType = 'male'
  } = options;
  
  let processed = audioBuffer;
  
  // 1. High-pass filter (remove rumble)
  processed = await applyHighPassFilter(processed, 80);
  
  // 2. Parametric EQ (voice enhancement)
  if (applyEQ) {
    // Voice-specific EQ curves
    if (voiceType === 'male') {
      processed = await applyParametricEQ(processed, {
        lowShelf: { frequency: 100, gain: 2 }, // Slight bass boost
        midBoost: { frequency: 2000, gain: 3, Q: 1.5 }, // Presence boost
        highShelf: { frequency: 8000, gain: 1 } // Slight treble
      });
    } else {
      processed = await applyParametricEQ(processed, {
        lowShelf: { frequency: 150, gain: 1 },
        midBoost: { frequency: 3000, gain: 4, Q: 1.5 }, // More presence for female voices
        highShelf: { frequency: 10000, gain: 2 } // More treble
      });
    }
  }
  
  // 3. Compression (if enabled)
  if (applyCompression) {
    // Compression is applied during normalization
    // This is handled in normalizeAudio function
  }
  
  // 4. Normalization
  if (normalize) {
    processed = await normalizeAudio(processed, {
      targetLUFS,
      applyCompression,
      compressionRatio: 3,
      compressionThreshold: -20
    });
  }
  
  // 5. Reverb (subtle, if enabled)
  if (applyReverb) {
    processed = await applyReverb(processed, {
      roomSize: 0.3,
      damping: 0.5,
      wetLevel: 0.1 // Very subtle
    });
  }
  
  return processed;
}

// =============================================================================================
// AUDIO EXPORT
// =============================================================================================

/**
 * Export AudioBuffer to WAV format as base64
 */
export function audioBufferToWavBase64(audioBuffer: AudioBuffer): string {
  const wavData = audioBufferToWav(audioBuffer);
  return encode(wavData);
}

/**
 * Convert AudioBuffer to WAV Uint8Array
 */
export function audioBufferToWav(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const dataLength = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  
  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // Interleave channels and write samples
  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = audioBuffer.getChannelData(channel)[i];
      const intSample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, intSample < 0 ? intSample * 0x8000 : intSample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// =============================================================================================
// BATCH PROCESSING
// =============================================================================================

export interface ProcessedAudioResult {
  audioBase64: string;
  duration: number;
  peakDb: number;
  rmsDb: number;
  normalized: boolean;
}

/**
 * Process audio segment with normalization and enhancement
 * NEW: Enhanced with professional mixing options
 */
export async function processAudioSegment(
  audioBase64: string,
  options: {
    normalize?: boolean;
    targetLUFS?: number;
    applyHighPass?: boolean;
    highPassCutoff?: number;
    applyNoiseGate?: boolean;
    noiseGateThreshold?: number;
    applyEQ?: boolean; // NEW: Enable parametric EQ
    applyCompression?: boolean; // NEW: Enable compression
    applyReverb?: boolean; // NEW: Enable subtle reverb
    voiceType?: 'male' | 'female'; // NEW: For voice-specific EQ
  } = {}
): Promise<ProcessedAudioResult> {
  const {
    normalize = true,
    targetLUFS = TARGET_LOUDNESS_LUFS,
    applyHighPass = true,
    highPassCutoff = 80,
    applyNoiseGate: useNoiseGate = false,
    noiseGateThreshold = -50,
    applyEQ = true, // NEW: Enable by default
    applyCompression = true, // NEW: Enable by default
    applyReverb = false, // NEW: Disabled by default
    voiceType = 'male' // NEW: Default to male
  } = options;
  
  // Decode audio
  const audioData = decode(audioBase64.split(',')[1] || audioBase64);
  const ctx = new AudioContext();
  let audioBuffer = await decodeAudioData(audioData, ctx);
  
  // NEW: Apply professional mixing (includes high-pass, EQ, compression, normalization, reverb)
  if (applyEQ || applyCompression || applyReverb) {
    audioBuffer = await applyProfessionalAudioMixing(audioBuffer, {
      normalize,
      targetLUFS,
      applyEQ,
      applyCompression,
      applyReverb,
      voiceType
    });
  } else {
    // Legacy path: individual processing
    // Apply high-pass filter
    if (applyHighPass) {
      audioBuffer = await applyHighPassFilter(audioBuffer, highPassCutoff);
    }
    
    // Apply noise gate
    if (useNoiseGate) {
      audioBuffer = applyNoiseGate(audioBuffer, noiseGateThreshold);
    }
    
    // Normalize
    if (normalize) {
      audioBuffer = await normalizeAudio(audioBuffer, { targetLUFS });
    }
  }
  
  // Export
  const wavBase64 = audioBufferToWavBase64(audioBuffer);
  const peakDb = linearToDb(calculatePeak(audioBuffer));
  const rmsDb = linearToDb(calculateRMS(audioBuffer));
  
  await ctx.close();
  
  return {
    audioBase64: `data:audio/wav;base64,${wavBase64}`,
    duration: audioBuffer.duration,
    peakDb,
    rmsDb,
    normalized: normalize
  };
}