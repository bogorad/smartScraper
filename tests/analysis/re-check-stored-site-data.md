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

- Node.js 14.x or higher
- SmartScraper codebase with all dependencies installed
- Chromium browser installed (default path: `/usr/lib/chromium/chromium`)
- Optional: Environment variables for configuration:
  - `EXECUTABLE_PATH`: Path to Chromium executable
  - `CAPTCHA_API_KEY`: API key for CAPTCHA solving service
  - `CAPTCHA_SERVICE_NAME`: CAPTCHA service name (default: '2captcha')

### Running the Tool

```bash
node tests/analysis/re-check-stored-site-data.js
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

## Implementation Details

### Core Components

1. **Known Sites Storage Reader**: Reads the stored site configurations
2. **XPath Discovery**: Uses the CoreScraperEngine to discover XPaths
3. **Comparison Logic**: Compares discovered XPaths with stored ones
4. **Statistics Collector**: Tracks success rates, match rates, and error rates
5. **Report Generator**: Creates a comprehensive report with the results

### Technical Approach

The tool uses the following approach:

1. Load all domains and their configurations from `data/known_sites_storage.json`
2. For each domain:
   - Fetch the front page of the site using `fetchWithCurl` from the main codebase
   - Check for CAPTCHAs using `HtmlAnalyserFixed.detectCaptchaMarkers` from the main codebase
   - First check if the site has RSS feeds, and if so, extract the first article URL (most recent)
   - If no RSS feeds are found, fall back to extracting the 18th link from the page
   - Attempt to discover the XPath using the CoreScraperEngine with:
     - DOM similarity threshold set to 60% (instead of the default 90%)
     - Custom logic to ensure XPath discovery is always performed regardless of DOM similarity
     - Chromium browser at the specified path
     - HTTP proxy for bypassing restrictions
     - CAPTCHA solving capabilities if needed
   - Compare the discovered XPath with the stored one
   - Record the results
   - Add a delay between requests to avoid rate limiting
3. Generate a comprehensive report with statistics and detailed results

### Error Handling

The tool includes robust error handling to ensure that:

- Errors with individual domains don't stop the entire process
- All errors are properly logged and included in the report
- The original known sites storage is not modified

## Customization

### Article URL Extraction

The tool only processes sites that provide RSS feeds. It checks for RSS feeds on the site's front page, fetches the feed, and extracts the first article URL, which is typically the most recent article. Sites without RSS feeds are skipped.

```javascript
// Check for RSS feeds
const rssLinks = findRssLinks(html, baseUrl);
if (rssLinks.length > 0) {
    // Fetch the RSS feed and extract the first article URL
    const rssResponse = await fetchWithCurl(rssLinks[0]);
    const articleUrl = extractFirstArticleFromRss(rssResponse.html, baseUrl);
    if (articleUrl && isValidUrl(articleUrl)) {
        return articleUrl; // Use the most recent article from RSS
    } else {
        return null; // No valid article URL found
    }
} else {
    return null; // No RSS feeds found, skip this site
}
```

### Site Skipping

Sites without RSS feeds or where RSS feed extraction fails are skipped:

```javascript
// Skip this site if no RSS feed or article URL found
if (testUrl === null) {
    logger.info(`Skipping domain ${domain} - no RSS feed found`);
    continue; // Skip to the next domain
}
```

### Report Format

You can customize the report format by modifying the `appendToReport` and `appendSummary` functions in the script.

## Troubleshooting

### Common Issues

1. **Missing Dependencies**: Ensure all dependencies are installed
2. **File Permissions**: Ensure the script has permission to read the known sites storage and write the report
3. **Memory Issues**: For large known sites storage files, increase the Node.js memory limit

### Error Messages

- **"Failed to read known sites storage"**: Check that the file exists and is readable
- **"Internal _discoverAndScrape method not available"**: The script will fall back to using the public API
- **"Failed to append to report"**: Check file permissions and disk space
- **"Failed to extract article URL from front page"**: The site will be skipped
- **"No RSS feeds found"**: The site will be skipped
- **"Could not extract valid article URL from RSS feed"**: The site will be skipped
- **"Discovery timed out after X ms"**: The discovery process took too long and was aborted
- **"HTTP Error XXX for URL"**: The request to the site failed with the specified HTTP status code

## Best Practices

1. **Run Regularly**: Run this tool regularly to identify sites that need updated XPaths
2. **Review Mismatches**: Manually review mismatched XPaths to determine which one is better
3. **Update Storage**: After validation, update the known sites storage with improved XPaths
4. **Track Trends**: Monitor the success rates over time to identify trends

## Contributing

Contributions to improve the tool are welcome. Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This tool is part of the SmartScraper project and is subject to the same license terms.
