import { useState, FormEvent } from 'react';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
}

interface LoginProps {
  apiBase: string;
  onLoginSuccess: (token: string, user: UserProfile) => void;
}

export function Login({ apiBase, onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${apiBase}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Invalid email or password.');
      }

      const data = await res.json();
      onLoginSuccess(data.accessToken, data.user);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed. Is the backend running?';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const fillDemoCredentials = () => {
    setEmail('admin@callai.com');
    setPassword('admin123456');
    setError(null);
  };

  return (
    <div className="login-container" id="login-screen">
      {/* Floating ambient glow spheres */}
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />
      <div className="login-orb login-orb-3" />

      <div className="login-card">
        {/* Header */}
        <div className="login-header">
          <div className="login-logo-icon">
            <i className="fa-solid fa-shield-halved" />
          </div>
          <h1>
            <span>CallAI</span> Admin
          </h1>
          <p>Sign in to the developer control panel</p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error" id="login-error">
              <i className="fa-solid fa-circle-exclamation" />
              {error}
            </div>
          )}

          <div className="login-input-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              placeholder="admin@callai.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
            />
          </div>

          <div className="login-input-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="login-submit-btn"
            id="login-submit"
            disabled={isLoading || !email || !password}
          >
            {isLoading ? (
              <>
                <span className="login-spinner" />
                Authenticating…
              </>
            ) : (
              'Sign In'
            )}
          </button>

          {/* Dev credentials auto-fill */}
          <div
            className="login-credentials-hint"
            id="login-autofill"
            onClick={fillDemoCredentials}
          >
            <i className="fa-solid fa-wand-magic-sparkles" />
            <span>
              Use dev credentials: <strong>admin@callai.com</strong>
            </span>
          </div>
        </form>

        <div className="login-footer">
          CALLAI ENGINE &nbsp;·&nbsp; REAL-TIME VOICE INFRASTRUCTURE
        </div>
      </div>
    </div>
  );
}

export type { UserProfile };
