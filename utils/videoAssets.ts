/**
 * Video Assets Utilities
 * 
 * Shared functions for handling VideoAssets objects.
 * Extracted to avoid code duplication across App.tsx and hooks.
 */

import { VideoAssets } from '../types';

/**
 * Empty video assets constant - use as initial state
 */
export const EMPTY_VIDEO_ASSETS: VideoAssets = {
  intro: null,
  outro: null,
  wide: null,
  hostA: [],
  hostB: []
};

/**
 * Normalize video assets to ensure all fields have valid values
 * Handles null, undefined, and missing fields gracefully
 */
export const normalizeVideoAssets = (assets?: VideoAssets | null): VideoAssets => ({
  intro: assets?.intro ?? null,
  outro: assets?.outro ?? null,
  wide: assets?.wide ?? null,
  hostA: assets?.hostA ?? [],
  hostB: assets?.hostB ?? []
});

/**
 * Check if video assets object contains any actual assets
 * Returns true if at least one asset is present
 */
export const hasVideoAssets = (assets: VideoAssets): boolean =>
  Boolean(assets.intro || assets.outro || assets.wide || assets.hostA.length || assets.hostB.length);

/**
 * Merge two video assets objects, preferring non-null values from the second
 */
export const mergeVideoAssets = (base: VideoAssets, override: Partial<VideoAssets>): VideoAssets => ({
  intro: override.intro !== undefined ? override.intro : base.intro,
  outro: override.outro !== undefined ? override.outro : base.outro,
  wide: override.wide !== undefined ? override.wide : base.wide,
  hostA: override.hostA !== undefined ? override.hostA : base.hostA,
  hostB: override.hostB !== undefined ? override.hostB : base.hostB
});

/**
 * Count total number of video assets
 */
export const countVideoAssets = (assets: VideoAssets): number => {
  let count = 0;
  if (assets.intro) count++;
  if (assets.outro) count++;
  if (assets.wide) count++;
  count += assets.hostA.length;
  count += assets.hostB.length;
  return count;
};
