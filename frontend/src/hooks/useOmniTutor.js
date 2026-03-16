import { useState, useRef, useCallback, useEffect } from 'react';

export function useOmniTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioStreamRef = useRef(null);
  const workletLoadedRef = useRef(false);
  const turnEndedRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const currentSourceRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const frameIntervalRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const nextPlaybackTimeRef = useRef(0);

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

      let text;

      if (typeof event.data === "string") {
        text = event.data;
      } else if (event.data instanceof Blob) {
        text = await event.data.text();
      } else {
        return;
      }

      let response;

      try {
        response = JSON.parse(text);
      } catch {
        return;
      }

      if (response.serverContent?.modelTurn?.parts) {

        const parts = response.serverContent.modelTurn.parts;
        turnEndedRef.current = false;
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
    const binaryString = atob(base64Audio);
    const len = binaryString.length;

    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

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
      audioCtx.resume().catch(() => { });
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
  };

  //   function stopAiSpeech() {

  //   if (currentSourceRef.current) {
  //     try {
  //       currentSourceRef.current.stop();
  //     } catch {}
  //     currentSourceRef.current = null;
  //   }

  //   nextPlaybackTimeRef.current = 0;
  // }

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
      turnEndedRef.current = false;

      const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (!workletLoadedRef.current) {
        await audioContext.audioWorklet.addModule("/mic-processor.js");
        workletLoadedRef.current = true;
      }
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "mic-processor");

      source.connect(workletNode);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      workletNode.port.onmessage = (event) => {

        const input = event.data;

        // detect if user started speaking
        const isSpeaking = input.some(v => Math.abs(v) > 0.04);

        // interrupt AI ONLY once when speech begins
        if (isSpeaking && !userSpeakingRef.current) {
          userSpeakingRef.current = true;

          if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch { }
            currentSourceRef.current = null;
          }

          nextPlaybackTimeRef.current = 0;
        }

        // reset speaking flag when silent
        if (!isSpeaking) {
          userSpeakingRef.current = false;
        }

        const pcm16 = new Int16Array(input.length);

        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
        }

        const uint8 = new Uint8Array(pcm16.buffer);

        let binary = "";
        const chunkSize = 0x6000; // 24KB chunks

        for (let i = 0; i < uint8.length; i += chunkSize) {
          const subarray = uint8.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...subarray);
        }
        const base64 = btoa(binary);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

          wsRef.current.send(
            JSON.stringify({
              realtimeInput: {
                mediaChunks: [
                  {
                    mimeType: "audio/pcm;rate=16000",
                    data: base64
                  }
                ]
              }
            })
          );

          // Always reset silence timer on every chunk so it fires after
          // the user goes truly silent (not just mid-speech)
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

      if (
        wsRef.current?.readyState === WebSocket.OPEN &&
        !turnEndedRef.current
      ) {

        console.log("Silence detected → AI responding");

        wsRef.current.send(JSON.stringify({
          realtimeInput: {
            audioStreamEnd: true
          }
        }));

        turnEndedRef.current = true;
        silenceTimerRef.current = null;
      }

    }, 200);
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
        }, 1000);
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