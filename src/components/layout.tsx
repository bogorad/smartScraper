import type { FC, PropsWithChildren } from 'hono/jsx';
import { css } from './styles.js';
import { VERSION } from '../constants.js';

interface LayoutProps {
  title?: string;
  activePath?: string;
  theme?: string;
}

const ThemeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5" class="sun-core" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" class="sun-rays" />
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" class="moon" style="display: none" />
  </svg>
);

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ children, title = 'SmartScraper', activePath, theme = 'light' }) => {
  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#eff1f5" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e1e2e" />
        <title>{title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <style>{`
          html[data-theme="dark"] .sun-core, html[data-theme="dark"] .sun-rays { display: none; }
          html[data-theme="dark"] .moon { display: block; }
        `}</style>
        <script src="/htmx.min.js"></script>
      </head>
      <body>
        <nav class="nav">
          <div class="nav-inner">
            <a href="/dashboard" class="nav-brand">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              SmartScraper
            </a>
            <a href="/dashboard/sites" class={`nav-link ${activePath === '/dashboard/sites' ? 'active' : ''}`}>Sites</a>
            <a href="/dashboard/stats" class={`nav-link ${activePath === '/dashboard/stats' ? 'active' : ''}`}>Stats</a>
            
            <div class="nav-spacer"></div>
            
            <button class="theme-toggle" hx-post="/dashboard/theme" hx-swap="none" aria-label="Toggle theme">
              <ThemeIcon />
            </button>
            <span class="nav-version">v{VERSION} ({theme})</span>
          </div>
        </nav>
        
        <main class="container">
          {children}
        </main>
      </body>
    </html>
  );
};

export const LoginLayout: FC<PropsWithChildren<{ title?: string; theme?: string }>> = ({ children, title = 'Login - SmartScraper', theme = 'light' }) => {
  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <style>{`
          html[data-theme="dark"] .sun-core, html[data-theme="dark"] .sun-rays { display: none; }
          html[data-theme="dark"] .moon { display: block; }
        `}</style>
      </head>
      <body>
        <div class="login-container">
          <div class="login-box">
            <div style="position: absolute; top: 20px; right: 20px;">
              <button class="theme-toggle" hx-post="/dashboard/theme" hx-swap="none" aria-label="Toggle theme">
                <ThemeIcon />
              </button>
            </div>
            {children}
          </div>
        </div>
        <script src="/htmx.min.js"></script>
      </body>
    </html>
  );
};
