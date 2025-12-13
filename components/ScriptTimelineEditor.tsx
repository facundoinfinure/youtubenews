/**
 * Script Timeline Editor
 * 
 * NEW: Editor Visual de Guiones
 * - Timeline visual tipo editor de video
 * - Drag-and-drop para reordenar escenas
 * - Split/merge de escenas
 * - Undo/redo completo
 */

import React, { useState, useRef, useCallback } from 'react';
import { Scene, ScriptWithScenes } from '../types';

interface ScriptTimelineEditorProps {
  scriptWithScenes: ScriptWithScenes;
  onUpdate: (updatedScript: ScriptWithScenes) => void;
  onCancel: () => void;
  hostAName: string;
  hostBName: string;
}

interface TimelineScene {
  id: string;
  scene: Scene;
  startTime: number;
  duration: number;
}

export const ScriptTimelineEditor: React.FC<ScriptTimelineEditorProps> = ({
  scriptWithScenes,
  onUpdate,
  onCancel,
  hostAName,
  hostBName
}) => {
  const [scenes, setScenes] = useState<TimelineScene[]>(() => {
    // Convert scenes to timeline format
    let currentTime = 0;
    return Object.entries(scriptWithScenes.scenes)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([num, scene]) => {
        const wordCount = scene.text.split(/\s+/).length;
        const duration = Math.max(3, wordCount / 2.5); // Estimate duration
        const timelineScene: TimelineScene = {
          id: num,
          scene,
          startTime: currentTime,
          duration
        };
        currentTime += duration;
        return timelineScene;
      });
  });

  const [history, setHistory] = useState<ScriptWithScenes[]>([scriptWithScenes]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [draggedScene, setDraggedScene] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate total duration
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

  // Undo/Redo
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const saveToHistory = useCallback((newScript: ScriptWithScenes) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newScript);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const handleUndo = () => {
    if (canUndo) {
      const previousScript = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      // Rebuild scenes from script
      let currentTime = 0;
      const newScenes = Object.entries(previousScript.scenes)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([num, scene]) => {
          const wordCount = scene.text.split(/\s+/).length;
          const duration = Math.max(3, wordCount / 2.5);
          const timelineScene: TimelineScene = {
            id: num,
            scene,
            startTime: currentTime,
            duration
          };
          currentTime += duration;
          return timelineScene;
        });
      setScenes(newScenes);
      onUpdate(previousScript);
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      const nextScript = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      // Rebuild scenes from script
      let currentTime = 0;
      const newScenes = Object.entries(nextScript.scenes)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([num, scene]) => {
          const wordCount = scene.text.split(/\s+/).length;
          const duration = Math.max(3, wordCount / 2.5);
          const timelineScene: TimelineScene = {
            id: num,
            scene,
            startTime: currentTime,
            duration
          };
          currentTime += duration;
          return timelineScene;
        });
      setScenes(newScenes);
      onUpdate(nextScript);
    }
  };

  // Reorder scenes (drag and drop)
  const handleReorder = (fromIndex: number, toIndex: number) => {
    const newScenes = [...scenes];
    const [moved] = newScenes.splice(fromIndex, 1);
    newScenes.splice(toIndex, 0, moved);
    
    // Recalculate start times
    let currentTime = 0;
    newScenes.forEach(s => {
      s.startTime = currentTime;
      currentTime += s.duration;
    });
    
    setScenes(newScenes);
    
    // Update script
    const updatedScript: ScriptWithScenes = {
      ...scriptWithScenes,
      scenes: newScenes.reduce((acc, s, idx) => {
        acc[String(idx + 1)] = s.scene;
        return acc;
      }, {} as Record<string, Scene>)
    };
    
    saveToHistory(updatedScript);
    onUpdate(updatedScript);
  };

  // Split scene
  const handleSplit = (sceneId: string, splitPoint: number) => {
    const sceneIndex = scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex === -1) return;
    
    const scene = scenes[sceneIndex];
    const text = scene.scene.text;
    const words = text.split(/\s+/);
    const splitWordIndex = Math.floor((splitPoint / scene.duration) * words.length);
    
    const firstPart = words.slice(0, splitWordIndex).join(' ');
    const secondPart = words.slice(splitWordIndex).join(' ');
    
    if (!firstPart || !secondPart) return;
    
    const firstDuration = (firstPart.split(/\s+/).length / 2.5);
    const secondDuration = (secondPart.split(/\s+/).length / 2.5);
    
    const newScenes = [...scenes];
    newScenes.splice(sceneIndex, 1, 
      {
        ...scene,
        scene: { ...scene.scene, text: firstPart },
        duration: firstDuration
      },
      {
        id: String(scenes.length + 1),
        scene: { ...scene.scene, text: secondPart },
        startTime: scene.startTime + firstDuration,
        duration: secondDuration
      }
    );
    
    // Recalculate start times
    let currentTime = 0;
    newScenes.forEach(s => {
      s.startTime = currentTime;
      currentTime += s.duration;
    });
    
    setScenes(newScenes);
    
    // Update script
    const updatedScript: ScriptWithScenes = {
      ...scriptWithScenes,
      scenes: newScenes.reduce((acc, s, idx) => {
        acc[String(idx + 1)] = s.scene;
        return acc;
      }, {} as Record<string, Scene>)
    };
    
    saveToHistory(updatedScript);
    onUpdate(updatedScript);
  };

  // Merge scenes
  const handleMerge = (sceneId1: string, sceneId2: string) => {
    const index1 = scenes.findIndex(s => s.id === sceneId1);
    const index2 = scenes.findIndex(s => s.id === sceneId2);
    
    if (index1 === -1 || index2 === -1 || Math.abs(index1 - index2) !== 1) return;
    
    const scene1 = scenes[index1];
    const scene2 = scenes[index2];
    const mergedText = `${scene1.scene.text} ${scene2.scene.text}`;
    const mergedDuration = scene1.duration + scene2.duration;
    
    const newScenes = [...scenes];
    newScenes.splice(index1, 2, {
      ...scene1,
      scene: { ...scene1.scene, text: mergedText },
      duration: mergedDuration
    });
    
    // Recalculate start times
    let currentTime = 0;
    newScenes.forEach(s => {
      s.startTime = currentTime;
      currentTime += s.duration;
    });
    
    setScenes(newScenes);
    
    // Update script
    const updatedScript: ScriptWithScenes = {
      ...scriptWithScenes,
      scenes: newScenes.reduce((acc, s, idx) => {
        acc[String(idx + 1)] = s.scene;
        return acc;
      }, {} as Record<string, Scene>)
    };
    
    saveToHistory(updatedScript);
    onUpdate(updatedScript);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] rounded-xl border border-[#333] w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-[#333] flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">📝 Visual Script Editor</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg"
            >
              ↶ Undo
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg"
            >
              ↷ Redo
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const updatedScript: ScriptWithScenes = {
                  ...scriptWithScenes,
                  scenes: scenes.reduce((acc, s, idx) => {
                    acc[String(idx + 1)] = s.scene;
                    return acc;
                  }, {} as Record<string, Scene>)
                };
                onUpdate(updatedScript);
                onCancel();
              }}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold"
            >
              Save Changes
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-auto p-6">
          <div ref={timelineRef} className="relative" style={{ minHeight: '400px' }}>
            {/* Time ruler */}
            <div className="sticky top-0 bg-[#111] z-10 mb-4 pb-2 border-b border-[#333]">
              <div className="flex">
                {Array.from({ length: Math.ceil(totalDuration) + 1 }, (_, i) => (
                  <div key={i} className="flex-1 text-xs text-gray-400 text-center">
                    {i}s
                  </div>
                ))}
              </div>
            </div>

            {/* Scene tracks */}
            <div className="space-y-2">
              {scenes.map((timelineScene, index) => {
                const speaker = timelineScene.scene.video_mode === 'hostA' ? hostAName : hostBName;
                const widthPercent = (timelineScene.duration / totalDuration) * 100;
                const leftPercent = (timelineScene.startTime / totalDuration) * 100;
                
                return (
                  <div
                    key={timelineScene.id}
                    draggable
                    onDragStart={() => setDraggedScene(timelineScene.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedScene) {
                        const targetIndex = index;
                        const sourceIndex = scenes.findIndex(s => s.id === draggedScene);
                        if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
                          handleReorder(sourceIndex, targetIndex);
                        }
                        setDraggedScene(null);
                      }
                    }}
                    className="relative bg-[#111] border border-[#333] rounded-lg p-4 cursor-move hover:border-cyan-500 transition-all"
                    style={{
                      marginLeft: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      minWidth: '200px'
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-cyan-400">Scene {index + 1}</span>
                        <span className="text-xs text-gray-500">({timelineScene.duration.toFixed(1)}s)</span>
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                          {speaker}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleSplit(timelineScene.id, timelineScene.duration / 2)}
                          className="text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 px-2 py-1 rounded"
                          title="Split scene"
                        >
                          ✂️
                        </button>
                        {index < scenes.length - 1 && (
                          <button
                            onClick={() => handleMerge(timelineScene.id, scenes[index + 1].id)}
                            className="text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 px-2 py-1 rounded"
                            title="Merge with next"
                          >
                            🔗
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-white/80 line-clamp-2">{timelineScene.scene.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-[#333] bg-[#111] text-sm text-gray-400">
          Total Duration: {totalDuration.toFixed(1)}s | {scenes.length} scenes | 
          Drag scenes to reorder | Click ✂️ to split | Click 🔗 to merge
        </div>
      </div>
    </div>
  );
};
