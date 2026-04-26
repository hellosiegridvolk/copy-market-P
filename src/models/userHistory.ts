import Datastore from '@seald-io/nedb';
import * as path from 'path';
import { getDbDir } from '../config/db';

// Cache datastores to avoid creating duplicates
const datastoreCache: Map<string, Datastore> = new Map();

const getDatastore = (name: string): Datastore => {
    if (datastoreCache.has(name)) return datastoreCache.get(name)!;
    const ds = new Datastore({ filename: path.join(getDbDir(), `${name}.db`), autoload: true });
    datastoreCache.set(name, ds);
    return ds;
};

const isOperatorUpdate = (update: Record<string, unknown>): boolean => {
    return Object.keys(update).some((k) => k.startsWith('$'));
};

const toSafeUpdate = (update: Record<string, unknown>): Record<string, unknown> => {
    if (isOperatorUpdate(update)) {
        return update;
    }

    // Treat plain objects as partial field patches by default.
    return { $set: update };
};

// Wrapper that provides a mongoose-like API over NeDB
const createModel = (collectionName: string) => {
    const ds = getDatastore(collectionName);

    return {
        findOne(query: Record<string, unknown>) {
            return { exec: () => ds.findOneAsync(query) };
        },
        find(query: Record<string, unknown> = {}) {
            return {
                exec: () => ds.findAsync(query),
                sort: (sortObj: Record<string, number>) => ({
                    exec: () =>
                        ds.findAsync(query).then((docs) =>
                            docs.sort((a: any, b: any) => {
                                for (const [key, dir] of Object.entries(sortObj)) {
                                    if (a[key] !== b[key]) return dir * (a[key] > b[key] ? 1 : -1);
                                }
                                return 0;
                            })
                        ),
                }),
            };
        },
        updateOne(query: Record<string, unknown>, update: Record<string, unknown>) {
            return ds.updateAsync(query, toSafeUpdate(update), {});
        },
        updateOneSet(query: Record<string, unknown>, fields: Record<string, unknown>) {
            return ds.updateAsync(query, { $set: fields }, {});
        },
        setById(id: string, fields: Record<string, unknown>) {
            return ds.updateAsync({ _id: id }, { $set: fields }, {});
        },
        incById(id: string, fields: Record<string, number>) {
            return ds.updateAsync({ _id: id }, { $inc: fields }, {});
        },
        replaceOne(query: Record<string, unknown>, doc: Record<string, unknown>) {
            return ds.updateAsync(query, doc, {});
        },
        updateMany(query: Record<string, unknown>, update: Record<string, unknown>) {
            return ds
                .updateAsync(query, toSafeUpdate(update), { multi: true })
                .then((result) => ({
                    modifiedCount:
                        typeof result === 'number' ? result : (result as any).numAffected || 0,
                }));
        },
        findOneAndUpdate(
            query: Record<string, unknown>,
            update: Record<string, unknown>,
            options: { upsert?: boolean } = {}
        ) {
            return ds.updateAsync(query, toSafeUpdate(update), { upsert: options.upsert || false });
        },
        countDocuments() {
            return ds.countAsync({});
        },
        async save(doc: Record<string, unknown>) {
            return ds.insertAsync(doc);
        },
    };
};

const createDocumentFactory = (collectionName: string) => {
    const model = createModel(collectionName);
    const factory = (data: Record<string, unknown>) => {
        return {
            ...data,
            save: () => model.save(data),
            toObject: () => ({ ...data }),
        };
    };
    Object.assign(factory, model);
    return factory as typeof factory & ReturnType<typeof createModel>;
};

const getUserPositionModel = (walletAddress: string) => {
    return createModel(`user_positions_${walletAddress}`);
};

const getUserActivityModel = (walletAddress: string) => {
    return createDocumentFactory(`user_activities_${walletAddress}`);
};

export { getUserActivityModel, getUserPositionModel };
