export const LIVE_SMOKE_CONFIRM_VALUE = 'I_HAVE_BACKED_UP_DATA';

export type LiveSmokeCheckStatus = 'pass' | 'warn' | 'fail';

export interface LiveSmokeCheck {
    name: string;
    status: LiveSmokeCheckStatus;
    message: string;
}

export interface LiveSmokeSummary {
    passCount: number;
    warnCount: number;
    failCount: number;
    ready: boolean;
}

export const getLiveSmokeGuardErrors = ({
    previewMode,
    confirmation,
}: {
    previewMode: boolean;
    confirmation?: string | null;
}): string[] => {
    const errors: string[] = [];

    if (previewMode) {
        errors.push('PREVIEW_MODE must be false before running the live smoke preflight.');
    }

    if ((confirmation || '').trim() !== LIVE_SMOKE_CONFIRM_VALUE) {
        errors.push(
            `Set LIVE_SMOKE_CONFIRM=${LIVE_SMOKE_CONFIRM_VALUE} after backing up data, then rerun the preflight.`
        );
    }

    return errors;
};

export const summarizeLiveSmokeChecks = (checks: LiveSmokeCheck[]): LiveSmokeSummary => {
    const passCount = checks.filter((check) => check.status === 'pass').length;
    const warnCount = checks.filter((check) => check.status === 'warn').length;
    const failCount = checks.filter((check) => check.status === 'fail').length;

    return {
        passCount,
        warnCount,
        failCount,
        ready: failCount === 0,
    };
};
