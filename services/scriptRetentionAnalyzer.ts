/**
 * Script Retention Analyzer
 * 
 * Analyzes scripts for retention potential and provides suggestions for improvement.
 * Target: 80%+ retention rate (currently 14-19%)
 */

import { ScriptWithScenes, Scene } from '../types';
import { logger } from './logger';

export interface RetentionAnalysis {
  estimatedDuration: number; // seconds
  hookStrength: number; // 0-100
  retentionScore: number; // 0-100 (target: 80+)
  issues: string[];
  suggestions: string[];
  wordCount: number;
  sceneCount: number;
  avgWordsPerScene: number;
}

/**
 * Analyze script for retention potential
 */
export const analyzeScriptRetention = async (
  scriptWithScenes: ScriptWithScenes
): Promise<RetentionAnalysis> => {
  const analysis: RetentionAnalysis = {
    estimatedDuration: 0,
    hookStrength: 0,
    retentionScore: 0,
    issues: [],
    suggestions: [],
    wordCount: 0,
    sceneCount: 0,
    avgWordsPerScene: 0
  };
  
  // Calculate word count and duration
  const scenes = Object.values(scriptWithScenes.scenes);
  analysis.sceneCount = scenes.length;
  
  scenes.forEach(scene => {
    const words = scene.text.split(/\s+/).filter(w => w.length > 0).length;
    analysis.wordCount += words;
    // Estimate: ~150 words per minute = 2.5 words per second
    const estimatedSeconds = words / 2.5;
    analysis.estimatedDuration += estimatedSeconds;
  });
  
  analysis.avgWordsPerScene = analysis.sceneCount > 0 
    ? Math.round(analysis.wordCount / analysis.sceneCount) 
    : 0;
  
  // Analyze hook (first scene)
  const firstScene = scenes[0];
  if (firstScene) {
    const hookText = firstScene.text.toLowerCase();
    const hookWords = firstScene.text.split(/\s+/).filter(w => w.length > 0).length;
    
    // Check for viral elements in hook
    const hasNumber = /\d+/.test(hookText);
    const hasShockWord = /shocking|insane|crazy|unbelievable|secret|hidden|breaking|urgent|critical/.test(hookText);
    const hasQuestion = hookText.includes('?');
    const hasPowerWord = /\$(billion|million|trillion)|%|drop|crash|surge|spike/.test(hookText);
    const isShort = hookWords <= 20;
    const startsWithHook = !hookText.match(/^(today|let's|we're|this is about)/);
    
    analysis.hookStrength = 
      (hasNumber ? 20 : 0) + 
      (hasShockWord ? 20 : 0) + 
      (hasQuestion ? 15 : 0) + 
      (hasPowerWord ? 15 : 0) + 
      (isShort ? 15 : 0) + 
      (startsWithHook ? 15 : 0);
    
    if (analysis.hookStrength < 50) {
      analysis.issues.push('Hook is weak - needs more viral elements');
      analysis.suggestions.push('Add a number, shocking word, question, or power word to hook');
      analysis.suggestions.push('Start with a shocking statement, not "Today we\'re talking about..."');
    }
    
    if (hookWords > 25) {
      analysis.issues.push(`Hook too long: ${hookWords} words (max 20)`);
      analysis.suggestions.push('Cut hook to 15-20 words for maximum impact');
    }
  } else {
    analysis.issues.push('Missing hook scene');
    analysis.suggestions.push('Ensure first scene is a strong hook');
  }
  
  // Check duration
  if (analysis.estimatedDuration > 60) {
    analysis.issues.push(
      `Script too long: ${analysis.estimatedDuration.toFixed(1)}s (target: 45-60s)`
    );
    analysis.suggestions.push('Cut scenes or reduce dialogue length');
    analysis.suggestions.push('Remove filler words and unnecessary explanations');
  } else if (analysis.estimatedDuration < 40) {
    analysis.issues.push(
      `Script too short: ${analysis.estimatedDuration.toFixed(1)}s (target: 45-60s)`
    );
    analysis.suggestions.push('Add more content or expand scenes');
  }
  
  // Check scene length consistency
  const sceneLengths = scenes.map(s => s.text.split(/\s+/).filter(w => w.length > 0).length);
  const maxSceneLength = Math.max(...sceneLengths);
  const minSceneLength = Math.min(...sceneLengths);
  
  if (maxSceneLength > 60) {
    analysis.issues.push(`Some scenes are too long (max: ${maxSceneLength} words)`);
    analysis.suggestions.push('Keep each scene to 40-60 words max');
  }
  
  // Check for curiosity gaps
  let curiosityGaps = 0;
  scenes.forEach((scene, index) => {
    const text = scene.text.toLowerCase();
    if (text.includes('but wait') || text.includes('here\'s the twist') || 
        text.includes('that\'s not all') || text.includes('wait until') ||
        text.includes('but that\'s not') || text.includes('here\'s what') ||
        text.includes('the real reason') || text.includes('here\'s why')) {
      curiosityGaps++;
    }
  });
  
  if (curiosityGaps < 2) {
    analysis.issues.push('Not enough curiosity gaps between scenes');
    analysis.suggestions.push('Add "but wait", "here\'s the twist", or similar phrases to create curiosity');
  }
  
  // Check for numbers/statistics
  let hasNumbers = false;
  scenes.forEach(scene => {
    if (/\$[\d.]+(billion|million|trillion)|[\d.]+%/.test(scene.text)) {
      hasNumbers = true;
    }
  });
  
  if (!hasNumbers) {
    analysis.issues.push('Script lacks numbers/statistics');
    analysis.suggestions.push('Add specific numbers, percentages, or dollar amounts for credibility');
  }
  
  // Calculate retention score
  analysis.retentionScore = calculateRetentionScore(analysis, scenes);
  
  logger.info('retention', 'Script retention analysis complete', {
    retentionScore: analysis.retentionScore,
    duration: analysis.estimatedDuration,
    hookStrength: analysis.hookStrength,
    issuesCount: analysis.issues.length
  });
  
  return analysis;
};

/**
 * Calculate retention score based on multiple factors
 */
const calculateRetentionScore = (
  analysis: RetentionAnalysis,
  scenes: any[]
): number => {
  let score = 0;
  
  // Hook strength (30% weight)
  score += (analysis.hookStrength / 100) * 30;
  
  // Duration optimization (25% weight)
  if (analysis.estimatedDuration >= 45 && analysis.estimatedDuration <= 60) {
    score += 25; // Perfect duration
  } else if (analysis.estimatedDuration >= 40 && analysis.estimatedDuration < 45) {
    score += 20; // Slightly short
  } else if (analysis.estimatedDuration > 60 && analysis.estimatedDuration <= 70) {
    score += 15; // Slightly long
  } else if (analysis.estimatedDuration > 70) {
    score += 5; // Too long
  } else {
    score += 10; // Too short
  }
  
  // Scene length consistency (15% weight)
  const avgWords = analysis.avgWordsPerScene;
  if (avgWords >= 40 && avgWords <= 60) {
    score += 15; // Perfect
  } else if (avgWords >= 30 && avgWords < 40) {
    score += 10; // Slightly short
  } else if (avgWords > 60 && avgWords <= 80) {
    score += 10; // Slightly long
  } else {
    score += 5; // Too far from ideal
  }
  
  // Curiosity gaps (15% weight)
  let curiosityGaps = 0;
  scenes.forEach(scene => {
    const text = scene.text.toLowerCase();
    if (text.includes('but wait') || text.includes('here\'s the twist') || 
        text.includes('that\'s not all') || text.includes('wait until')) {
      curiosityGaps++;
    }
  });
  const curiosityScore = Math.min(15, (curiosityGaps / scenes.length) * 15);
  score += curiosityScore;
  
  // Numbers/statistics (10% weight)
  let hasNumbers = false;
  scenes.forEach(scene => {
    if (/\$[\d.]+(billion|million|trillion)|[\d.]+%/.test(scene.text)) {
      hasNumbers = true;
    }
  });
  score += hasNumbers ? 10 : 0;
  
  // Pacing (5% weight) - check for short sentences
  let shortSentences = 0;
  let totalSentences = 0;
  scenes.forEach((scene: Scene) => {
    const sentences = scene.text.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);
    totalSentences += sentences.length;
    sentences.forEach((sentence: string) => {
      const words = sentence.trim().split(/\s+/).length;
      if (words <= 10) shortSentences++;
    });
  });
  const pacingScore = totalSentences > 0 
    ? (shortSentences / totalSentences) * 5 
    : 0;
  score += pacingScore;
  
  return Math.round(Math.min(100, Math.max(0, score)));
};

/**
 * Validate script meets viral requirements
 */
export const validateScriptForVirality = (script: ScriptWithScenes): {
  valid: boolean;
  issues: string[];
  warnings: string[];
  estimatedDuration: number;
} => {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  // Calculate duration
  const totalWords = Object.values(script.scenes).reduce(
    (sum, scene) => sum + scene.text.split(/\s+/).filter(w => w.length > 0).length, 0
  );
  const estimatedSeconds = totalWords / 2.5;
  
  if (estimatedSeconds > 60) {
    issues.push(`TOO LONG: ${estimatedSeconds.toFixed(1)}s (max 60s)`);
  } else if (estimatedSeconds < 40) {
    warnings.push(`Short: ${estimatedSeconds.toFixed(1)}s (target: 45-60s)`);
  }
  
  // Check hook
  const hook = script.scenes['1'];
  if (hook) {
    const hookWords = hook.text.split(/\s+/).filter(w => w.length > 0).length;
    if (hookWords > 20) {
      issues.push(`Hook too long: ${hookWords} words (max 20)`);
    }
    
    const hookText = hook.text.toLowerCase();
    if (!/\d+/.test(hookText) && !/[?!]/.test(hookText) && 
        !/shocking|insane|crazy|unbelievable|breaking/.test(hookText)) {
      warnings.push('Hook missing numbers, questions, or shocking words - may reduce CTR');
    }
  }
  
  // Check scene lengths
  Object.entries(script.scenes).forEach(([num, scene]) => {
    const words = scene.text.split(/\s+/).filter(w => w.length > 0).length;
    if (words > 60) {
      warnings.push(`Scene ${num} is long: ${words} words (target: 40-60)`);
    }
  });
  
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    estimatedDuration: estimatedSeconds
  };
};
