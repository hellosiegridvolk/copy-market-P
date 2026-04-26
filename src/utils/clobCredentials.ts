import { ApiKeyCreds } from '@polymarket/clob-client';

interface ApiKeyClient {
    deriveApiKey: (nonce?: number) => Promise<ApiKeyCreds>;
    createApiKey: (nonce?: number) => Promise<ApiKeyCreds>;
}

const isCompleteApiKeyCreds = (creds?: Partial<ApiKeyCreds> | null): creds is ApiKeyCreds =>
    Boolean(creds?.key && creds.secret && creds.passphrase);

export const resolveApiKeyCreds = async (client: ApiKeyClient): Promise<ApiKeyCreds> => {
    try {
        const derived = await client.deriveApiKey();
        if (isCompleteApiKeyCreds(derived)) {
            return derived;
        }
    } catch {
        // Fall back to creating a key when no existing credentials can be derived.
    }

    const created = await client.createApiKey();
    if (isCompleteApiKeyCreds(created)) {
        return created;
    }

    throw new Error('Unable to derive or create Polymarket API credentials.');
};
