jest.mock('../config/env', () => ({
  ENV: {
    USER_ADDRESSES: ['0xtrader'],
    RETRY_LIMIT: 2,
    PROXY_WALLET: '0xproxy',
    TRADE_AGGREGATION_ENABLED: false,
    TRADE_AGGREGATION_WINDOW_SECONDS: 10,
  }
}));

const setById = jest.fn().mockResolvedValue(1);
const incById = jest.fn().mockResolvedValue(1);
const find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

jest.mock('../models/userHistory', () => ({
  getUserActivityModel: jest.fn(() => ({ setById, incById, find }))
}));

jest.mock('../utils/fetchData', () => jest.fn().mockResolvedValue([]));
jest.mock('../utils/getMyBalance', () => jest.fn().mockResolvedValue(100));
jest.mock('../utils/postOrder', () => jest.fn().mockResolvedValue(undefined));

import tradeExecutor, { stopTradeExecutor } from '../services/tradeExecutor';

describe('trade executor lifecycle persistence', () => {
  test('already executed trade does not execute twice', async () => {
    find.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: 't1', type: 'TRADE', bot: true, botExcutedTime: 1, status: 'executed', toObject(){return this;} }]) });
    const loop = tradeExecutor({} as any);
    await new Promise((r) => setTimeout(r, 50));
    stopTradeExecutor();
    await loop;
    expect(setById).toHaveBeenCalled();
  });

  test('failure path increments retry count', async () => {
    const postOrder = require('../utils/postOrder').default as jest.Mock;
    postOrder.mockRejectedValueOnce(new Error('boom'));
    find.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: 't2', type: 'TRADE', bot: false, botExcutedTime: 0, side: 'BUY', usdcSize: 10, asset: 'a', slug: 'm', conditionId: 'c', toObject(){return this;} }]) });
    const loop = tradeExecutor({} as any);
    await new Promise((r) => setTimeout(r, 80));
    stopTradeExecutor();
    await loop;
    expect(incById).toHaveBeenCalled();
  });
});
