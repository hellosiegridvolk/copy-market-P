import { resolveApiKeyCreds } from '../utils/clobCredentials';

describe('resolveApiKeyCreds', () => {
    test('prefers derived credentials when available', async () => {
        const deriveApiKey = jest.fn().mockResolvedValue({
            key: 'derived-key',
            secret: 'secret',
            passphrase: 'passphrase',
        });
        const createApiKey = jest.fn();

        const creds = await resolveApiKeyCreds({
            deriveApiKey,
            createApiKey,
        });

        expect(creds.key).toBe('derived-key');
        expect(createApiKey).not.toHaveBeenCalled();
    });

    test('falls back to creating credentials when derive fails', async () => {
        const deriveApiKey = jest.fn().mockRejectedValue(new Error('no existing key'));
        const createApiKey = jest.fn().mockResolvedValue({
            key: 'created-key',
            secret: 'secret',
            passphrase: 'passphrase',
        });

        const creds = await resolveApiKeyCreds({
            deriveApiKey,
            createApiKey,
        });

        expect(creds.key).toBe('created-key');
        expect(createApiKey).toHaveBeenCalledTimes(1);
    });

    test('throws when neither derive nor create returns a complete key', async () => {
        const deriveApiKey = jest.fn().mockResolvedValue({
            key: '',
            secret: '',
            passphrase: '',
        });
        const createApiKey = jest.fn().mockResolvedValue({
            key: '',
            secret: '',
            passphrase: '',
        });

        await expect(
            resolveApiKeyCreds({
                deriveApiKey,
                createApiKey,
            })
        ).rejects.toThrow('Unable to derive or create Polymarket API credentials.');
    });
});
