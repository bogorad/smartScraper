export const css = `
:root {
  /* Catppuccin Latte (Light) */
  --bg: #eff1f5;
  --bg-card: #ffffff;
  --bg-subtle: #e6e9ef;
  --bg-input: #e6e9ef;
  
  --text: #4c4f69;
  --text-muted: #6c6f85;
  --text-light: #9ca0b0;
  
  --border: #ccd0da;
  --border-focus: #1e66f5;
  
  --primary: #1e66f5;
  --primary-hover: #1755cc;
  --primary-fg: #ffffff;
  
  --success: #40a02b;
  --success-bg: #eff1f5; /* refined later */
  --success-border: #40a02b;
  
  --warning: #df8e1d;
  --warning-bg: #eff1f5;
  --warning-border: #df8e1d;
  
  --error: #d20f39;
  --error-bg: #eff1f5;
  --error-border: #d20f39;
  
  --info: #04a5e5;
  --info-bg: #eff1f5;
  --info-border: #04a5e5;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  
  --radius: 8px;
  --radius-sm: 4px;
}

html[data-theme='dark'] {
  /* Catppuccin Mocha (Dark) */
  --bg: #1e1e2e;
  --bg-card: #181825;
  --bg-subtle: #313244;
  --bg-input: #313244;
  
  --text: #cdd6f4;
  --text-muted: #a6adc8;
  --text-light: #7f849c;
  
  --border: #45475a;
  --border-focus: #89b4fa;
  
  --primary: #89b4fa;
  --primary-hover: #74c7ec;
  --primary-fg: #1e1e2e;
  
  --success: #a6e3a1;
  --success-bg: #1e1e2e;
  --success-border: #a6e3a1;
  
  --warning: #f9e2af;
  --warning-bg: #1e1e2e;
  --warning-border: #f9e2af;
  
  --error: #f38ba8;
  --error-bg: #1e1e2e;
  --error-border: #f38ba8;
  
  --info: #89dceb;
  --info-bg: #1e1e2e;
  --info-border: #89dceb;
  
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
}

* { box-sizing: border-box; }

body {
  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text);
  margin: 0;
  padding: 0;
  line-height: 1.5;
  transition: background-color 0.3s, color 0.3s;
  font-size: 14px; /* More compact base font */
}

.container {
  max-width: 1000px; /* More compact width */
  margin: 0 auto;
  padding: 20px 16px;
}

/* --- Components --- */

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px; /* Compact padding */
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}

.card-header {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* --- Navigation --- */

.nav {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 10px 0;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-inner {
  max-width: 1000px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 20px;
}

.nav-brand {
  font-size: 1rem;
  font-weight: 700;
  color: var(--primary);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-link {
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
  transition: color 0.2s;
}

.nav-link:hover, .nav-link.active {
  color: var(--primary);
}

.nav-spacer { flex: 1; }

.theme-toggle {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-toggle:hover {
  background: var(--bg-subtle);
  color: var(--text);
}

/* --- Typography --- */

h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 20px 0; }
h2 { font-size: 1.2rem; font-weight: 600; margin: 0 0 16px 0; }
h3 { font-size: 1rem; font-weight: 600; margin: 0 0 12px 0; }

/* --- Forms --- */

.form-group { margin-bottom: 16px; }

label {
  display: block;
  font-weight: 500;
  margin-bottom: 6px;
  font-size: 0.85rem;
  color: var(--text);
}

input, textarea, select {
  width: 100%;
  padding: 8px 12px; /* Compact inputs */
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  background: var(--bg-input);
  color: var(--text);
  transition: border-color 0.2s;
}

input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--border-focus);
}

/* --- Buttons --- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px; /* Compact buttons */
  border: none;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
  line-height: 1;
}

.btn-primary {
  background: var(--primary);
  color: var(--primary-fg);
}

.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--bg-subtle);
}

.btn-danger {
  background: var(--error);
  color: var(--bg);
}

.btn-sm { padding: 4px 10px; font-size: 0.75rem; }

.btn-group { display: flex; gap: 8px; }

/* --- Tables --- */

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

td {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9rem;
}

tr:last-child td { border-bottom: none; }

tr:hover td {
  background: var(--bg-subtle);
}

/* --- Alerts & Badges --- */

.alert {
  padding: 12px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-weight: 500;
  border: 1px solid currentColor;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
}

.alert-success { color: var(--success); background: rgba(166, 227, 161, 0.1); }
.alert-error { color: var(--error); background: rgba(243, 139, 168, 0.1); }
.alert-info { color: var(--info); background: rgba(137, 220, 235, 0.1); }

.badge {
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 0.7rem;
  font-weight: 600;
  border: 1px solid currentColor;
}

.badge-success { color: var(--success); background: rgba(166, 227, 161, 0.1); }
.badge-warning { color: var(--warning); background: rgba(249, 226, 175, 0.1); }
.badge-error { color: var(--error); background: rgba(243, 139, 168, 0.1); }

/* --- Stats --- */

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--primary);
  line-height: 1;
  margin: 8px 0 4px 0;
}

.stat-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
}

/* --- Toast --- */
#toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toast {
  min-width: 280px;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  color: var(--text);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* --- Responsive / Mobile --- */

@media (max-width: 640px) {
  .container { padding: 16px; }
  
  .nav-inner {
    gap: 12px;
    flex-wrap: wrap;
  }
  
  .nav-brand { font-size: 0.9rem; }
  .nav-link { font-size: 0.85rem; }
  .nav-version { display: none; }
  
  h1 { font-size: 1.25rem; }
  
  .card { padding: 12px; }
  
  th, td { padding: 8px; font-size: 0.85rem; }
  
  /* Hide less important table columns on mobile */
  th:nth-child(2), td:nth-child(2) { display: none; } /* XPath */
  th:nth-child(3), td:nth-child(3) { display: none; } /* Last Success */
  
  .stat-value { font-size: 1.5rem; }
  
  .btn { padding: 6px 12px; font-size: 0.8rem; }
  
  .login-box { padding: 20px; }
}

/* --- Utilities --- */
.text-muted { color: var(--text-muted) !important; }
.text-sm { font-size: 0.8rem; }
.flex { display: flex; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 8px; }
.gap-4 { gap: 16px; }
.mb-4 { margin-bottom: 16px; }
.truncate { max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.code { font-family: 'JetBrains Mono', monospace; font-size: 0.8em; background: var(--bg-subtle); padding: 2px 4px; border-radius: 4px; color: var(--primary); }

.login-container {
  background: var(--bg);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.login-box {
  background: var(--bg-card);
  padding: 32px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 360px;
}
`;
