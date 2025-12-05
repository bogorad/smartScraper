import type { FC } from 'hono/jsx';

interface TestFormProps {
  domain: string;
}

export const TestForm: FC<TestFormProps> = ({ domain }) => {
  return (
    <div class="card">
      <div class="card-header">Test Scrape</div>
      <form
        hx-post={`/dashboard/sites/${encodeURIComponent(domain)}/test`}
        hx-target="#test-result"
        hx-indicator="#test-spinner"
      >
        <div class="form-group">
          <label for="testUrl">Test URL</label>
          <input
            type="url"
            id="testUrl"
            name="testUrl"
            placeholder={`https://${domain}/article/...`}
            required
          />
        </div>
        <div class="btn-group">
          <button type="submit" class="btn btn-primary">
            Run Test
            <span id="test-spinner" class="spinner htmx-indicator"></span>
          </button>
        </div>
      </form>
      <div id="test-result" class="mt-4"></div>
    </div>
  );
};

interface TestResultProps {
  success: boolean;
  message: string;
  details?: string;
}

export const TestResult: FC<TestResultProps> = ({ success, message, details }) => {
  return (
    <div class={`alert ${success ? 'alert-success' : 'alert-error'}`}>
      <strong>{success ? 'Success' : 'Failed'}</strong>: {message}
      {details && <div class="text-sm mt-2">{details}</div>}
    </div>
  );
};
