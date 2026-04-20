import { getUserActivityModel } from '../models/userHistory';

const makeModel = () =>
    getUserActivityModel(`0x${Math.random().toString(16).slice(2).padEnd(40, 'a').slice(0, 40)}`);

describe('db wrapper safe updates', () => {
    test('updateOne writes with $set', async () => {
        const model = makeModel();
        const doc: any = await model.save({ _id: 'u1', a: 1, b: 2 });

        await model.updateOne({ _id: doc._id }, { $set: { a: 3 } });

        const updated: any = await model.findOne({ _id: doc._id }).exec();
        expect(updated.a).toBe(3);
        expect(updated.b).toBe(2);
    });

    test('plain updateOne patches fields instead of replacing the document', async () => {
        const model = makeModel();
        const doc: any = await model.save({ _id: 'u2', keep: 'yes', change: 'old' });

        await model.updateOne({ _id: doc._id }, { change: 'new' });

        const updated: any = await model.findOne({ _id: doc._id }).exec();
        expect(updated.keep).toBe('yes');
        expect(updated.change).toBe('new');
    });

    test('setById and incById behave correctly', async () => {
        const model = makeModel();
        const doc: any = await model.save({ _id: 'u3', count: 1, keep: true });

        await model.setById(doc._id, { keep: false });
        await model.incById(doc._id, { count: 2 });

        const updated: any = await model.findOne({ _id: doc._id }).exec();
        expect(updated.keep).toBe(false);
        expect(updated.count).toBe(3);
    });

    test('replaceOne still performs intentional full-document replacement', async () => {
        const model = makeModel();
        const doc: any = await model.save({ _id: 'u4', keep: true, remove: 'soon' });

        await model.replaceOne({ _id: doc._id }, { _id: doc._id, keep: false });

        const updated: any = await model.findOne({ _id: doc._id }).exec();
        expect(updated.keep).toBe(false);
        expect(updated.remove).toBeUndefined();
    });
});
