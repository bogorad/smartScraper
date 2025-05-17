# Changelog

All notable changes to the SmartScraper project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- DOM structure extraction function that preserves tags and attributes while minimizing text content
- Text size annotations in the extracted DOM structure to help LLM identify content areas
- Comprehensive list of common content-related class/ID names
- Enhanced scoring function with bonuses for content-specific classes and penalties for shallow hierarchy
- CHANGELOG.md file to track changes
- Support for more content-specific classes including "article-dropcap" and "paywall-content"
- Bonus for content-related IDs in scoring function
- HTTP proxy support for web scraping to bypass restrictions
- DataDome CAPTCHA detection and handling for sites with anti-bot protection
- Detailed documentation on how to use 2Captcha for solving DataDome CAPTCHA challenges
- Documentation of the optimal flow: try curl first, if CAPTCHA detected, skip puppeteer-stealth and go directly to puppeteer-captcha
- Added detection of banned IPs in DataDome CAPTCHA (t=bv parameter) and documentation on how to handle them
- Improved cookie handling for DataDome CAPTCHA to correctly set cookies in Puppeteer
- Successfully implemented and tested DataDome CAPTCHA solving with 2Captcha
- Verified successful access to New York Times article content after CAPTCHA bypass
- Integrated DataDome CAPTCHA handling into the main codebase
- Added comprehensive configuration for CAPTCHA solving in config/captcha-solver-config.js
- Implemented optimal flow in CoreScraperEngine for efficient CAPTCHA handling
- Added automatic proxy usage for curl requests from HTTP_PROXY environment variable
- Enhanced DataDome CAPTCHA detection with additional markers
- Improved cookie formatting for DataDome CAPTCHA to avoid leading dots in domain names
- Added banned IP detection in CoreScraperEngine for DataDome CAPTCHA

### Fixed
- XPath evaluation now uses `document.evaluate` instead of `xpath.select` for better compatibility
- Fixed issue with LLM model configuration by ensuring environment variables are properly loaded
- Improved error handling and debugging for LLM responses
- Set LLM temperature to 0 for deterministic XPath generation

### Changed
- Reduced HTML size by ~97% by extracting only the DOM structure, making it more efficient for LLM processing
- Updated prompt to include common content patterns
- Improved scoring to better differentiate between container elements and actual content elements
- Made XPath generation more consistent by using temperature=0
- Updated Puppeteer configuration to use HTTP proxy for web scraping
- Enhanced CaptchaSolver class to handle DataDome CAPTCHA with 2Captcha
- Updated HtmlAnalyserFixed to detect DataDome CAPTCHA and check for banned IPs
- Modified CoreScraperEngine to follow optimal flow for CAPTCHA handling
- Improved configuration structure for better organization and flexibility
- Updated Chromium path configuration to use EXECUTABLE_PATH environment variable
- Enhanced curl-handler to automatically use HTTP_PROXY environment variable
- Improved DataDome CAPTCHA detection with additional text markers
- Removed XPath expiration logic as it's no longer needed
- Lowered DOM similarity threshold from 90% to 60% for more realistic DOM comparison between curl and Puppeteer results

## [1.0.0] - 2025-05-15

### Added
- Initial release of SmartScraper
- Support for extracting article content from news websites
- LLM-based content identification
- XPath generation for content extraction
- Support for various news sites
