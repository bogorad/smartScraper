// tests/storage/known-sites-manager.test.js
import { KnownSitesManager } from '../../src/storage/known-sites-manager';
import fs from 'fs/promises';
import path from 'path';

// Mock fs/promises
jest.mock('fs/promises');

// Mock logger to prevent console output during tests
jest.mock('../../src/utils/logger.js', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));


describe('KnownSitesManager', () => {
    const testStoragePath = path.resolve(__dirname, 'test_storage.json');
    let manager;

    beforeEach(() => {
        // Reset mocks before each test
        fs.readFile.mockReset();
        fs.writeFile.mockReset();
        fs.access.mockReset();
        fs.mkdir.mockResolvedValue(undefined); // Assume mkdir always succeeds for tests
        manager = new KnownSitesManager(testStoragePath);
    });

    afterEach(async () => {
        // Optional: cleanup test file if created, though mocks prevent actual file creation
        // try { await fs.unlink(testStoragePath); } catch (e) {}
    });

    it('should initialize with an empty storage if file does not exist', async () => {
        fs.access.mockRejectedValue(new Error('File not found')); // Simulate file not existing
        fs.writeFile.mockResolvedValue(undefined); // Mock successful write of empty storage

        await manager._ensureInitialized(); // Trigger initialization
        expect(fs.writeFile).toHaveBeenCalledWith(testStoragePath, JSON.stringify({}, null, 2), 'utf-8');
        const config = await manager.getConfig('nonexistent.com');
        expect(config).toBeNull();
    });

    it('should load existing data from storage file', async () => {
        const mockData = { 'example.com': { method: 'curl', xpath_main_content: '//article' } };
        fs.access.mockResolvedValue(true); // Simulate file existing
        fs.readFile.mockResolvedValue(JSON.stringify(mockData));

        await manager._ensureInitialized();
        const config = await manager.getConfig('example.com');
        expect(config).toEqual(mockData['example.com']);
    });

    it('should handle JSON parsing errors gracefully during load', async () => {
        fs.access.mockResolvedValue(true);
        fs.readFile.mockResolvedValue('invalid json'); // Simulate corrupted file

        await manager._ensureInitialized(); // Should not throw, should default to empty
        const allConfigs = await manager.getAllConfigs();
        expect(allConfigs).toEqual({});
    });

    it('should save and retrieve a config', async () => {
        fs.access.mockRejectedValue(new Error('File not found')); // Start fresh
        fs.writeFile.mockResolvedValue(undefined);
        await manager._ensureInitialized();

        const newConfig = { method: 'puppeteer_stealth', xpath_main_content: '//main' };
        await manager.saveConfig('test.com', newConfig);

        expect(fs.writeFile).toHaveBeenCalledTimes(2); // Once for init, once for save
        // Check the content of the last writeFile call
        const lastWriteCallArg = fs.writeFile.mock.calls[fs.writeFile.mock.calls.length - 1][1];
        expect(JSON.parse(lastWriteCallArg)).toEqual({
            'test.com': { ...newConfig, domain_pattern: 'test.com' }
        });

        // Simulate re-reading for getConfig (though it uses in-memory cache)
        manager.storageData = JSON.parse(lastWriteCallArg); // Update in-memory for this test
        const retrievedConfig = await manager.getConfig('test.com');
        expect(retrievedConfig).toEqual({ ...newConfig, domain_pattern: 'test.com' });
    });

    it('should increment failure count', async () => {
        const initialConfig = { domain_pattern: 'fail.com', failure_count_since_last_success: 0 };
        fs.access.mockResolvedValue(true);
        fs.readFile.mockResolvedValue(JSON.stringify({ 'fail.com': initialConfig }));
        fs.writeFile.mockResolvedValue(undefined);
        await manager._ensureInitialized();

        await manager.incrementFailure('fail.com');
        const updatedConfig = await manager.getConfig('fail.com'); // Reads from in-memory
        expect(updatedConfig.failure_count_since_last_success).toBe(1);

        await manager.incrementFailure('fail.com');
        const furtherUpdatedConfig = await manager.getConfig('fail.com');
        expect(furtherUpdatedConfig.failure_count_since_last_success).toBe(2);
        expect(fs.writeFile).toHaveBeenCalledTimes(2); // readFile once, writeFile twice
    });

    it('should update success metrics', async () => {
        const initialConfig = { domain_pattern: 'success.com', failure_count_since_last_success: 5, last_successful_scrape_timestamp: 'old_timestamp' };
        fs.access.mockResolvedValue(true);
        fs.readFile.mockResolvedValue(JSON.stringify({ 'success.com': initialConfig }));
        fs.writeFile.mockResolvedValue(undefined);
        await manager._ensureInitialized();

        await manager.updateSuccess('success.com');
        const updatedConfig = await manager.getConfig('success.com');
        expect(updatedConfig.failure_count_since_last_success).toBe(0);
        expect(updatedConfig.last_successful_scrape_timestamp).not.toBe('old_timestamp');
        expect(new Date(updatedConfig.last_successful_scrape_timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should delete a config', async () => {
        const mockData = { 'example.com': { method: 'curl' }, 'todelete.com': { method: 'puppeteer_stealth' } };
        fs.access.mockResolvedValue(true);
        fs.readFile.mockResolvedValue(JSON.stringify(mockData));
        fs.writeFile.mockResolvedValue(undefined);
        await manager._ensureInitialized();

        const result = await manager.deleteConfig('todelete.com');
        expect(result).toBe(true);
        const config = await manager.getConfig('todelete.com');
        expect(config).toBeNull();
        const remainingConfig = await manager.getConfig('example.com');
        expect(remainingConfig).not.toBeNull();

        const lastWriteCallArg = fs.writeFile.mock.calls[fs.writeFile.mock.calls.length - 1][1];
        expect(JSON.parse(lastWriteCallArg)).toEqual({ 'example.com': { method: 'curl' } });
    });
});
