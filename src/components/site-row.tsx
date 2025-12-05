import type { FC } from 'hono/jsx';
import type { SiteConfig } from '../domain/models.js';

interface SiteRowProps {
  site: SiteConfig;
}

export const SiteRow: FC<SiteRowProps> = ({ site }) => {
  const lastSuccess = site.lastSuccessfulScrapeTimestamp
    ? new Date(site.lastSuccessfulScrapeTimestamp).toLocaleDateString()
    : '-';

  const failureBadge = site.failureCountSinceLastSuccess > 0
    ? site.failureCountSinceLastSuccess >= 2
      ? <span class="badge badge-error">{site.failureCountSinceLastSuccess}</span>
      : <span class="badge badge-warning">{site.failureCountSinceLastSuccess}</span>
    : <span class="badge badge-success">0</span>;

  return (
    <tr>
      <td>
        <a href={`/dashboard/sites/${encodeURIComponent(site.domainPattern)}`} class="code">
          {site.domainPattern}
        </a>
      </td>
      <td class="truncate code text-sm text-muted">{site.xpathMainContent}</td>
      <td class="text-sm">{lastSuccess}</td>
      <td>{failureBadge}</td>
      <td>
        <div class="btn-group">
          <a href={`/dashboard/sites/${encodeURIComponent(site.domainPattern)}`} class="btn btn-secondary btn-sm">Edit</a>
          <button
            class="btn btn-danger btn-sm"
            hx-delete={`/dashboard/sites/${encodeURIComponent(site.domainPattern)}`}
            hx-confirm={`Delete configuration for ${site.domainPattern}? This cannot be undone.`}
            hx-target="closest tr"
            hx-swap="outerHTML"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};
