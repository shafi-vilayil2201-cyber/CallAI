import React, { useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface SandboxTerminalProps {
  apiBase: string;
  onCallSessionStarted?: (sessionId: string) => void;
  onCallSessionEnded?: () => void;
}

export const SandboxTerminal: React.FC<SandboxTerminalProps> = ({
  apiBase,
  onCallSessionStarted,
  onCallSessionEnded,
}) => {
  const [fromNumber, setFromNumber] = useState('+919999999999');
  const [toNumber, setToNumber] = useState('+918888888888');
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState('Disconnected');
  const [transcript, setTranscript] = useState('AI responses will be transcribed here in real-time...');
  const [logs, setLogs] = useState<string[]>([]);
  const [isCalling, setIsCalling] = useState(false);

  // Web Audio & WebSocket References
  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const callSidRef = useRef<string | null>(null);
  const callSessionIdRef = useRef<string | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const timeStr = new Date().toLocaleTimeString();
    const typeIndicator = {
      info: '🔵',
      success: '🟢',
      warning: '🟡',
      error: '🔴',
    }[type];
    setLogs((prev) => [...prev, `[${timeStr}] ${typeIndicator} ${message}`]);
  };

  const startCall = async () => {
    if (!apiBase) {
      alert('Please specify backend API URL');
      return;
    }

    setIsCalling(true);
    const mockSid = 'call_mock_' + Math.random().toString(36).substring(7);
    callSidRef.current = mockSid;
    
    addLog(`Triggering inbound webhook at ${apiBase}/v1/telephony/exotel/inbound...`, 'info');

    try {
      const response = await fetch(`${apiBase}/v1/telephony/exotel/inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          CallSid: mockSid,
          From: fromNumber,
          To: toNumber,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 'success') {
        throw new Error(data.reason || 'Telephony rejected call');
      }

      const wsUrl = data.instruction.url;
      const providerName = data.instruction.provider || 'openai';
      addLog(`Webhook registered successfully! Action: ${data.instruction.action} (Provider: ${providerName})`, 'success');
      
      const urlObj = new URL(wsUrl);
      const callSessionId = urlObj.searchParams.get('callSessionId');
      if (!callSessionId) throw new Error('Missing callSessionId in instruction URL');
      
      callSessionIdRef.current = callSessionId;
      addLog(`Extracted callSessionId: ${callSessionId}`, 'info');

      if (onCallSessionStarted) {
        onCallSessionStarted(callSessionId);
      }

      // Connect WebSocket
      connectWebSocket(callSessionId, providerName);

    } catch (err: any) {
      addLog(`Failed to initiate sandbox call: ${err.message}`, 'error');
      hangUpCall();
    }
  };

  const connectWebSocket = (sessionId: string, providerName: string) => {
    addLog(`Connecting to voice gateway stream websocket...`, 'info');

    const socket = io(apiBase, {
      path: '/v1/voice-stream',
      query: {
        token: 'bypass-auth',
        callSessionId: sessionId,
      },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      addLog('Voice Stream WebSocket connection established.', 'success');
      setIsConnected(true);
      setStatusText('Connected / Streaming');
      startAudioStreaming(providerName);
    });

    socket.on('disconnect', () => {
      addLog('Voice Stream WebSocket disconnected.', 'warning');
      hangUpCall();
    });

    socket.on('connect_error', (error) => {
      addLog(`Connection Error: ${error.message}`, 'error');
      hangUpCall();
    });

    let accumulatedTranscript = '';
    let audioPacketCount = 0;

    socket.on('audio-out', (data: { payload: string }) => {
      if (!audioContextRef.current) return;

      const binaryString = window.atob(data.payload);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const numSamples = Math.floor(bytes.length / 2);
      if (numSamples === 0) return;

      const pcmFloatArray = new Float32Array(numSamples);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      
      for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true); // little-endian
        pcmFloatArray[i] = int16 / 32768;
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, pcmFloatArray.length, 24000);
      audioBuffer.copyToChannel(pcmFloatArray, 0);

      const bufferSource = audioContextRef.current.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(audioContextRef.current.destination);

      const currentTime = audioContextRef.current.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime;
      }

      isSpeakingRef.current = true;
      bufferSource.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;

      bufferSource.onended = () => {
        if (audioContextRef.current && audioContextRef.current.currentTime >= nextPlayTimeRef.current - 0.05) {
          isSpeakingRef.current = false;
        }
      };

      audioPacketCount++;
      if (audioPacketCount % 20 === 1) {
        addLog(`Receiving synthetic audio stream from AI... (${audioPacketCount} packets)`, 'success');
      }
    });

    socket.on('audio-out-transcript', (text: string) => {
      if (accumulatedTranscript === '') {
        setTranscript('');
      }
      accumulatedTranscript += text;
      setTranscript(accumulatedTranscript);
    });

    socket.on('message', (event: { type: string }) => {
      addLog(`Received Event: ${event.type}`, 'info');
    });
  };

  const startAudioStreaming = async (provider: string) => {
    try {
      addLog('Requesting microphone permissions...', 'info');
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micStreamRef.current = micStream;
      const targetRate = provider === 'gemini' ? 16000 : 24000;
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: targetRate,
      });
      audioContextRef.current = audioContext;

      addLog(`Microphone captured. AudioContext sample rate: ${audioContext.sampleRate}Hz (Provider: ${provider})`, 'info');

      const source = audioContext.createMediaStreamSource(micStream);
      const processorNode = audioContext.createScriptProcessor(1024, 1, 1);
      
      processorNodeRef.current = processorNode;
      source.connect(processorNode);
      processorNode.connect(audioContext.destination);

      let sequence = 0;
      
      processorNode.onaudioprocess = (e) => {
        if (!socketRef.current || socketRef.current.disconnected) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16Buffer = new ArrayBuffer(inputData.length * 2);
        const pcm16View = new DataView(pcm16Buffer);

        for (let i = 0; i < inputData.length; i++) {
          const floatSample = inputData[i];
          const intSample = Math.max(-32768, Math.min(32767, Math.round(floatSample * 32767)));
          pcm16View.setInt16(i * 2, intSample, true);
        }

        const bytes = new Uint8Array(pcm16Buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Payload = window.btoa(binary);

        socketRef.current.emit('audio-in', {
          payload: base64Payload,
          sequence: sequence++,
          timestamp: Date.now(),
        });
      };

      addLog(`Microphone audio stream active - PCM16 at ${targetRate}Hz.`, 'success');

    } catch (err: any) {
      addLog(`Failed to initiate audio streaming: ${err.message}`, 'error');
      hangUpCall();
    }
  };

  const hangUpCall = async () => {
    addLog('Hanging up sandbox call...', 'warning');

    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (callSidRef.current) {
      try {
        await fetch(`${apiBase}/v1/telephony/exotel/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            CallSid: callSidRef.current,
            Status: 'completed',
          }),
        });
        addLog('Carrier status callback updated to: completed', 'info');
      } catch (e) {}
      callSidRef.current = null;
    }

    callSessionIdRef.current = null;
    setIsConnected(false);
    setIsCalling(false);
    setStatusText('Disconnected');
    setTranscript('AI responses will be transcribed here in real-time...');
    
    if (onCallSessionEnded) {
      onCallSessionEnded();
    }

    addLog('Sandbox call cleared.', 'info');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
      
      {/* Configuration & Controls */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h3 className="card-title">
          <i className="fa-solid fa-sliders" style={{ color: 'var(--accent-neon)' }}></i>
          Session Configurations
        </h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
          <div className="form-group">
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>
              NestJS Endpoint URL
            </label>
            <input
              type="text"
              value={apiBase}
              disabled
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--card-border)',
                borderRadius: '10px',
                padding: '12px',
                color: '#fff',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '13px'
              }}
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>
              Caller Number (Mock)
            </label>
            <input
              type="text"
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
              className="session-input"
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 'bold' }}>
              Receiver Number (Mock Route selector)
            </label>
            <input
              type="text"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              className="session-input"
            />
            <small style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
              Starting with <strong>+91</strong> routes to ExotelProvider, others to Twilio.
            </small>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button
              onClick={startCall}
              disabled={isCalling}
              className="sim-btn sim-btn-primary"
              style={{ flex: 1, padding: '12px', opacity: isCalling ? 0.5 : 1 }}
            >
              🚀 Start Sandbox Call
            </button>
            <button
              onClick={hangUpCall}
              disabled={!isCalling}
              className="sim-btn sim-btn-secondary"
              style={{ padding: '12px 24px', opacity: !isCalling ? 0.5 : 1, border: '1px solid rgba(255,59,48,0.3)', color: 'var(--accent-red)' }}
            >
              ❌ Hang Up
            </button>
          </div>
        </div>
      </div>

      {/* Live Stream Audio Status & Transcripts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        <div className="glass-card" style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h3 className="card-title">
            <i className="fa-solid fa-headset" style={{ color: 'var(--accent-neon)' }}></i>
            Live Audio Gateway
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', margin: 'auto 0' }}>
            {/* Visual Orb */}
            <div 
              className={`orb ${isSpeakingRef.current ? 'speaking' : ''}`}
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: isConnected ? 'var(--accent-neon)' : 'var(--text-muted)',
                boxShadow: isConnected ? '0 0 20px var(--accent-neon-glow)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isConnected ? '#000' : '#fff',
                fontSize: '20px',
                transition: 'all 0.3s ease'
              }}
            >
              <i className="fa-solid fa-microphone"></i>
            </div>
            
            <div className={`status-badge ${isConnected ? 'connected' : ''}`} style={{ background: isConnected ? 'rgba(163,255,18,0.1)' : 'rgba(255,255,255,0.03)', color: isConnected ? 'var(--accent-neon)' : 'var(--text-secondary)' }}>
              <div className="status-dot" style={{ background: isConnected ? 'var(--accent-neon)' : 'var(--text-muted)' }}></div>
              <span>{statusText}</span>
            </div>
          </div>

          <div 
            className="transcript-box"
            style={{
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '12px',
              padding: '16px',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              fontSize: '13px',
              lineHeight: '1.5',
              height: '100px',
              overflowY: 'auto',
              border: '1px solid var(--card-border)',
              marginTop: 'auto'
            }}
          >
            {transcript}
          </div>
        </div>

      </div>

      {/* Sandbox Terminal Console */}
      <div className="glass-card" style={{ gridColumn: 'span 2', padding: '24px' }}>
        <h3 className="card-title">
          <i className="fa-solid fa-terminal" style={{ color: 'var(--accent-neon)' }}></i>
          Sandbox Debug Terminal
        </h3>
        <div 
          className="terminal"
          style={{
            background: 'rgba(0,0,0,0.4)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '12px',
            padding: '16px',
            borderRadius: '12px',
            height: '200px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            border: '1px solid var(--card-border)',
            marginTop: '16px'
          }}
        >
          <div style={{ color: 'var(--text-muted)' }}>[System] Debug terminal initialized. Ready for connections.</div>
          {logs.map((log, index) => (
            <div key={index} style={{ whiteSpace: 'pre-wrap', color: log.includes('🟢') ? 'var(--accent-neon)' : log.includes('🔴') ? 'var(--accent-red)' : log.includes('🟡') ? 'var(--accent-yellow)' : 'var(--text-primary)' }}>
              {log}
            </div>
          ))}
          <div ref={terminalEndRef}></div>
        </div>
      </div>

    </div>
  );
};
