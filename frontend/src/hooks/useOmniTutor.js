import { useState, useRef, useCallback, useEffect } from 'react';

export function useOmniTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioStreamRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const currentSourceRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const frameIntervalRef = useRef(null);
 
  const mediaRecorderRef = useRef(null);
  const nextPlaybackTimeRef = useRef(0);
  const processorRef = useRef(null);
  const inputAudioContextRef = useRef(null);
  const nextAudioTimeRef = useRef(0);


  const connect = useCallback(() => {
    if (wsRef.current) return;
    
    wsRef.current = new WebSocket('ws://localhost:5000');
    
    wsRef.current.onopen = () => {
      console.log('Connected to backend proxy');
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000
        });
      }
      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume();
      }
      setIsConnected(true);
    };
    
    wsRef.current.onmessage = async (event) => {
      let response;

      try {
        response = JSON.parse(event.data);
      } catch {
        console.warn("Invalid JSON from backend");
        return;
      }

      if (response.serverContent?.modelTurn) {
        const parts = response.serverContent.modelTurn.parts;

        for (const part of parts) {
          if (part.inlineData?.data) {
            playAudioChunk(part.inlineData.data);
          }
        }
      }
    };
    
    wsRef.current.onclose = () => {
      console.log('Disconnected');
      setIsConnected(false);
      wsRef.current = null;
    };
    
    wsRef.current.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }, []); // Fixed: Added missing closing bracket for useCallback
  
   const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    nextPlaybackTimeRef.current = 0;
    stopMediaStreams();
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]); // Added disconnect to dependencies

 

  const stopMediaStreams = () => {

    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
    setIsMicActive(false);
    setIsScreenSharing(false);
  };

  const playAudioChunk = (base64Audio) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      });
    }

    const audioCtx = audioContextRef.current;

    // Decode base64
    const binaryString = window.atob(base64Audio);
    const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));

    // PCM16 → Float32
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);

    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    // Create buffer
    const buffer = audioCtx.createBuffer(
      1,
      float32.length,
      24000
    );

    buffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
   if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
}

    // 🔑 Smooth scheduling
    const now = audioCtx.currentTime;

    if (nextPlaybackTimeRef.current < now) {
      nextPlaybackTimeRef.current = now;
    }
    const scheduleTime = Math.max(
    nextPlaybackTimeRef.current,
    audioCtx.currentTime + 0.05
);
    currentSourceRef.current = source;
    source.start(scheduleTime);
nextPlaybackTimeRef.current = scheduleTime + buffer.duration;
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
      }
      if (inputAudioContextRef.current) {
          inputAudioContextRef.current.close();
          inputAudioContextRef.current = null;
      }
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
      setIsMicActive(false);
      setIsScreenSharing(false);
  };

  const playAudioChunk = async (base64Audio) => {
      if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const audioCtx = audioContextRef.current;
      if (audioCtx.state === 'suspended') {
          audioCtx.resume();
      }
      
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      
      try {
          // Gemini returns raw PCM 16-bit 24kHz
          const pcm16Data = new Int16Array(bytes.buffer);
          const float32Data = new Float32Array(pcm16Data.length);
          for (let i = 0; i < pcm16Data.length; i++) {
              float32Data[i] = pcm16Data[i] / 32768;
          }
          
          const audioBuffer = audioCtx.createBuffer(1, float32Data.length, 24000);
          audioBuffer.getChannelData(0).set(float32Data);
          
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          
          const currentTime = audioCtx.currentTime;
          const startTime = Math.max(currentTime, nextAudioTimeRef.current);
          source.start(startTime);
          nextAudioTimeRef.current = startTime + audioBuffer.duration;
      } catch (e) {
          console.error("Audio playback error:", e);
      }
  };

  const startMic = async () => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioStreamRef.current = stream;
          setIsMicActive(true);
          
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
              console.warn("Connect agent first.");
          }
          
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          inputAudioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          
          processor.onaudioprocess = (e) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                  const inputData = e.inputBuffer.getChannelData(0);
                  const pcmData = new Int16Array(inputData.length);
                  for (let i = 0; i < inputData.length; i++) {
                      let s = Math.max(-1, Math.min(1, inputData[i]));
                      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                  }
                  
                  const bytes = new Uint8Array(pcmData.buffer);
                  let binary = '';
                  const chunkSize = 8192;
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                  }
                  const base64Audio = btoa(binary);
                  
                  wsRef.current.send(JSON.stringify({
                      realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Audio }] }
                  }));
              }
          };
          
          source.connect(processor);
          processor.connect(audioCtx.destination);
          processorRef.current = processor;
          
      } catch (err) {
          console.error("Failed to start mic", err);
      }
  };
  const startScreenShare = async () => {
      try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10 } } });
          setIsScreenSharing(true);
          mediaStreamRef.current = stream;
          if (videoRef.current) {
              videoRef.current.srcObject = stream;
              
              // Start frame extraction loop
              if (!canvasRef.current) {
                  canvasRef.current = document.createElement('canvas');
              }
              // Send a frame every 1 second
              frameIntervalRef.current = setInterval(() => {
                  captureAndSendFrame();
              }, 1000);
          }
      } catch (err) {
          console.error("Failed to share screen:", err);
      }

  };

  const startMic = async () => {
    try {
       if (isMicActive) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn("Connect agent first.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioStreamRef.current = stream;
      setIsMicActive(true);

      const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      const processor = audioContext.createScriptProcessor(2048, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);

      // 🎤 Calculate microphone energy
        let energy = 0;
      for (let i = 0; i < input.length; i++) {
        energy += Math.abs(input[i]);
  }

       energy = energy / input.length;

  // 🛑 BARGE-IN only if user actually speaks
      if (energy > 0.02 && currentSourceRef.current) {
      try {
       currentSourceRef.current.stop();
          } catch {}

      currentSourceRef.current = null;
      nextPlaybackTimeRef.current = 0;
  }

        const pcm16 = new Int16Array(input.length);

        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
        }

       const uint8 = new Uint8Array(pcm16.buffer);
       let binary = "";
       for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
}
       const base64 = btoa(binary);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              realtimeInput: {
                mediaChunks: [
                  {
                    mimeType: "audio/pcm",
                    data: base64
                  }
                ]
              }
            })
          );
        //  silence detection timer
          resetSilenceTimer();
        }
      };

      console.log("Microphone streaming started");

    } catch (err) {
      console.error("Failed to start mic:", err);
    }
  };

function resetSilenceTimer() {

  if (silenceTimerRef.current) {
    clearTimeout(silenceTimerRef.current);
  }

  silenceTimerRef.current = setTimeout(() => {

    if (wsRef.current?.readyState === WebSocket.OPEN) {

      console.log("Silence detected → AI responding");

      wsRef.current.send(JSON.stringify({
        realtimeInput: {
          audio: {
            endOfStream: true
          }
        }
      }));

      silenceTimerRef.current = null;

    }

  }, 1500);
}

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { frameRate: { ideal: 10 } } 
      });
      
      stream.getVideoTracks()[0].onended = () => {
        stopMediaStreams();
      };

      setIsScreenSharing(true);
      mediaStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Start frame extraction loop
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        // Send a frame every 1 second
        frameIntervalRef.current = setInterval(() => {
          captureAndSendFrame();
        }, 3000);
      }
    } catch (err) {
      console.error("Failed to share screen:", err);
    }
  };

  const captureAndSendFrame = () => {
    if (!videoRef.current || !canvasRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Img = canvas.toDataURL('image/jpeg', 0.15).split(',')[1];
      // Send image frame in the schema Gemini Multimodal expects
      wsRef.current.send(JSON.stringify({
        realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: base64Img }] }
      }));
    }
  };

  return {
    isConnected,
    isScreenSharing,
    isMicActive,
    videoRef,
    connect,
    disconnect,
    startMic,
    startScreenShare
  };
}