// tests/storage/known-sites-manager.test.ts
import fs from 'fs/promises';
import path from 'path';
import { KnownSitesManager, SiteConfig } from '../../src/storage/known-sites-manager';
import { MethodValue, METHODS } from '../../src/constants';

// Mock fs/promises
jest.mock('fs/promises');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock logger to prevent console output during tests
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugging: jest.fn().mockReturnValue(false), // Mock isDebugging
  }
}));

describe('KnownSitesManager', () => {
  const testStoragePath = path.resolve(__dirname, 'test_storage.json');
  let manager: KnownSitesManager;

  beforeEach(() => {
    // Reset mocks before each test
    mockedFs.readFile.mockReset();
    mockedFs.writeFile.mockReset();
    mockedFs.access.mockReset();
    mockedFs.mkdir.mockResolvedValue(undefined as any); // Assume mkdir always succeeds for tests
    manager = new KnownSitesManager(testStoragePath);
  });

  afterEach(async () => {
    // Optional: cleanup test file if created, though mocks prevent actual file creation
    // try { await fs.unlink(testStoragePath); } catch (e) {}
  });

  it('should initialize with an empty storage if file does not exist', async () => {
    mockedFs.access.mockRejectedValue(new Error('File not found')); // Simulate file not existing
    mockedFs.writeFile.mockResolvedValue(undefined); // Mock successful write of empty storage
    
    // @ts-ignore Accessing private method for test purposes
    await manager._ensureInitialized(); // Trigger initialization
    expect(mockedFs.writeFile).toHaveBeenCalledWith(testStoragePath, JSON.stringify({}, null, 2), 'utf-8');
    const config = await manager.getConfig('nonexistent.com');
    expect(config).toBeNull();
  });

  it('should load existing data from storage file', async () => {
    const mockData: Record<string, SiteConfig> = {
      'example.com': { domain_pattern: 'example.com', method: METHODS.CURL as MethodValue, xpath_main_content: '//div', last_successful_scrape_timestamp: null, failure_count_since_last_success: 0, site_specific_headers: null, user_agent_to_use: null, needs_captcha_solver: false, puppeteer_wait_conditions: null, discovered_by_llm: false },
    };
    mockedFs.access.mockResolvedValue(undefined); // Simulate file existing by not rejecting
    mockedFs.readFile.mockResolvedValue(JSON.stringify(mockData));
    
    // @ts-ignore
    await manager._ensureInitialized();
    const config = await manager.getConfig('example.com');
    expect(config).toEqual(mockData['example.com']);
  });

  it('should handle JSON parsing errors gracefully during load', async () => {
    mockedFs.access.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue('invalid json'); // Simulate corrupted file
    
    // @ts-ignore
    await manager._ensureInitialized(); // Should not throw, should default to empty
    const allConfigs = await manager.getAllConfigs();
    expect(allConfigs).toEqual({});
    // Check logger.error was called
    // const { logger } = await import('../../src/utils/logger.js');
    // expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize or load known sites storage'), expect.any(String));
  });

  it('should save and retrieve a config', async () => {
    mockedFs.access.mockRejectedValue(new Error('File not found')); // Start fresh
    mockedFs.writeFile.mockResolvedValue(undefined);

    const newConfig: Omit<SiteConfig, 'domain_pattern'> = { method: METHODS.PUPPETEER_STEALTH as MethodValue, xpath_main_content: '//article', last_successful_scrape_timestamp: null, failure_count_since_last_success: 0, site_specific_headers: null, user_agent_to_use: null, needs_captcha_solver: false, puppeteer_wait_conditions: null, discovered_by_llm: true };
    await manager.saveConfig('test.com', newConfig);
    
    // @ts-ignore
    await manager._ensureInitialized(); // Ensure init promise is resolved if saveConfig triggers it

    expect(mockedFs.writeFile).toHaveBeenCalledTimes(2); // Once for init (empty), once for save
    const lastWriteCallArg = mockedFs.writeFile.mock.calls[mockedFs.writeFile.mock.calls.length - 1][1] as string;
    expect(JSON.parse(lastWriteCallArg)).toEqual({
      'test.com': { ...newConfig, domain_pattern: 'test.com' },
    });

    // Simulate re-reading for getConfig (though it uses in-memory cache)
    // @ts-ignore
    manager.storageData = JSON.parse(lastWriteCallArg); // Update in-memory for this test
    const retrievedConfig = await manager.getConfig('test.com');
    expect(retrievedConfig).toEqual({ ...newConfig, domain_pattern: 'test.com' });
  });

  it('should increment failure count', async () => {
    const initialConfig: SiteConfig = { domain_pattern: 'fail.com', method: METHODS.CURL as MethodValue, xpath_main_content: '//div', last_successful_scrape_timestamp: 'old_timestamp', failure_count_since_last_success: 0, site_specific_headers: null, user_agent_to_use: null, needs_captcha_solver: false, puppeteer_wait_conditions: null, discovered_by_llm: false };
    mockedFs.access.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(JSON.stringify({ 'fail.com': initialConfig }));
    mockedFs.writeFile.mockResolvedValue(undefined);

    // @ts-ignore
    await manager._ensureInitialized();
    await manager.incrementFailure('fail.com');
    const updatedConfig = await manager.getConfig('fail.com'); // Reads from in-memory
    expect(updatedConfig!.failure_count_since_last_success).toBe(1);
    
    await manager.incrementFailure('fail.com');
    const furtherUpdatedConfig = await manager.getConfig('fail.com');
    expect(furtherUpdatedConfig!.failure_count_since_last_success).toBe(2);
    expect(mockedFs.writeFile).toHaveBeenCalledTimes(2); // readFile once, writeFile twice (after each increment)
  });

  it('should update success metrics', async () => {
    const initialConfig: SiteConfig = { domain_pattern: 'success.com', method: METHODS.CURL as MethodValue, xpath_main_content: '//div', last_successful_scrape_timestamp: 'old_timestamp', failure_count_since_last_success: 5, site_specific_headers: null, user_agent_to_use: null, needs_captcha_solver: false, puppeteer_wait_conditions: null, discovered_by_llm: false };
    mockedFs.access.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(JSON.stringify({ 'success.com': initialConfig }));
    mockedFs.writeFile.mockResolvedValue(undefined);

    // @ts-ignore
    await manager._ensureInitialized();
    await manager.updateSuccess('success.com');
    const updatedConfig = await manager.getConfig('success.com');
    expect(updatedConfig!.failure_count_since_last_success).toBe(0);
    expect(updatedConfig!.last_successful_scrape_timestamp).not.toBe('old_timestamp');
    expect(new Date(updatedConfig!.last_successful_scrape_timestamp!).getTime()).toBeGreaterThan(0);
  });

  it('should delete a config', async () => {
    const initialData: Record<string, SiteConfig> = {
      'todelete.com': { domain_pattern: 'todelete.com', method: METHODS.CURL as MethodValue, xpath_main_content: '//del', last_successful_scrape_timestamp: null, failure_count_since_last_success: 0, site_specific_headers: null, user_agent_to_use: null, needs_captcha_solver: false, puppeteer_wait_conditions: null, discovered_by_llm: false },
      'example.com': { domain_pattern: 'example.com', method: METHODS.CURL as MethodValue, xpath_main_content: '//div', last_successful_scrape_timestamp: null, failure_count_since_last_success: 0, site_specific_headers: null, user_agent_to_use: null, needs_captcha_solver: false, puppeteer_wait_conditions: null, discovered_by_llm: false },
    };
    mockedFs.access.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(JSON.stringify(initialData));
    mockedFs.writeFile.mockResolvedValue(undefined);

    // @ts-ignore
    await manager._ensureInitialized();
    const result = await manager.deleteConfig('todelete.com');
    expect(result).toBe(true);
    const config = await manager.getConfig('todelete.com');
    expect(config).toBeNull();

    const remainingConfig = await manager.getConfig('example.com');
    expect(remainingConfig).not.toBeNull();

    const lastWriteCallArg = mockedFs.writeFile.mock.calls[mockedFs.writeFile.mock.calls.length - 1][1] as string;
    expect(JSON.parse(lastWriteCallArg)).toEqual({ 'example.com': initialData['example.com'] });
  });
});
