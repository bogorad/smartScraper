import type { FC, PropsWithChildren } from 'hono/jsx';
import { css } from './styles.js';
import { VERSION } from '../constants.js';

interface LayoutProps {
  title?: string;
  activePath?: string;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ children, title = 'SmartScraper', activePath }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <style>{css}</style>
        <script src="/htmx.min.js"></script>
      </head>
      <body>
        <nav class="nav">
          <div class="nav-inner">
            <a href="/dashboard" class="nav-brand">SmartScraper</a>
            <a href="/dashboard/sites" class={`nav-link ${activePath === '/dashboard/sites' ? 'active' : ''}`}>Sites</a>
            <a href="/dashboard/stats" class={`nav-link ${activePath === '/dashboard/stats' ? 'active' : ''}`}>Stats</a>
            <span class="nav-version">v{VERSION}</span>
          </div>
        </nav>
        <main class="container">
          {children}
        </main>
      </body>
    </html>
  );
};

export const LoginLayout: FC<PropsWithChildren<{ title?: string }>> = ({ children, title = 'Login - SmartScraper' }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <style>{css}</style>
      </head>
      <body>
        <div class="login-container">
          {children}
        </div>
      </body>
    </html>
  );
};
