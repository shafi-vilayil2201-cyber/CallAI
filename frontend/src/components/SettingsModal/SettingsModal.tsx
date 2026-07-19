import type { UserProfile } from '../Login/Login';

interface SettingsModalProps {
  user: UserProfile;
  onClose: () => void;
  onLogout: () => void;
}

export function SettingsModal({ user, onClose, onLogout }: SettingsModalProps) {
  return (
    <div
      className="settings-overlay"
      id="settings-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" id="settings-modal">
        {/* Header */}
        <div className="settings-header">
          <h2>Account Settings</h2>
          <button
            className="settings-close-btn"
            id="settings-close"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Body */}
        <div className="settings-body">
          {/* Profile Section */}
          <div className="settings-section">
            <div className="settings-section-label">Profile</div>

            <div className="settings-item">
              <div className="settings-item-left">
                <div className="settings-item-icon">
                  <i className="fa-solid fa-envelope" />
                </div>
                <div className="settings-item-text">
                  <span className="settings-item-key">Email</span>
                  <span className="settings-item-value">{user.email}</span>
                </div>
              </div>
              <span className="settings-role-badge">{user.role}</span>
            </div>

            <div className="settings-item">
              <div className="settings-item-left">
                <div className="settings-item-icon">
                  <i className="fa-solid fa-fingerprint" />
                </div>
                <div className="settings-item-text">
                  <span className="settings-item-key">User ID</span>
                  <span className="settings-item-value" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
                    {user.id}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Organization Section */}
          <div className="settings-section">
            <div className="settings-section-label">Organization</div>

            <div className="settings-item">
              <div className="settings-item-left">
                <div className="settings-item-icon">
                  <i className="fa-solid fa-building" />
                </div>
                <div className="settings-item-text">
                  <span className="settings-item-key">Name</span>
                  <span className="settings-item-value">{user.organizationName}</span>
                </div>
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-left">
                <div className="settings-item-icon">
                  <i className="fa-solid fa-id-card-clip" />
                </div>
                <div className="settings-item-text">
                  <span className="settings-item-key">Organization ID</span>
                  <span className="settings-item-value" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
                    {user.organizationId}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* API Section */}
          <div className="settings-section">
            <div className="settings-section-label">Connection</div>

            <div className="settings-item">
              <div className="settings-item-left">
                <div className="settings-item-icon">
                  <i className="fa-solid fa-plug" />
                </div>
                <div className="settings-item-text">
                  <span className="settings-item-key">Auth Status</span>
                  <span className="settings-item-value" style={{ color: '#a3ff12' }}>
                    <i className="fa-solid fa-circle" style={{ fontSize: '7px', marginRight: '6px' }} />
                    Authenticated
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer — Logout */}
        <div className="settings-footer">
          <button
            className="settings-logout-btn"
            id="settings-logout"
            onClick={onLogout}
          >
            <i className="fa-solid fa-arrow-right-from-bracket" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
