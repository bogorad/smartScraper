# Site Data Re-Check Tool

## Overview

The Site Data Re-Check Tool is a testing utility that validates the stored XPath expressions in the SmartScraper's known sites storage. It treats each site as if it were unknown, attempts to discover the XPath for the main content, and compares the newly discovered XPath with the stored one.

This tool helps identify sites that may need updated XPaths, assess the overall health of the scraping system, and provide insights into which scraping methods are most reliable.

## Features

- **Comprehensive Testing**: Tests all domains in the known sites storage
- **XPath Validation**: Compares stored XPaths with newly discovered ones
- **Method Analysis**: Evaluates the success rate of different scraping methods
- **Detailed Reporting**: Generates a comprehensive report with statistics and recommendations
- **Non-Destructive**: Does not modify the original known sites storage

## Usage

### Prerequisites

- Node.js 18.x or higher (due to ESNext features)
- SmartScraper codebase with all dependencies installed (`npm install` or `yarn install`)
- TypeScript compiler (`npm install -g typescript` or `yarn global add typescript`)
- Project built (`npm run build` or `yarn build`)
- Chromium browser installed (default path: `/usr/lib/chromium/chromium`)
- Optional: Environment variables for configuration:
  - `EXECUTABLE_PATH`: Path to Chromium executable
  - `TWOCAPTCHA_API_KEY`: API key for 2Captcha solving service (if `CAPTCHA_API_KEY` is not used)
  - `CAPTCHA_SERVICE_NAME`: CAPTCHA service name (default: '2captcha')

### Running the Tool

After building the project:
```bash
node dist/tests/analysis/re-check-stored-site-data.js 
```
Or, using `ts-node` for direct execution (ensure `ts-node` is installed: `npm install -D ts-node`):
```bash
npx ts-node tests/analysis/re-check-stored-site-data.ts
```

### Output

The tool generates a report file at `./sites-report.txt` with the following sections:

1. **Header**: Basic information about the report and when it was generated
2. **Summary**: Overall statistics and conclusions
3. **Results by Method**: Analysis of each scraping method's performance
4. **Detailed Results**: Individual results for each domain

## Report Format

### Summary Section

```markdown
## Summary

### Overall Results
- **Total Sites**: 50
- **Successful Checks**: 45 (90%)
- **Matching XPaths**: 40 (80%)
- **Mismatched XPaths**: 5 (10%)
- **Errors**: 5 (10%)

### Results by Method
#### puppeteer_stealth
- **Total**: 30
- **Success Rate**: 93%
- **Match Rate**: 83%
- **Mismatch Rate**: 10%
- **Error Rate**: 7%

#### curl
- **Total**: 20
- **Success Rate**: 85%
- **Match Rate**: 75%
- **Mismatch Rate**: 10%
- **Error Rate**: 15%

### Conclusion
Most stored XPaths are still valid. The system is working well.

Mismatched XPaths may indicate site structure changes or multiple valid XPaths for the same content.

The error rate is within acceptable limits.
```

### Detailed Results Section

```markdown
## Results

### ✅ Domain: example.com
- **Status**: Match
- **Stored Method**: `puppeteer_stealth`
- **Discovered Method**: `puppeteer_stealth`
- **Stored XPath**: `//div[@class='article-content']`
- **Discovered XPath**: `//div[@class='article-content']`

### ⚠️ Domain: news-site.com
- **Status**: Mismatch
- **Stored Method**: `curl`
- **Discovered Method**: `curl`
- **Stored XPath**: `//div[@id='content']`
- **Discovered XPath**: `//article[@class='main-content']`

**XPath Comparison**:
Stored and discovered XPaths differ. This may indicate that the site structure has changed or that multiple valid XPaths exist.

### ❌ Domain: problem-site.com
- **Status**: Error
- **Stored Method**: `puppeteer_stealth`
- **Discovered Method**: None
- **Stored XPath**: `//div[@class='content']`
- **Discovered XPath**: None

**Error Details**:
```
TimeoutError: Navigation timeout of 30000 ms exceeded
```
```

## Status Indicators

The report uses the following status indicators for quick visual assessment:

- ✅ **Match**: The discovered XPath matches the stored XPath
- ⚠️ **Mismatch**: The discovered XPath differs from the stored XPath
- ❌ **Error**: An error occurred during the discovery process
- ❓ **Unknown**: Status could not be determined

## Implementation Details (Conceptual for .ts version)

The TypeScript version would follow a similar logical flow but with strong typing.

### Core Components

1. **Known Sites Storage Reader**: Reads `SiteConfig[]` from `KnownSitesManager`.
2. **XPath Discovery**: Uses `CoreScraperEngine` to discover XPaths.
3. **Comparison Logic**: Compares discovered XPaths with stored ones.
4. **Statistics Collector**: Tracks success rates, match rates, and error rates.
5. **Report Generator**: Creates a comprehensive report.

### Technical Approach (Conceptual for .ts version)

1. Load all domains and their configurations from `data/known_sites_storage.json` via `KnownSitesManager`.
2. For each domain:
   - Fetch the front page of the site using `fetchWithCurl` from the main codebase.
   - Check for CAPTCHAs using `HtmlAnalyserFixed.detectCaptchaMarkers`.
   - Extract an article URL (e.g., first from RSS or a prominent link).
   - Attempt to discover the XPath using `CoreScraperEngine.scrape` (or a specialized discovery method if exposed) with appropriate options to force discovery.
   - Compare the discovered XPath with the stored one.
   - Record results.
   - Add delay.
3. Generate report.

### Error Handling

Robust error handling using custom error classes (`ScraperError`, `NetworkError`, etc.) from the main codebase.

## Customization (Conceptual for .ts version)

### Article URL Extraction

The logic for extracting a test URL from a site's front page (e.g., via RSS or link analysis) would be implemented in TypeScript.

### Site Skipping

Logic for skipping sites (e.g., if no suitable test URL can be found) would be part of the main loop.

### Report Format

Customizable by modifying report generation functions.

## Troubleshooting

Similar to the JS version, but TypeScript's static checking helps prevent many common issues.

## Best Practices

(Same as JS version)

## Contributing

(Same as JS version)

## License

(Same as JS version)
