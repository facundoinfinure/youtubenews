
import React, { useEffect, useRef, useState } from 'react';
import { decode, decodeAudioData } from '../services/audioUtils';
import { NewsItem, BroadcastSegment, VideoAssets, ChannelConfig } from '../types';
import { Ticker } from './Ticker';

interface BroadcastPlayerProps {
  segments: BroadcastSegment[];
  videos: VideoAssets;
  news: NewsItem[];
  displayDate?: Date;
  onUploadToYouTube?: (blob: Blob) => void;
  config: ChannelConfig;
}

type PlaybackPhase = 'IDLE' | 'INTRO' | 'CONTENT' | 'OUTRO';

export const BroadcastPlayer: React.FC<BroadcastPlayerProps> = ({ 
  segments, 
  videos, 
  news, 
  displayDate = new Date(),
  onUploadToYouTube,
  config
}) => {
  const [phase, setPhase] = useState<PlaybackPhase>('IDLE');
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Replacing isDownloading
  const [processLabel, setProcessLabel] = useState("");
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioBuffersRef = useRef<AudioBuffer[]>([]);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Music Ref
  const jingleBufferRef = useRef<AudioBuffer | null>(null);
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Video Refs (Arrays)
  const videoWideRef = useRef<HTMLVideoElement>(null);
  const videoHostARefs = useRef<(HTMLVideoElement | null)[]>([]);
  const videoHostBRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // Constants
  const INTRO_DURATION = 4000; 
  const OUTRO_DURATION = 4000; 

  const isShorts = config.format === '9:16';

  // Procedural Jungle Jingle Generator
  const createJungleJingle = (ctx: AudioContext | OfflineAudioContext): AudioBuffer => {
      const duration = 4.0;
      const sampleRate = ctx.sampleRate;
      const buffer = ctx.createBuffer(2, sampleRate * duration, sampleRate);
      
      const channelL = buffer.getChannelData(0);
      const channelR = buffer.getChannelData(1);

      let seed = 1234;
      const random = () => {
          seed = (seed * 16807) % 2147483647;
          return (seed - 1) / 2147483646;
      };

      for (let i = 0; i < buffer.length; i++) {
          const t = i / sampleRate;
          // 1. Tribal Drum Beat
          const beatInterval = 0.5;
          const beatTime = t % beatInterval;
          let drum = 0;
          if (beatTime < 0.1) {
              const freq = 60 - (beatTime * 400); 
              drum = Math.sin(2 * Math.PI * freq * beatTime) * (1 - beatTime/0.1);
          }
          // 2. High Hat
          let shaker = 0;
          if (t % 0.25 < 0.05) {
             shaker = (random() * 2 - 1) * 0.2;
          }
          // 3. Marimba Melody
          const melodyNotes = [440, 523.25, 659.25, 523.25, 440, 392, 440, 523.25]; 
          const noteIndex = Math.floor(t * 4) % melodyNotes.length;
          const noteFreq = melodyNotes[noteIndex];
          const noteTime = t % 0.25;
          const melody = Math.sin(2 * Math.PI * noteFreq * noteTime) * Math.exp(-noteTime * 10) * 0.3;
          const sample = (drum * 0.8) + (shaker * 0.1) + melody;
          
          channelL[i] = sample * 0.8;
          channelR[i] = sample * 0.8;
      }
      return buffer;
  };

  useEffect(() => {
    if (segments.length === 0) return;

    const initAudio = async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextClass({ sampleRate: 24000 });
        audioContextRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; 
        analyserRef.current = analyser;
        analyser.connect(ctx.destination);

        const buffers: AudioBuffer[] = [];
        for (const seg of segments) {
            const pcmData = decode(seg.audioBase64);
            const buffer = await decodeAudioData(pcmData, ctx, 24000, 1);
            buffers.push(buffer);
        }
        audioBuffersRef.current = buffers;
        jingleBufferRef.current = createJungleJingle(ctx);
        setIsReady(true);
      } catch (e) {
        console.error("Audio initialization failed", e);
      }
    };

    initAudio();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [segments]);

  // Determine active video based on current speaker AND index (rotation)
  const getActiveVideoRef = (index: number) => {
      if (phase === 'INTRO' || phase === 'OUTRO') return videoWideRef.current;
      if (!segments[index]) return videoWideRef.current;
      
      const speaker = segments[index].speaker;
      
      if (speaker === config.characters.hostA.name && videos.hostA.length > 0) {
          const videoIndex = index % videos.hostA.length;
          return videoHostARefs.current[videoIndex];
      }
      if (speaker === config.characters.hostB.name && videos.hostB.length > 0) {
          const videoIndex = index % videos.hostB.length;
          return videoHostBRefs.current[videoIndex];
      }
      return videoWideRef.current; 
  };

  // Live Lip Sync Loop
  useEffect(() => {
    let animationId: number;
    
    const checkLipSync = () => {
        if (phase === 'CONTENT' && analyserRef.current) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            const isTalking = avg > 10; 

            const activeVideo = getActiveVideoRef(currentSegmentIndex);

            if (activeVideo) {
                if (isTalking && activeVideo.paused) {
                    activeVideo.play().catch(() => {});
                } else if (!isTalking && !activeVideo.paused) {
                    activeVideo.pause();
                }
            }
        } else if (phase === 'INTRO' || phase === 'OUTRO') {
            const vid = videoWideRef.current;
            if (vid && vid.paused) vid.play().catch(() => {});
        }

        animationId = requestAnimationFrame(checkLipSync);
    };

    if (phase !== 'IDLE') {
        checkLipSync();
    }

    return () => cancelAnimationFrame(animationId);
  }, [phase, currentSegmentIndex]);


  const playMusic = () => {
    const ctx = audioContextRef.current;
    if (!ctx || !jingleBufferRef.current) return;
    
    if (musicSourceRef.current) {
        try { musicSourceRef.current.stop(); } catch(e){}
    }

    const source = ctx.createBufferSource();
    source.buffer = jingleBufferRef.current;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 4.0); 

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    musicSourceRef.current = source;
  };


  const playSegment = (index: number) => {
      if (index >= segments.length) {
          setPhase('OUTRO');
          playMusic(); 
          setTimeout(() => {
              setPhase('IDLE');
              setCurrentSegmentIndex(0);
          }, OUTRO_DURATION);
          return;
      }

      const ctx = audioContextRef.current;
      const analyser = analyserRef.current;
      if (!ctx || !analyser) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffersRef.current[index];
      source.connect(analyser);
      
      source.onended = () => {
          playSegment(index + 1);
      };

      activeSourceRef.current = source;
      source.start(0);
      setCurrentSegmentIndex(index);
  };

  const togglePlay = () => {
      if (!isReady || !audioContextRef.current) return;

      if (phase !== 'IDLE') {
          if (activeSourceRef.current) {
              activeSourceRef.current.stop();
              activeSourceRef.current.onended = null;
          }
          if (musicSourceRef.current) {
              try { musicSourceRef.current.stop(); } catch(e){}
          }
          setPhase('IDLE');
          // Reset all videos
          if (videoWideRef.current) { videoWideRef.current.pause(); videoWideRef.current.currentTime = 0; }
          videoHostARefs.current.forEach(v => { if(v) { v.pause(); v.currentTime = 0; } });
          videoHostBRefs.current.forEach(v => { if(v) { v.pause(); v.currentTime = 0; } });
      } else {
          setPhase('INTRO');
          playMusic(); 

          if (videoWideRef.current) videoWideRef.current.play().catch(()=>{});
          
          setTimeout(() => {
              setPhase('CONTENT');
              playSegment(0);
          }, INTRO_DURATION);
      }
  };

  // CORE RENDER LOGIC (Returns a Blob)
  const renderBroadcastVideo = async (): Promise<Blob> => {
    const isShorts = config.format === '9:16';
    const canvasWidth = isShorts ? 720 : 1280;
    const canvasHeight = isShorts ? 1280 : 720;

    // Helper to load video
    const loadVideoBlob = async (url: string | null) => {
        if (!url) return null;
        const res = await fetch(url);
        const blob = await res.blob();
        const vid = document.createElement('video');
        vid.src = URL.createObjectURL(blob);
        vid.muted = true;
        vid.loop = true;
        vid.crossOrigin = "anonymous";
        return vid;
    };

    const vWide = await loadVideoBlob(videos.wide);
    const vHostAs = await Promise.all(videos.hostA.map(loadVideoBlob));
    const vHostBs = await Promise.all(videos.hostB.map(loadVideoBlob));

    // Warm up videos
    if(vWide) await vWide.play().then(() => vWide.pause());
    for(const v of vHostAs) if(v) await v.play().then(() => v.pause());
    for(const v of vHostBs) if(v) await v.play().then(() => v.pause());

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("No canvas");

    const offlineCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    const dest = offlineCtx.createMediaStreamDestination();
    
    const downloadAnalyser = offlineCtx.createAnalyser();
    downloadAnalyser.fftSize = 256;
    downloadAnalyser.connect(dest);

    const offlineJingle = createJungleJingle(offlineCtx);

    // 1. Schedule Intro
    const introNode = offlineCtx.createBufferSource();
    introNode.buffer = offlineJingle;
    const introGain = offlineCtx.createGain();
    introGain.gain.setValueAtTime(0.5, 0);
    introGain.gain.linearRampToValueAtTime(0.01, INTRO_DURATION/1000);
    introNode.connect(introGain);
    introGain.connect(dest);
    introNode.start(0);

    // 2. Schedule Speech
    let currentTime = INTRO_DURATION / 1000;
    const segmentTimings: { start: number, end: number, speaker: string, index: number, text: string }[] = [];

    for (let i = 0; i < segments.length; i++) {
        const pcm = decode(segments[i].audioBase64);
        const buf = await decodeAudioData(pcm, offlineCtx, 24000, 1);
        
        const source = offlineCtx.createBufferSource();
        source.buffer = buf;
        source.connect(downloadAnalyser); 
        source.start(currentTime);
        
        segmentTimings.push({
            start: currentTime,
            end: currentTime + buf.duration,
            speaker: segments[i].speaker,
            index: i,
            text: segments[i].text
        });
        currentTime += buf.duration;
    }

    // 3. Schedule Outro
    const outroNode = offlineCtx.createBufferSource();
    outroNode.buffer = offlineJingle;
    const outroGain = offlineCtx.createGain();
    outroGain.gain.setValueAtTime(0.5, currentTime);
    outroGain.gain.linearRampToValueAtTime(0.01, currentTime + (OUTRO_DURATION/1000));
    outroNode.connect(outroGain);
    outroGain.connect(dest);
    outroNode.start(currentTime);

    const totalDurationSec = currentTime + (OUTRO_DURATION / 1000);
    const canvasStream = canvas.captureStream(30);
    const mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mediaRecorder = new MediaRecorder(mixedStream, { mimeType: 'video/webm;codecs=vp9' });
    
    const chunks: BlobPart[] = [];
    
    return new Promise((resolve, reject) => {
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = () => {
             const blob = new Blob(chunks, { type: 'video/webm' });
             resolve(blob);
        };
        mediaRecorder.onerror = (e) => reject(e);

        mediaRecorder.start();
        const startTime = Date.now();
        const dataArray = new Uint8Array(downloadAnalyser.frequencyBinCount);

        const drawLogo = (alpha: number, scale: number) => {
             ctx.save();
             ctx.globalAlpha = alpha;
             ctx.translate(canvas.width/2, canvas.height/2);
             ctx.scale(scale, scale);
             ctx.translate(-canvas.width/2, -canvas.height/2);
             
             ctx.fillStyle = "black";
             ctx.fillRect(0,0, canvas.width, canvas.height);
             
             ctx.beginPath();
             ctx.arc(canvas.width/2, canvas.height/2, 100, 0, Math.PI*2);
             ctx.fillStyle = config.logoColor1; 
             ctx.fill();
             
             ctx.fillStyle = "black";
             ctx.font = "bold 80px 'Anton', sans-serif";
             ctx.textAlign = "center";
             ctx.textBaseline = "middle";
             const nameParts = config.channelName.match(/.{1,5}/g) || [config.channelName];
             ctx.fillText(nameParts[0].toUpperCase(), canvas.width/2, canvas.height/2 - 20);
             ctx.fillStyle = config.logoColor2; 
             ctx.fillText((nameParts[1] || "").toUpperCase(), canvas.width/2, canvas.height/2 + 50);
             ctx.restore();
        };

        const draw = () => {
            const now = Date.now();
            const elapsedSec = (now - startTime) / 1000;
            const introSec = INTRO_DURATION / 1000;
            const outroStartSec = currentTime; // end of speech

            if (elapsedSec >= totalDurationSec) {
                mediaRecorder.stop();
                return;
            }

            if (elapsedSec < introSec) {
                // Intro
                if (vWide && vWide.paused) vWide.play();
                const progress = elapsedSec / introSec;
                const scale = 2 - progress; 
                drawLogo(1, scale);
            } 
            else if (elapsedSec >= outroStartSec) {
                // Outro
                const progress = (elapsedSec - outroStartSec) / (OUTRO_DURATION/1000);
                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                drawLogo(progress, 1);
            }
            else {
                // Content
                const currentSeg = segmentTimings.find(s => elapsedSec >= s.start && elapsedSec < s.end);
                let activeVid = vWide;
                
                if (currentSeg) {
                    if (currentSeg.speaker === config.characters.hostA.name && vHostAs.length > 0) {
                        activeVid = vHostAs[currentSeg.index % vHostAs.length];
                    } else if (currentSeg.speaker === config.characters.hostB.name && vHostBs.length > 0) {
                        activeVid = vHostBs[currentSeg.index % vHostBs.length];
                    }
                }
                
                downloadAnalyser.getByteFrequencyData(dataArray);
                const avgVol = dataArray.reduce((a,b)=>a+b) / dataArray.length;
                const isTalking = avgVol > 10;
                
                if (activeVid) {
                    // Center crop for object-cover behavior
                    const hRatio = canvas.width / activeVid.videoWidth;
                    const vRatio = canvas.height / activeVid.videoHeight;
                    const ratio = Math.max(hRatio, vRatio);
                    const centerShift_x = (canvas.width - activeVid.videoWidth * ratio) / 2;
                    const centerShift_y = (canvas.height - activeVid.videoHeight * ratio) / 2;

                    if (isTalking && activeVid.paused) activeVid.play();
                    else if (!isTalking && !activeVid.paused) activeVid.pause();
                    
                    ctx.drawImage(activeVid, 
                        0, 0, activeVid.videoWidth, activeVid.videoHeight,
                        centerShift_x, centerShift_y, activeVid.videoWidth * ratio, activeVid.videoHeight * ratio
                    );
                } else {
                    ctx.fillStyle = "#111";
                    ctx.fillRect(0,0,canvas.width,canvas.height);
                }

                // Captions
                if (config.captionsEnabled && currentSeg) {
                    ctx.fillStyle = "rgba(0,0,0,0.7)";
                    ctx.fillRect(20, canvas.height - 180, canvas.width - 40, 80);
                    ctx.fillStyle = "white";
                    ctx.font = "bold 24px Arial";
                    ctx.textAlign = "center";
                    ctx.fillText(currentSeg.text, canvas.width/2, canvas.height - 135, canvas.width - 60);
                }

                // Scanlines
                ctx.fillStyle = "rgba(0,0,0,0.1)";
                for(let y=0; y<canvas.height; y+=4) ctx.fillRect(0, y, canvas.width, 2);

                // Badge
                ctx.fillStyle = "white";
                ctx.font = "bold 36px 'Anton', sans-serif";
                ctx.textAlign = "left";
                
                const badgeY = isShorts ? 100 : 55;
                ctx.fillText(config.channelName.substring(0,5).toUpperCase(), 90, badgeY);
                ctx.fillStyle = config.logoColor1;
                ctx.fillText(config.channelName.substring(5).toUpperCase(), 200, badgeY);

                // Date
                const dateY = isShorts ? 110 : 65;
                ctx.fillStyle = "rgba(0,0,0,0.6)";
                ctx.fillRect(30, dateY, 250, 24);
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.lineWidth = 1;
                ctx.strokeRect(30, dateY, 250, 24);
                ctx.fillStyle = "white";
                ctx.font = "14px monospace";
                const dateStr = displayDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                ctx.fillText(dateStr.toUpperCase(), 35, dateY + 16);

                // Ticker
                const tickerHeight = 60;
                const yPos = canvas.height - tickerHeight;
                ctx.fillStyle = config.logoColor1; 
                ctx.fillRect(0, yPos, canvas.width, tickerHeight);
                ctx.fillStyle = "black";
                ctx.fillRect(0, yPos, canvas.width, 4);

                ctx.fillStyle = config.logoColor2;
                ctx.fillRect(0, yPos, 220, tickerHeight);
                ctx.fillStyle = "white";
                ctx.font = "bold 24px 'Anton', sans-serif";
                ctx.fillText("BREAKING", 20, yPos + 38);

                const tickerString = news.map(n => `• ${n.headline} via ${n.source}`).join('     ');
                const scrollSpeed = 150;
                const scrollT = elapsedSec - introSec;
                ctx.font = "bold 24px monospace"; 
                const totalWidth = ctx.measureText(tickerString).width;
                let x = 240 - (scrollT * scrollSpeed);
                const loopWidth = totalWidth + 200; 
                const offsetX = x % loopWidth;

                ctx.save();
                ctx.beginPath();
                ctx.rect(220, yPos, canvas.width - 220, tickerHeight);
                ctx.clip();
                ctx.fillStyle = "black";
                ctx.fillText(tickerString, 240 + offsetX, yPos + 38);
                ctx.fillText(tickerString, 240 + offsetX + loopWidth, yPos + 38);
                if (offsetX < 0) {
                     ctx.fillText(tickerString, 240 + offsetX - loopWidth, yPos + 38);
                }
                ctx.restore();
            }
            requestAnimationFrame(draw);
        };
        draw();
    });
  };

  const handleAction = async (action: 'download' | 'upload') => {
    if (isProcessing || segments.length === 0) return;
    setIsProcessing(true);
    setProcessLabel(action === 'download' ? "RENDERING..." : "PREPARING UPLOAD...");

    try {
        const blob = await renderBroadcastVideo();
        
        if (action === 'download') {
             const url = URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = `${config.channelName}_${displayDate.toISOString().split('T')[0]}.webm`;
             a.click();
        } else if (action === 'upload' && onUploadToYouTube) {
             onUploadToYouTube(blob);
        }
    } catch (e) {
        console.error("Render failed", e);
        alert("Render failed");
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <div className={`relative bg-black rounded-none overflow-hidden shadow-2xl group mx-auto ${isShorts ? 'w-[400px] h-[711px]' : 'w-full aspect-video'}`}>
      
      {/* 1. VIDEO LAYER */}
      <div className={`absolute inset-0 bg-black transition-opacity duration-1000 ${phase === 'CONTENT' ? 'opacity-100' : 'opacity-0'}`}>
          {videos.wide && (
            <video 
                ref={videoWideRef} src={videos.wide} muted loop playsInline crossOrigin="anonymous"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                    getActiveVideoRef(currentSegmentIndex) === videoWideRef.current ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
            />
          )}
          {videos.hostA.map((src, idx) => (
             <video 
                key={`hostA-${idx}`}
                ref={el => videoHostARefs.current[idx] = el}
                src={src} muted loop playsInline crossOrigin="anonymous"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                    getActiveVideoRef(currentSegmentIndex) === videoHostARefs.current[idx] ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
            />
          ))}
          {videos.hostB.map((src, idx) => (
             <video 
                key={`hostB-${idx}`}
                ref={el => videoHostBRefs.current[idx] = el}
                src={src} muted loop playsInline crossOrigin="anonymous"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                    getActiveVideoRef(currentSegmentIndex) === videoHostBRefs.current[idx] ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
            />
          ))}
      </div>

      {/* 2. INTRO / OUTRO OVERLAY LAYER */}
      <div className={`absolute inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-1000 pointer-events-none 
          ${phase === 'INTRO' || phase === 'OUTRO' ? 'opacity-100' : 'opacity-0'}`}>
          <div className={`flex flex-col items-center justify-center transform transition-transform duration-[3000ms] ${phase === 'INTRO' ? 'scale-100' : 'scale-90'}`}>
               <div className="w-48 h-48 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(250,204,21,0.5)] mb-4 animate-bounce" style={{backgroundColor: config.logoColor1}}>
                  <span className="text-8xl">🎥</span>
               </div>
               <div className="text-center">
                   <h1 className="text-6xl font-headline text-white drop-shadow-lg">{config.channelName.substring(0,5).toUpperCase()}<span style={{color: config.logoColor1}}>{config.channelName.substring(5).toUpperCase()}</span></h1>
                   <div className="text-xl text-gray-400 font-mono mt-2 tracking-widest uppercase">{config.tagline}</div>
               </div>
          </div>
      </div>

      {/* 3. PLACEHOLDER (No Video) */}
      {!videos.wide && videos.hostA.length === 0 && videos.hostB.length === 0 && phase === 'IDLE' && (
         <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-gray-500">
             <div className="text-xl font-mono animate-pulse">NO SATELLITE FEED</div>
         </div>
      )}

      {/* 4. CONTROLS */}
      {phase === 'IDLE' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-30">
             <button 
                onClick={togglePlay}
                disabled={!isReady}
                className={`w-24 h-24 rounded-full flex items-center justify-center border-4 border-white transition-transform hover:scale-110 ${
                  isReady ? 'text-white shadow-[0_0_30px_rgba(220,38,38,0.6)]' : 'bg-gray-700'
                }`}
                style={{ backgroundColor: isReady ? config.logoColor2 : undefined }}
             >
                {isReady ? <svg className="w-10 h-10 ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> : "..."}
             </button>
        </div>
      )}

      {isReady && phase === 'IDLE' && (
          <div className="absolute top-4 right-6 z-40 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <button onClick={() => handleAction('download')} disabled={isProcessing} className="bg-black/70 hover:bg-black text-white px-4 py-2 rounded flex gap-2 border border-white/20">
                  {isProcessing && processLabel === "RENDERING..." ? "RENDERING..." : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      DOWNLOAD
                    </>
                  )}
              </button>
              {onUploadToYouTube && (
                <button onClick={() => handleAction('upload')} disabled={isProcessing} className="text-white px-4 py-2 rounded flex gap-2 font-bold shadow-lg" style={{backgroundColor: config.logoColor2}}>
                    {isProcessing && processLabel.includes("UPLOAD") ? "PROCESSING..." : (
                      <>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                        PUBLISH
                      </>
                    )}
                </button>
              )}
          </div>
      )}

      {/* 5. BROADCAST OVERLAYS (Visible only during CONTENT) */}
      <div className={`transition-opacity duration-500 ${phase === 'CONTENT' ? 'opacity-100' : 'opacity-0'}`}>
          <div className="absolute top-4 left-6 flex flex-col items-start space-y-1 z-20 pointer-events-none">
            <div className="flex items-center space-x-2">
               <div className="text-white px-2 py-0.5 font-bold text-xs uppercase rounded animate-pulse shadow-md" style={{backgroundColor: config.logoColor2}}>● LIVE</div>
               <div className="text-white font-headline text-lg drop-shadow-md">
                 {config.channelName.substring(0,5).toUpperCase()}
                 <span style={{color: config.logoColor1}}>{config.channelName.substring(5).toUpperCase()}</span>
               </div>
            </div>
            <div className="bg-black/60 backdrop-blur-sm text-white px-2 py-0.5 font-mono text-xs uppercase rounded">
               {displayDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>

          {/* Captions Overlay */}
          {config.captionsEnabled && segments[currentSegmentIndex] && (
            <div className="absolute bottom-20 left-0 right-0 z-30 flex justify-center px-4">
                <div className="bg-black/70 text-white font-bold text-center px-4 py-2 rounded-lg text-lg">
                    {segments[currentSegmentIndex].text}
                </div>
            </div>
          )}

          <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
            <Ticker news={news} />
          </div>
      </div>
      
      <div className="scanlines pointer-events-none"></div>
    </div>
  );
};
