# Changelog

All notable changes to the SmartScraper project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- DOM structure extraction function that preserves tags and attributes while minimizing text content
- Text size annotations in the extracted DOM structure to help LLM identify content areas
- Comprehensive list of common content-related class/ID names from site_storage.json
- Enhanced scoring function with bonuses for content-specific classes and penalties for shallow hierarchy
- CHANGELOG.md file to track changes
- Support for more content-specific classes including "article-dropcap" and "paywall-content"
- Bonus for content-related IDs in scoring function
- HTTP proxy support for web scraping to bypass restrictions
- DataDome CAPTCHA detection and handling for sites with anti-bot protection
- Detailed documentation on how to use 2Captcha for solving DataDome CAPTCHA challenges
- Test script for detecting DataDome CAPTCHA challenges on the New York Times website
- Documentation of the optimal flow: try curl first, if CAPTCHA detected, skip puppeteer-stealth and go directly to puppeteer-captcha
- Added detection of banned IPs in DataDome CAPTCHA (t=bv parameter) and documentation on how to handle them
- Improved cookie handling for DataDome CAPTCHA to correctly set cookies in Puppeteer
- Successfully implemented and tested DataDome CAPTCHA solving with 2Captcha
- Verified successful access to New York Times article content after CAPTCHA bypass
- Integrated DataDome CAPTCHA handling into the main codebase
- Added comprehensive configuration for CAPTCHA solving in config/captcha-solver-config.js
- Implemented optimal flow in CoreScraperEngine for efficient CAPTCHA handling

### Fixed
- XPath evaluation now uses `document.evaluate` instead of `xpath.select` for better compatibility
- Fixed issue with LLM model configuration by ensuring environment variables are properly loaded
- Improved error handling and debugging for LLM responses
- Set LLM temperature to 0 for deterministic XPath generation

### Changed
- Reduced HTML size by ~97% by extracting only the DOM structure, making it more efficient for LLM processing
- Updated prompt to include common patterns from site_storage.json
- Improved scoring to better differentiate between container elements and actual content elements
- Made XPath generation more consistent by using temperature=0
- Updated Puppeteer configuration to use HTTP proxy for web scraping
- Enhanced CaptchaSolver class to handle DataDome CAPTCHA with 2Captcha
- Updated HtmlAnalyserFixed to detect DataDome CAPTCHA and check for banned IPs
- Modified CoreScraperEngine to follow optimal flow for CAPTCHA handling
- Improved configuration structure for better organization and flexibility

## [1.0.0] - 2025-05-15

### Added
- Initial release of SmartScraper
- Support for extracting article content from news websites
- LLM-based content identification
- XPath generation for content extraction
- Support for various news sites listed in site_storage.json
