import { useState, useEffect } from 'react';
import { SandboxTerminal } from './components/SandboxTerminal/SandboxTerminal';
import { LatencyPanel } from './components/LatencyPanel/LatencyPanel';
import { Login } from './components/Login/Login';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import type { UserProfile } from './components/Login/Login';

function App() {
  const [activeTab, setActiveTab] = useState<'sandbox' | 'latency'>('sandbox');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  
  // ─── Auth State ───────────────────────────────────────────────────────────
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Set default NestJS endpoint URL
  const apiBase = window.location.origin.includes('localhost') 
    ? 'http://localhost:3000' 
    : window.location.origin;

  // ─── Restore Auth on Mount ────────────────────────────────────────────────
  useEffect(() => {
    const savedToken = localStorage.getItem('latency_token');
    const savedUser = localStorage.getItem('callai_user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch {
        // Corrupted data, clear it
        localStorage.removeItem('latency_token');
        localStorage.removeItem('callai_user');
      }
    }
  }, []);

  // ─── Auth Handlers ────────────────────────────────────────────────────────
  const handleLoginSuccess = (accessToken: string, userProfile: UserProfile) => {
    setToken(accessToken);
    setUser(userProfile);
    localStorage.setItem('latency_token', accessToken);
    localStorage.setItem('callai_user', JSON.stringify(userProfile));
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setShowSettings(false);
    setActiveSessionId(null);
    localStorage.removeItem('latency_token');
    localStorage.removeItem('callai_user');
  };

  // ─── Call Session Handlers ────────────────────────────────────────────────
  const handleCallSessionStarted = (sessionId: string) => {
    setActiveSessionId(sessionId);
    // Auto switch to latency dashboard when call connects so the user can watch the metrics!
    setActiveTab('latency');
  };

  const handleCallSessionEnded = () => {
    setActiveSessionId(null);
  };

  // ─── Render Login Screen if Not Authenticated ─────────────────────────────
  if (!token || !user) {
    return <Login apiBase={apiBase} onLoginSuccess={handleLoginSuccess} />;
  }

  // ─── Authenticated Dashboard ──────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', width: '100vw', minHeight: '100vh' }}>
      
      {/* Left Sidebar */}
      <div className="sidebar">
        <div className="logo-container">
          <div className="logo-glow"></div>
          <i className="fa-solid fa-gauge-high logo-icon"></i>
        </div>
        <div className="nav-items">
          <button 
            className={`nav-item ${activeTab === 'sandbox' ? 'active' : ''}`} 
            onClick={() => setActiveTab('sandbox')}
            title="Developer Sandbox"
          >
            <i className="fa-solid fa-headset"></i>
          </button>
          <button 
            className={`nav-item ${activeTab === 'latency' ? 'active' : ''}`} 
            onClick={() => setActiveTab('latency')}
            title="Latency Monitor"
          >
            <i className="fa-solid fa-chart-line"></i>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-container">
        
        {/* Top Navbar */}
        <div className="top-nav">
          <div className="nav-left">
            <h1>
              <span>LATENCY AI</span> CONTROL PANEL
            </h1>
          </div>
          
          <div style={{ display: 'flex', gap: '16px' }}>
            <button 
              className={`sim-btn ${activeTab === 'sandbox' ? 'sim-btn-primary' : 'sim-btn-secondary'}`}
              onClick={() => setActiveTab('sandbox')}
              style={{ fontSize: '11px', padding: '6px 14px', borderRadius: '20px' }}
            >
              🎙️ Sandbox Phone
            </button>
            <button 
              className={`sim-btn ${activeTab === 'latency' ? 'sim-btn-primary' : 'sim-btn-secondary'}`}
              onClick={() => setActiveTab('latency')}
              style={{ fontSize: '11px', padding: '6px 14px', borderRadius: '20px' }}
            >
              📈 Latency Panel
            </button>
          </div>

          <div className="nav-right">
            <div className="status-badge">
              <div className="status-dot"></div>
              {activeSessionId ? 'ACTIVE CALL SESSION' : 'SYSTEM ONLINE'}
            </div>
            <div
              className="avatar avatar-clickable"
              id="avatar-settings-trigger"
              onClick={() => setShowSettings(true)}
              title="Account Settings"
            >
              {user.email.substring(0, 2).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Dynamic Dashboard Content */}
        <div className="dashboard-content">
          <div style={{ display: activeTab === 'sandbox' ? 'block' : 'none' }}>
            <SandboxTerminal 
              apiBase={apiBase}
              onCallSessionStarted={handleCallSessionStarted}
              onCallSessionEnded={handleCallSessionEnded}
            />
          </div>
          <div style={{ display: activeTab === 'latency' ? 'block' : 'none' }}>
            <LatencyPanel 
              apiBase={apiBase}
              activeSessionId={activeSessionId}
              onAuthError={handleLogout}
            />
          </div>
        </div>

      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          user={user}
          onClose={() => setShowSettings(false)}
          onLogout={handleLogout}
        />
      )}

    </div>
  );
}

export default App;
