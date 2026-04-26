import type { FC } from 'hono/jsx';
import type { SiteConfig } from '../domain/models.js';

interface SiteFormProps {
  site: SiteConfig;
  isNew?: boolean;
}

export const SiteForm: FC<SiteFormProps> = ({ site, isNew }) => {
  const headersText = site.siteSpecificHeaders
    ? Object.entries(site.siteSpecificHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '';

  const cleanupText = site.siteCleanupClasses?.join('\n') || '';

  return (
    <form
      hx-post={
        isNew
          ? "/dashboard/sites/new"
          : `/dashboard/sites/${encodeURIComponent(site.domainPattern)}`
      }
      hx-swap="outerHTML"
      class="card"
    >
      <div class="card-header">
        {isNew ? 'New Site Configuration' : `Edit: ${site.domainPattern}`}
      </div>

      {isNew && (
        <div class="form-group">
          <label for="domainPattern">Domain</label>
          <input
            type="text"
            id="domainPattern"
            name="domainPattern"
            value={site.domainPattern}
            placeholder="example.com"
            required
          />
          <div class="form-hint">Enter the root domain without www; it also applies to subdomains. Wildcards are not supported.</div>
        </div>
      )}

      <div class="form-group">
        <label for="xpathMainContent">XPath Main Content</label>
        <textarea
          id="xpathMainContent"
          name="xpathMainContent"
          placeholder="//article[@class='post-content']"
          required
        >{site.xpathMainContent}</textarea>
        <div class="form-hint">XPath selector for the main article content</div>
      </div>

      <div class="form-group">
        <label for="siteCleanupClasses">Cleanup Classes (one per line)</label>
        <textarea
          id="siteCleanupClasses"
          name="siteCleanupClasses"
          placeholder="ad-wrapper&#10;social-share&#10;related-posts"
        >{cleanupText}</textarea>
        <div class="form-hint">CSS classes to remove from extracted content</div>
      </div>

      <div class="form-group">
        <label for="siteSpecificHeaders">Custom Headers (one per line, format: Name: Value)</label>
        <textarea
          id="siteSpecificHeaders"
          name="siteSpecificHeaders"
          placeholder="X-Custom-Header: value&#10;Accept-Language: en-US"
        >{headersText}</textarea>
      </div>

      <div class="form-group">
        <label for="userAgent">User-Agent (optional override)</label>
        <input
          type="text"
          id="userAgent"
          name="userAgent"
          value={site.userAgent || ''}
          placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
        />
        <div class="form-hint">Leave empty to use default Windows Chrome UA</div>
      </div>

      <div class="form-group">
        <label for="method">Method Strategy</label>
        <select id="method" name="method">
          <option value="" selected={!site.method}>
            Not recorded
          </option>
          <option
            value="curl"
            selected={site.method === 'curl'}
          >
            curl
          </option>
          <option
            value="chrome"
            selected={site.method === 'chrome'}
          >
            chrome
          </option>
        </select>
        <div class="form-hint">
          Recorded fetch method for this site
        </div>
      </div>

      <div class="form-group">
        <label for="captcha">CAPTCHA Strategy</label>
        <select id="captcha" name="captcha">
          <option value="" selected={!site.captcha}>
            Not recorded
          </option>
          <option
            value="none"
            selected={site.captcha === 'none'}
          >
            none
          </option>
          <option
            value="datadome"
            selected={site.captcha === 'datadome'}
          >
            DataDome
          </option>
          <option
            value="recaptcha"
            selected={site.captcha === 'recaptcha'}
          >
            reCAPTCHA unsupported
          </option>
          <option
            value="turnstile"
            selected={site.captcha === 'turnstile'}
          >
            Turnstile unsupported
          </option>
          <option
            value="hcaptcha"
            selected={site.captcha === 'hcaptcha'}
          >
            hCaptcha unsupported
          </option>
          <option
            value="unsupported"
            selected={site.captcha === 'unsupported'}
          >
            Unsupported challenge
          </option>
        </select>
        <div class="form-hint">
          Recorded challenge type; only DataDome has solver support
        </div>
      </div>

      <div class="form-group">
        <label for="proxy">Proxy Strategy</label>
        <select id="proxy" name="proxy">
          <option
            value=""
            selected={!site.proxy && !site.needsProxy}
          >
            Not recorded
          </option>
          <option
            value="none"
            selected={site.proxy === 'none'}
          >
            none
          </option>
          <option
            value="default"
            selected={site.proxy === 'default'}
          >
            default
          </option>
          <option
            value="datadome"
            selected={
              site.proxy === 'datadome' ||
              site.needsProxy === 'datadome'
            }
          >
            DataDome
          </option>
        </select>
        <div class="form-hint">
          Recorded proxy path for page loads and DataDome tasks
        </div>
      </div>

      <div class="btn-group">
        <button type="submit" class="btn btn-primary">
          {isNew ? 'Create' : 'Save Changes'}
        </button>
        <a href="/dashboard/sites" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  );
};
