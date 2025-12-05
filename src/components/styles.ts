export const colors = {
  bg: '#f8f9fa',
  bgCard: '#ffffff',
  bgInput: '#f1f3f5',
  border: '#dee2e6',
  borderFocus: '#94a3b8',
  text: '#212529',
  textMuted: '#6c757d',
  textLight: '#adb5bd',

  primary: '#6b8aac',
  primaryHover: '#5a7999',
  primaryLight: '#e8eff5',

  success: '#7dab8f',
  successBg: '#e8f5ed',
  successBorder: '#c3e0cc',

  warning: '#d4a574',
  warningBg: '#fef5eb',
  warningBorder: '#f0d9c4',

  error: '#c27878',
  errorBg: '#fceaea',
  errorBorder: '#e8c5c5',

  info: '#7ba3c4',
  infoBg: '#eaf3f9',
  infoBorder: '#c5dae8'
} as const;

export const css = `
:root {
  --bg: ${colors.bg};
  --bg-card: ${colors.bgCard};
  --bg-input: ${colors.bgInput};
  --border: ${colors.border};
  --border-focus: ${colors.borderFocus};
  --text: ${colors.text};
  --text-muted: ${colors.textMuted};
  --text-light: ${colors.textLight};
  --primary: ${colors.primary};
  --primary-hover: ${colors.primaryHover};
  --primary-light: ${colors.primaryLight};
  --success: ${colors.success};
  --success-bg: ${colors.successBg};
  --success-border: ${colors.successBorder};
  --warning: ${colors.warning};
  --warning-bg: ${colors.warningBg};
  --warning-border: ${colors.warningBorder};
  --error: ${colors.error};
  --error-bg: ${colors.errorBg};
  --error-border: ${colors.errorBorder};
  --info: ${colors.info};
  --info-bg: ${colors.infoBg};
  --info-border: ${colors.infoBorder};
}

* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  margin: 0;
  padding: 0;
  line-height: 1.5;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.card-header {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text);
}

h1 { font-size: 1.75rem; font-weight: 600; margin: 0 0 24px 0; }
h2 { font-size: 1.25rem; font-weight: 600; margin: 0 0 16px 0; }
h3 { font-size: 1rem; font-weight: 600; margin: 0 0 12px 0; }

.nav {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
  margin-bottom: 24px;
}

.nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 24px;
}

.nav-brand {
  font-weight: 600;
  color: var(--primary);
  text-decoration: none;
}

.nav-link {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.9rem;
}

.nav-link:hover {
  color: var(--primary);
}

.nav-link.active {
  color: var(--primary);
  font-weight: 500;
}

.nav-version {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-light);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

tr:hover td {
  background: var(--primary-light);
}

input, textarea, select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
  background: var(--bg-input);
  color: var(--text);
  transition: border-color 0.2s;
}

input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--border-focus);
  background: var(--bg-card);
}

textarea {
  min-height: 100px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.85rem;
}

label {
  display: block;
  font-weight: 500;
  margin-bottom: 6px;
  font-size: 0.9rem;
  color: var(--text);
}

.form-group {
  margin-bottom: 16px;
}

.form-hint {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 4px;
}

button, .btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--border);
}

.btn-danger {
  background: var(--error);
  color: white;
}

.btn-danger:hover {
  background: #b06666;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.8rem;
}

.btn-group {
  display: flex;
  gap: 8px;
}

.alert {
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 0.9rem;
}

.alert-success {
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  color: var(--success);
}

.alert-warning {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  color: var(--warning);
}

.alert-error {
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  color: var(--error);
}

.alert-info {
  background: var(--info-bg);
  border: 1px solid var(--info-border);
  color: var(--info);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
}

.stat-value {
  font-size: 2rem;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-success {
  background: var(--success-bg);
  color: var(--success);
}

.badge-warning {
  background: var(--warning-bg);
  color: var(--warning);
}

.badge-error {
  background: var(--error-bg);
  color: var(--error);
}

.truncate {
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code {
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.85rem;
  background: var(--bg-input);
  padding: 2px 6px;
  border-radius: 4px;
}

.text-muted {
  color: var(--text-muted);
}

.text-sm {
  font-size: 0.85rem;
}

.mb-0 { margin-bottom: 0; }
.mb-2 { margin-bottom: 8px; }
.mb-4 { margin-bottom: 16px; }
.mt-4 { margin-top: 16px; }

.flex { display: flex; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 8px; }
.gap-4 { gap: 16px; }

.htmx-indicator {
  opacity: 0;
  transition: opacity 0.2s;
}

.htmx-request .htmx-indicator {
  opacity: 1;
}

.htmx-request.htmx-indicator {
  opacity: 1;
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-box {
  width: 100%;
  max-width: 380px;
  padding: 32px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.login-title {
  text-align: center;
  margin-bottom: 24px;
}
`;
