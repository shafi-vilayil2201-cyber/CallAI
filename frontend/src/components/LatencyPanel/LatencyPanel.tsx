import { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import type { ChartData } from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend
);

interface LatencyPanelProps {
  apiBase: string;
  activeSessionId: string | null;
  onAuthError?: () => void;
}

interface TimelineEvent {
  strategy: 'FULL' | 'SHORT' | 'FILLER';
  latency: number;
  timeStr: string;
  desc: string;
}

export const LatencyPanel: React.FC<LatencyPanelProps> = ({
  apiBase,
  activeSessionId,
  onAuthError,
}) => {
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [statusText, setStatusText] = useState('SIMULATOR ACTIVE');
  const [statusClass, setStatusClass] = useState('badge badge-active');
  const [strategy, setStrategy] = useState<'FULL' | 'SHORT' | 'FILLER'>('FULL');
  
  // Metrics state
  const [currentLatency, setCurrentLatency] = useState(340);
  const [avgLatency, setAvgLatency] = useState(313);
  const [minLatency, setMinLatency] = useState(280);
  const [maxLatency, setMaxLatency] = useState(340);
  
  // History arrays
  const [history, setHistory] = useState<number[]>([290, 310, 340, 280, 330, 340]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([
    {
      strategy: 'FULL',
      latency: 340,
      timeStr: new Date().toLocaleTimeString(),
      desc: 'System initialized in simulation mode.',
    },
  ]);

  // Health and impact states
  const [healthStatus, setHealthStatus] = useState<'online' | 'warning'>('online');
  const [clampedCount, setClampedCount] = useState(0);
  const [reductionPct, setReductionPct] = useState(42.8);

  const pollIntervalRef = useRef<any>(null);
  const simulatedTurnsRef = useRef<number>(0);

  // Sync session input with active session from terminal
  useEffect(() => {
    if (activeSessionId) {
      setSessionId(activeSessionId);
    }
  }, [activeSessionId]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Strategy themes configuration
  const themes = {
    FULL: {
      color: '#a3ff12',
      glow: 'active-glow-full',
      hero: 'full',
      tabClass: 'active full',
      tabs: [true, false, false],
    },
    SHORT: {
      color: '#ffd60a',
      glow: 'active-glow-short',
      hero: 'short',
      tabClass: 'active short',
      tabs: [false, true, false],
    },
    FILLER: {
      color: '#ff3b30',
      glow: 'active-glow-filler',
      hero: 'filler',
      tabClass: 'active filler',
      tabs: [false, false, true],
    },
  };

  const currentTheme = themes[strategy];

  // ─── Chart Data ───────────────────────────────────────────────────────────
  const chartData: ChartData<'line'> = {
    labels: history.map((_, i) => `Turn ${i + 1}`),
    datasets: [
      {
        data: history,
        borderColor: currentTheme.color,
        borderWidth: 2,
        pointBackgroundColor: currentTheme.color,
        pointBorderColor: 'rgba(0,0,0,0.8)',
        pointHoverRadius: 7,
        pointRadius: 4,
        fill: true,
        backgroundColor: (context) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 200);
          gradient.addColorStop(0, `${currentTheme.color}25`); // Hex with 15% alpha
          gradient.addColorStop(1, `${currentTheme.color}00`);
          return gradient;
        },
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } },
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } },
        min: 0,
        max: 5500,
      },
    },
  };

  // ─── Polling Mode Logic ───────────────────────────────────────────────────
  const fetchLiveMetrics = async (activeId: string) => {
    try {
      const token = localStorage.getItem('latency_token');
      if (!token) {
        // No token found — user needs to re-authenticate
        onAuthError?.();
        return;
      }

      const res = await fetch(`${apiBase}/v1/debug/latency/${activeId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('latency_token');
          localStorage.removeItem('callai_user');
          onAuthError?.();
          return;
        }
        throw new Error(`Session inactive or API disabled.`);
      }

      const data = await res.json();
      
      setStatusText('ACTIVE');
      setStatusClass('badge badge-active');
      setHealthStatus('online');
      
      setStrategy(data.strategy);
      setCurrentLatency(data.currentLatency);
      setAvgLatency(data.avgLatency);

      const liveHistory = data.history || [];
      setHistory(liveHistory);
      
      if (liveHistory.length > 0) {
        setMinLatency(Math.min(...liveHistory));
        setMaxLatency(Math.max(...liveHistory));
      }

      // Add timeline event on changes
      const latestTimeStr = new Date().toLocaleTimeString();
      setTimeline((prev) => {
        if (prev.length === 0 || prev[0].strategy !== data.strategy) {
          return [
            {
              strategy: data.strategy,
              latency: data.currentLatency,
              timeStr: latestTimeStr,
              desc: `Strategy tier auto-scaled based on average turn latency of ${data.avgLatency}ms.`,
            },
            ...prev.slice(0, 2),
          ];
        }
        return prev;
      });

      // Calculate clamped count
      const clamped = liveHistory.filter((x: number) => x >= 5000).length;
      setClampedCount(clamped);

      // Efficiency reduction math
      const reduction = data.avgLatency > 0 
        ? Math.max(10, Math.round(((5000 - data.avgLatency) / 5000) * 100))
        : 0;
      setReductionPct(reduction);

    } catch (err: any) {
      setStatusText('DISCONNECTED');
      setStatusClass('badge badge-idle');
      setHealthStatus('warning');
      console.warn('API polling error:', err.message);
    }
  };

  const toggleMode = () => {
    setIsLiveMode((prev) => {
      const next = !prev;
      if (next) {
        const targetId = sessionId.trim() || 'default-session';
        setSessionId(targetId);
        fetchLiveMetrics(targetId);
        pollIntervalRef.current = setInterval(() => fetchLiveMetrics(targetId), 2000);
      } else {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setStatusText('SIMULATOR ACTIVE');
        setStatusClass('badge badge-active');
      }
      return next;
    });
  };

  // ─── Simulation Mode Logic ────────────────────────────────────────────────
  const runSimulatedTurn = (targetLatency: number | null = null) => {
    simulatedTurnsRef.current++;
    
    // Random standard latency (240ms - 390ms) if none specified
    const rawVal = targetLatency !== null 
      ? targetLatency 
      : Math.round(240 + Math.random() * 150);

    const cappedVal = Math.min(rawVal, 5000);
    const isClamped = rawVal !== cappedVal;

    setHistory((prev) => {
      const next = [...prev, cappedVal];
      if (next.length > 10) next.shift(); // sliding window of 10

      // Recompute metrics based on history
      const sum = next.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / next.length);
      setAvgLatency(avg);
      setMinLatency(Math.min(...next));
      setMaxLatency(Math.max(...next));

      // Resolve strategy
      let nextStrategy: 'FULL' | 'SHORT' | 'FILLER' = 'FULL';
      if (next.length >= 3) {
        // Spike check
        const last = next[next.length - 1];
        if (avg > 200 && last > 2 * avg) {
          nextStrategy = avg < 400 ? 'SHORT' : 'FILLER';
        } else {
          nextStrategy = avg < 400 ? 'FULL' : avg < 800 ? 'SHORT' : 'FILLER';
        }
      }
      
      setStrategy(nextStrategy);
      setCurrentLatency(cappedVal);

      // Add to timeline
      const timeStr = new Date().toLocaleTimeString();
      const desc = isClamped 
        ? `🔥 Safety clamp triggered on runaway latency spike (Original: ${rawVal}ms).`
        : `Turn ${simulatedTurnsRef.current} processed. Metrics stable.`;

      setTimeline((prevTimeline) => [
        { strategy: nextStrategy, latency: cappedVal, timeStr, desc },
        ...prevTimeline.slice(0, 2),
      ]);

      // Update clamped indicators
      const cloned = next.filter(x => x >= 5000).length;
      setClampedCount(cloned);

      const reduction = Math.max(10, Math.round(((5000 - avg) / 5000) * 100));
      setReductionPct(reduction);

      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* 3 Columns Top Cards */}
      <div className="dashboard-grid">
        
        {/* CARD A: Live Session Control */}
        <div className={`glass-card ${currentTheme.glow}`} id="card-session">
          <div className="card-header">
            <div className="card-title">
              <i className="fa-solid fa-signal"></i>
              Live Session Control
            </div>
            <div className="card-actions">
              <button className="card-btn" onClick={toggleMode}>
                {isLiveMode ? 'Switch to Sim Mode' : 'Switch to Live API'}
              </button>
            </div>
          </div>
          <div className="card-body">
            <div className="session-input-wrapper">
              <input
                type="text"
                className="session-input"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="Enter active session UUID..."
              />
              <i className="fa-solid fa-barcode"></i>
            </div>
            <div className="session-details">
              <div className="detail-row">
                <span className="detail-label">Call Stream State</span>
                <span className={statusClass}>{statusText}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Current Strategy</span>
                <span className="detail-val" style={{ color: currentTheme.color }}>
                  {strategy}
                </span>
              </div>
            </div>
            <div className="strategy-display" style={{ marginTop: '16px' }}>
              <div className={`strategy-tab ${currentTheme.tabs[0] ? currentTheme.tabClass : ''}`}>FULL</div>
              <div className={`strategy-tab ${currentTheme.tabs[1] ? currentTheme.tabClass : ''}`}>SHORT</div>
              <div className={`strategy-tab ${currentTheme.tabs[2] ? currentTheme.tabClass : ''}`}>FILLER</div>
            </div>
          </div>
        </div>

        {/* CARD B: Latency Metrics */}
        <div className="glass-card" id="card-metrics">
          <div className="card-header">
            <div className="card-title">
              <i className="fa-solid fa-stopwatch"></i>
              Latency Metrics
            </div>
            <span className="timeline-time" style={{ fontSize: '11px' }}>10-TURN WINDOW</span>
          </div>
          <div className="card-body">
            <div className="metric-hero">
              <div className={`metric-value ${currentTheme.hero}`}>
                <span>{currentLatency}</span>
                <span className="metric-unit">ms</span>
              </div>
              <div className="metric-label">CURRENT TURN LATENCY</div>
            </div>
            <div className="metrics-row">
              <div className="metric-subcell">
                <div className="subcell-val">{avgLatency}ms</div>
                <div className="subcell-label">AVG</div>
              </div>
              <div className="metric-subcell">
                <div className="subcell-val">{minLatency}ms</div>
                <div className="subcell-label">MIN</div>
              </div>
              <div className="metric-subcell">
                <div className="subcell-val">{maxLatency}ms</div>
                <div className="subcell-label">MAX</div>
              </div>
            </div>
            <div className="latency-bar-container">
              <div
                className="latency-bar-progress"
                style={{
                  width: `${Math.min((currentLatency / 5000) * 100, 100)}%`,
                  background: `linear-gradient(90deg, #a3ff12 0%, #ffd60a 50%, #ff3b30 100%)`
                }}
              ></div>
            </div>
          </div>
        </div>

        {/* CARD C: Strategy Engine */}
        <div className="glass-card" id="card-engine">
          <div className="card-header">
            <div className="card-title">
              <i className="fa-solid fa-gears"></i>
              Strategy Engine
            </div>
          </div>
          <div className="card-body">
            <div className="timeline-container">
              {timeline.map((event, idx) => {
                let nodeColor = 'active-full';
                if (event.strategy === 'SHORT') nodeColor = 'active-short';
                if (event.strategy === 'FILLER') nodeColor = 'active-filler';
                
                return (
                  <div className="timeline-item" key={idx}>
                    <div className={`timeline-node ${nodeColor}`}></div>
                    <div className="timeline-info">
                      <div className="timeline-header-row">
                        <span className="timeline-status">
                          Strategy resolved: {event.strategy} <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--text-muted)', fontWeight: 'normal' }}>({event.latency}ms)</span>
                        </span>
                        <span className="timeline-time">{event.timeStr}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {event.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="engine-pills" style={{ marginTop: '18px' }}>
              <div className={`engine-pill ${strategy === 'FULL' ? 'active' : ''}`}>Optimized</div>
              <div className={`engine-pill ${strategy !== 'FULL' ? 'active' : ''}`}>Fallback Triggered</div>
            </div>
          </div>
        </div>

      </div>

      {/* Grid bottom cards */}
      <div className="dashboard-grid">
        
        {/* CARD D: Wide Chart */}
        <div className="glass-card wide-card">
          <div className="card-header">
            <div className="card-title">
              <i className="fa-solid fa-chart-area"></i>
              Real-time Latency Chart
            </div>
            <div className="card-actions">
              <span className="timeline-time" style={{ fontSize: '11px' }}>REFRESHING IN REAL-TIME</span>
            </div>
          </div>
          <div className="card-body">
            <div className="chart-container">
              <Line data={chartData} options={chartOptions} />
            </div>
          </div>
        </div>

        {/* Right Stack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* CARD E: System Health */}
          <div className="glass-card" style={{ flex: 1 }}>
            <div className="card-header">
              <div className="card-title">
                <i className="fa-solid fa-heartbeat"></i>
                System Health
              </div>
            </div>
            <div className="card-body">
              <div className="health-grid">
                <div className="health-item">
                  <span className="health-label">API Status</span>
                  <span className="health-value">
                    <div className="health-indicator"></div>
                    Online
                  </span>
                </div>
                <div className="health-item">
                  <span className="health-label">Twilio</span>
                  <span className="health-value">
                    <div className="health-indicator"></div>
                    Connected
                  </span>
                </div>
                <div className="health-item">
                  <span className="health-label">WebSocket</span>
                  <span className="health-value">
                    <div className="health-indicator"></div>
                    Active
                  </span>
                </div>
                <div className="health-item">
                  <span className="health-label">AI Model</span>
                  <span className="health-value">
                    <div className={`health-indicator ${healthStatus === 'warning' ? 'warning' : ''}`}></div>
                    Responding
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* CARD F: Performance Impact */}
          <div className="glass-card" style={{ flex: 1 }}>
            <div className="card-header">
              <div className="card-title">
                <i className="fa-solid fa-gauge-simple-high"></i>
                Performance Impact
              </div>
            </div>
            <div className="card-body">
              <div className="impact-metrics">
                <div className="impact-item">
                  <div className="impact-icon-box">
                    <i className="fa-solid fa-bolt"></i>
                  </div>
                  <div className="impact-info">
                    <div className="impact-label">Average Latency Reduction</div>
                    <div className="impact-value">{reductionPct}%</div>
                  </div>
                </div>
                <div className="impact-item">
                  <div className="impact-icon-box">
                    <i className="fa-solid fa-hand-holding-dollar"></i>
                  </div>
                  <div className="impact-info">
                    <div className="impact-label">Turn Latency Cap Spikes</div>
                    <div className="impact-value">{clampedCount} Clamped</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Simulator bar footer */}
      {!isLiveMode && (
        <div className="simulation-control-bar">
          <div className="sim-left">
            <span className="sim-tag">Simulation Mode</span>
            <span className="sim-desc">Simulate standard call turns or run-away spikes (e.g. 6.5s) to preview safety clamping.</span>
          </div>
          <div className="sim-actions">
            <button className="sim-btn sim-btn-secondary" onClick={() => runSimulatedTurn(6500)}>
              Simulate Latency Spike (6.5s)
            </button>
            <button className="sim-btn sim-btn-primary" onClick={() => runSimulatedTurn(null)}>
              Simulate Next Turn
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
