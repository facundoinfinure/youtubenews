/**
 * Subtitle Generation Service
 * 
 * Generates SRT and VTT subtitle files from broadcast segments.
 * Used for YouTube captions and accessibility.
 */

import { BroadcastSegment } from "../types";

// =============================================================================================
// TYPES
// =============================================================================================

export interface SubtitleCue {
  index: number;
  startTime: number;  // in seconds
  endTime: number;    // in seconds
  text: string;
  speaker?: string;
}

export interface SubtitleTrack {
  language: string;
  languageCode: string;
  cues: SubtitleCue[];
}

// =============================================================================================
// TIME FORMATTING
// =============================================================================================

/**
 * Format time in seconds to SRT format (HH:MM:SS,mmm)
 */
const formatSRTTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
};

/**
 * Format time in seconds to VTT format (HH:MM:SS.mmm)
 */
const formatVTTTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
};

// =============================================================================================
// TEXT PROCESSING
// =============================================================================================

/**
 * Split long text into multiple subtitle cues (max ~40-50 chars per line)
 * YouTube recommends max 2 lines, ~42 characters per line
 */
const splitTextIntoCues = (
  text: string,
  startTime: number,
  duration: number,
  maxCharsPerLine: number = 42,
  maxLinesPerCue: number = 2
): Array<{ text: string; startTime: number; endTime: number }> => {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const maxCharsPerCue = maxCharsPerLine * maxLinesPerCue;
  
  // If text is short enough, return single cue
  if (text.length <= maxCharsPerCue) {
    return [{
      text: text,
      startTime,
      endTime: startTime + duration
    }];
  }
  
  const cues: Array<{ text: string; startTime: number; endTime: number }> = [];
  let currentCueWords: string[] = [];
  let currentCueLength = 0;
  
  // Calculate time per word (approximate)
  const totalWords = words.length;
  const timePerWord = duration / totalWords;
  let wordIndex = 0;
  
  for (const word of words) {
    const wordWithSpace = currentCueWords.length > 0 ? ` ${word}` : word;
    
    if (currentCueLength + wordWithSpace.length > maxCharsPerCue && currentCueWords.length > 0) {
      // Finalize current cue
      const cueText = currentCueWords.join(' ');
      const cueWordCount = currentCueWords.length;
      const cueStartTime = startTime + (wordIndex - cueWordCount) * timePerWord;
      const cueDuration = cueWordCount * timePerWord;
      
      cues.push({
        text: formatCueText(cueText, maxCharsPerLine),
        startTime: cueStartTime,
        endTime: cueStartTime + cueDuration
      });
      
      // Start new cue
      currentCueWords = [word];
      currentCueLength = word.length;
    } else {
      currentCueWords.push(word);
      currentCueLength += wordWithSpace.length;
    }
    wordIndex++;
  }
  
  // Add remaining words as final cue
  if (currentCueWords.length > 0) {
    const cueText = currentCueWords.join(' ');
    const cueWordCount = currentCueWords.length;
    const cueStartTime = startTime + (wordIndex - cueWordCount) * timePerWord;
    
    cues.push({
      text: formatCueText(cueText, maxCharsPerLine),
      startTime: cueStartTime,
      endTime: startTime + duration
    });
  }
  
  return cues;
};

/**
 * Format cue text with line breaks for better readability
 */
const formatCueText = (text: string, maxCharsPerLine: number = 42): string => {
  if (text.length <= maxCharsPerLine) {
    return text;
  }
  
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.slice(0, 2).join('\n'); // Max 2 lines
};

// =============================================================================================
// SUBTITLE GENERATION FROM SEGMENTS
// =============================================================================================

/**
 * Generate subtitle cues from broadcast segments
 * Uses audioDuration if available, otherwise estimates from text
 */
export const generateSubtitleCues = (
  segments: BroadcastSegment[],
  options: {
    includeSpeakerNames?: boolean;
    maxCharsPerLine?: number;
    introOffset?: number; // Offset in seconds for intro video
  } = {}
): SubtitleCue[] => {
  const {
    includeSpeakerNames = false,
    maxCharsPerLine = 42,
    introOffset = 0
  } = options;
  
  const cues: SubtitleCue[] = [];
  let currentTime = introOffset;
  let cueIndex = 1;
  
  for (const segment of segments) {
    if (!segment.text || segment.text.trim().length === 0) {
      continue;
    }
    
    // Get duration from segment or estimate (~2.5 words per second)
    const wordCount = segment.text.split(/\s+/).filter(w => w.length > 0).length;
    const estimatedDuration = Math.max(2, wordCount / 2.5);
    const duration = segment.audioDuration || estimatedDuration;
    
    // Prepare text with optional speaker name
    let displayText = segment.text.trim();
    if (includeSpeakerNames && segment.speaker) {
      displayText = `[${segment.speaker}] ${displayText}`;
    }
    
    // Split into multiple cues if text is too long
    const segmentCues = splitTextIntoCues(displayText, currentTime, duration, maxCharsPerLine);
    
    for (const cue of segmentCues) {
      cues.push({
        index: cueIndex++,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cue.text,
        speaker: segment.speaker
      });
    }
    
    currentTime += duration;
  }
  
  return cues;
};

// =============================================================================================
// SRT FORMAT
// =============================================================================================

/**
 * Generate SRT format subtitle file content
 * 
 * SRT Format:
 * 1
 * 00:00:00,000 --> 00:00:02,500
 * Subtitle text here
 * 
 * 2
 * 00:00:02,600 --> 00:00:05,000
 * Next subtitle
 */
export const generateSRT = (cues: SubtitleCue[]): string => {
  return cues.map(cue => {
    return [
      cue.index.toString(),
      `${formatSRTTime(cue.startTime)} --> ${formatSRTTime(cue.endTime)}`,
      cue.text,
      '' // Empty line between cues
    ].join('\n');
  }).join('\n');
};

/**
 * Generate SRT from broadcast segments
 */
export const generateSRTFromSegments = (
  segments: BroadcastSegment[],
  options: {
    includeSpeakerNames?: boolean;
    introOffset?: number;
  } = {}
): string => {
  const cues = generateSubtitleCues(segments, options);
  return generateSRT(cues);
};

// =============================================================================================
// VTT FORMAT (WebVTT)
// =============================================================================================

/**
 * Generate WebVTT format subtitle file content
 * 
 * VTT Format:
 * WEBVTT
 * 
 * 00:00:00.000 --> 00:00:02.500
 * Subtitle text here
 * 
 * 00:00:02.600 --> 00:00:05.000
 * Next subtitle
 */
export const generateVTT = (cues: SubtitleCue[]): string => {
  const header = 'WEBVTT\n\n';
  
  const body = cues.map(cue => {
    return [
      `${formatVTTTime(cue.startTime)} --> ${formatVTTTime(cue.endTime)}`,
      cue.text,
      '' // Empty line between cues
    ].join('\n');
  }).join('\n');
  
  return header + body;
};

/**
 * Generate VTT from broadcast segments
 */
export const generateVTTFromSegments = (
  segments: BroadcastSegment[],
  options: {
    includeSpeakerNames?: boolean;
    introOffset?: number;
  } = {}
): string => {
  const cues = generateSubtitleCues(segments, options);
  return generateVTT(cues);
};

// =============================================================================================
// BLOB CREATION
// =============================================================================================

/**
 * Create SRT file as Blob
 */
export const createSRTBlob = (
  segments: BroadcastSegment[],
  options?: { includeSpeakerNames?: boolean; introOffset?: number }
): Blob => {
  const srtContent = generateSRTFromSegments(segments, options);
  return new Blob([srtContent], { type: 'text/plain; charset=utf-8' });
};

/**
 * Create VTT file as Blob
 */
export const createVTTBlob = (
  segments: BroadcastSegment[],
  options?: { includeSpeakerNames?: boolean; introOffset?: number }
): Blob => {
  const vttContent = generateVTTFromSegments(segments, options);
  return new Blob([vttContent], { type: 'text/vtt; charset=utf-8' });
};

// =============================================================================================
// EXPORTS
// =============================================================================================

export const SubtitleService = {
  generateCues: generateSubtitleCues,
  generateSRT,
  generateVTT,
  generateSRTFromSegments,
  generateVTTFromSegments,
  createSRTBlob,
  createVTTBlob,
};

