import {
    getLiveSmokeGuardErrors,
    LIVE_SMOKE_CONFIRM_VALUE,
    summarizeLiveSmokeChecks,
} from '../utils/liveSmokePreflight';

describe('live smoke preflight helpers', () => {
    test('requires live mode before preflight can run', () => {
        const errors = getLiveSmokeGuardErrors({
            previewMode: true,
            confirmation: LIVE_SMOKE_CONFIRM_VALUE,
        });

        expect(errors).toContain(
            'PREVIEW_MODE must be false before running the live smoke preflight.'
        );
    });

    test('requires explicit confirmation even when live mode is enabled', () => {
        const errors = getLiveSmokeGuardErrors({
            previewMode: false,
            confirmation: '',
        });

        expect(errors).toContain(
            `Set LIVE_SMOKE_CONFIRM=${LIVE_SMOKE_CONFIRM_VALUE} after backing up data, then rerun the preflight.`
        );
    });

    test('summarizes pass warn fail counts correctly', () => {
        const summary = summarizeLiveSmokeChecks([
            { name: 'database', status: 'pass', message: 'ok' },
            { name: 'balance', status: 'warn', message: 'low' },
            { name: 'auth', status: 'fail', message: 'bad creds' },
        ]);

        expect(summary).toEqual({
            passCount: 1,
            warnCount: 1,
            failCount: 1,
            ready: false,
        });
    });
});
