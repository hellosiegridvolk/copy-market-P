import { getUserActivityModel } from '../models/userHistory';

describe('db wrapper safe updates', () => {
    const model = getUserActivityModel('0xabc');

    test('updateOne writes with $set', async () => {
        const doc: any = await model.save({ _id: 'u1', a: 1, b: 2 });
        await model.updateOne({ _id: doc._id }, { $set: { a: 3 } });
        const updated: any = await model.findOne({ _id: doc._id }).exec();
        expect(updated.a).toBe(3);
        expect(updated.b).toBe(2);
    });

    test('setById and incById behave correctly', async () => {
        const doc: any = await model.save({ _id: 'u2', count: 1, keep: true });
        await model.setById(doc._id, { keep: false });
        await model.incById(doc._id, { count: 2 });
        const updated: any = await model.findOne({ _id: doc._id }).exec();
        expect(updated.keep).toBe(false);
        expect(updated.count).toBe(3);
    });
});
