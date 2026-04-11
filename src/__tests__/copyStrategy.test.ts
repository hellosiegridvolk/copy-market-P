import {
    calculateOrderSize,
    CopyStrategy,
    CopyStrategyConfig,
    parseTieredMultipliers,
    getTradeMultiplier,
    validateCopyStrategyConfig,
} from '../config/copyStrategy';

describe('calculateOrderSize', () => {
    const baseConfig: CopyStrategyConfig = {
        strategy: CopyStrategy.PERCENTAGE,
        copySize: 10.0,
        maxOrderSizeUSD: 100.0,
        minOrderSizeUSD: 1.0,
    };

    test('PERCENTAGE: 10% of $500 = $50', () => {
        const r = calculateOrderSize(baseConfig, 500, 1000);
        expect(r.finalAmount).toBeCloseTo(50);
        expect(r.strategy).toBe(CopyStrategy.PERCENTAGE);
    });

    test('FIXED: always $25 regardless of trader size', () => {
        const cfg = { ...baseConfig, strategy: CopyStrategy.FIXED, copySize: 25 };
        expect(calculateOrderSize(cfg, 500, 1000).finalAmount).toBeCloseTo(25);
        expect(calculateOrderSize(cfg, 10, 1000).finalAmount).toBeCloseTo(25);
    });

    test('ADAPTIVE: small orders get higher %, large orders get lower %', () => {
        const cfg: CopyStrategyConfig = {
            strategy: CopyStrategy.ADAPTIVE,
            copySize: 10.0,
            adaptiveMinPercent: 5.0,
            adaptiveMaxPercent: 20.0,
            adaptiveThreshold: 500.0,
            maxOrderSizeUSD: 1000,
            minOrderSizeUSD: 1.0,
        };
        const small = calculateOrderSize(cfg, 50, 10000);
        const large = calculateOrderSize(cfg, 1000, 10000);
        // Small order should have higher effective percentage
        expect(small.finalAmount / 50).toBeGreaterThan(large.finalAmount / 1000);
    });

    test('caps at MAX_ORDER_SIZE_USD', () => {
        const r = calculateOrderSize(baseConfig, 5000, 10000);
        expect(r.finalAmount).toBe(100);
        expect(r.cappedByMax).toBe(true);
    });

    test('reduces to fit balance (99% safety buffer)', () => {
        const r = calculateOrderSize(baseConfig, 500, 30); // 10% of 500 = 50, but balance only 30
        expect(r.finalAmount).toBeCloseTo(29.7); // 30 * 0.99
        expect(r.reducedByBalance).toBe(true);
    });

    test('returns 0 when below minimum', () => {
        const r = calculateOrderSize(baseConfig, 5, 1000); // 10% of 5 = 0.50 < 1.0
        expect(r.finalAmount).toBe(0);
        expect(r.belowMinimum).toBe(true);
    });

    test('respects maxPositionSizeUSD', () => {
        const cfg = { ...baseConfig, maxPositionSizeUSD: 60 };
        const r = calculateOrderSize(cfg, 500, 1000, 50); // already $50 in position, max $60
        expect(r.finalAmount).toBeCloseTo(10); // only $10 room left
    });

    test('zero trader order size returns 0 for PERCENTAGE', () => {
        const r = calculateOrderSize(baseConfig, 0, 1000);
        expect(r.finalAmount).toBe(0);
    });

    test('zero balance returns 0', () => {
        const r = calculateOrderSize(baseConfig, 500, 0);
        expect(r.finalAmount).toBe(0);
    });
});

describe('parseTieredMultipliers', () => {
    test('parses valid tiers', () => {
        const tiers = parseTieredMultipliers('1-100:2.0,100-500:1.0,500+:0.1');
        expect(tiers).toHaveLength(3);
        expect(tiers[0]).toEqual({ min: 1, max: 100, multiplier: 2.0 });
        expect(tiers[2]).toEqual({ min: 500, max: null, multiplier: 0.1 });
    });

    test('returns empty for empty string', () => {
        expect(parseTieredMultipliers('')).toEqual([]);
    });

    test('throws on overlapping tiers', () => {
        expect(() => parseTieredMultipliers('1-200:1.0,100-500:0.5')).toThrow('Overlapping');
    });

    test('throws on infinite tier not last', () => {
        expect(() => parseTieredMultipliers('100+:0.1,200-500:0.5')).toThrow('must be last');
    });

    test('throws on invalid format', () => {
        expect(() => parseTieredMultipliers('100:1.0')).toThrow('Invalid range');
    });
});

describe('getTradeMultiplier', () => {
    test('returns tier multiplier for matching range', () => {
        const cfg: CopyStrategyConfig = {
            ...({ strategy: CopyStrategy.PERCENTAGE, copySize: 10, maxOrderSizeUSD: 100, minOrderSizeUSD: 1 }),
            tieredMultipliers: parseTieredMultipliers('1-100:2.0,100-500:1.0,500+:0.1'),
        };
        expect(getTradeMultiplier(cfg, 50)).toBe(2.0);
        expect(getTradeMultiplier(cfg, 200)).toBe(1.0);
        expect(getTradeMultiplier(cfg, 1000)).toBe(0.1);
    });

    test('falls back to tradeMultiplier if no tiers', () => {
        const cfg: CopyStrategyConfig = {
            strategy: CopyStrategy.PERCENTAGE, copySize: 10, maxOrderSizeUSD: 100, minOrderSizeUSD: 1,
            tradeMultiplier: 3.0,
        };
        expect(getTradeMultiplier(cfg, 50)).toBe(3.0);
    });

    test('returns 1.0 if nothing configured', () => {
        const cfg: CopyStrategyConfig = {
            strategy: CopyStrategy.PERCENTAGE, copySize: 10, maxOrderSizeUSD: 100, minOrderSizeUSD: 1,
        };
        expect(getTradeMultiplier(cfg, 50)).toBe(1.0);
    });
});

describe('validateCopyStrategyConfig', () => {
    test('valid config returns no errors', () => {
        const errors = validateCopyStrategyConfig({
            strategy: CopyStrategy.PERCENTAGE, copySize: 10, maxOrderSizeUSD: 100, minOrderSizeUSD: 1,
        });
        expect(errors).toEqual([]);
    });

    test('negative copySize returns error', () => {
        const errors = validateCopyStrategyConfig({
            strategy: CopyStrategy.PERCENTAGE, copySize: -5, maxOrderSizeUSD: 100, minOrderSizeUSD: 1,
        });
        expect(errors).toContain('copySize must be positive');
    });

    test('min > max returns error', () => {
        const errors = validateCopyStrategyConfig({
            strategy: CopyStrategy.PERCENTAGE, copySize: 10, maxOrderSizeUSD: 1, minOrderSizeUSD: 100,
        });
        expect(errors).toContain('minOrderSizeUSD cannot be greater than maxOrderSizeUSD');
    });

    test('PERCENTAGE > 100 returns error', () => {
        const errors = validateCopyStrategyConfig({
            strategy: CopyStrategy.PERCENTAGE, copySize: 150, maxOrderSizeUSD: 100, minOrderSizeUSD: 1,
        });
        expect(errors).toContain('copySize for PERCENTAGE strategy should be <= 100');
    });
});
