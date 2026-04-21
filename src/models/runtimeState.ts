import Datastore from '@seald-io/nedb';
import * as path from 'path';
import { getDbDir } from '../config/db';
import { PersistedUserStreamEvent, ReconciliationSnapshot } from '../interfaces/Reconciliation';

const datastoreCache: Map<string, Datastore> = new Map();

const getDatastore = (name: string): Datastore => {
    if (datastoreCache.has(name)) {
        return datastoreCache.get(name)!;
    }

    const ds = new Datastore({ filename: path.join(getDbDir(), `${name}.db`), autoload: true });
    datastoreCache.set(name, ds);
    return ds;
};

const RECONCILIATION_EVENT_COLLECTION = 'runtime_reconciliation_events';
const RECONCILIATION_SNAPSHOT_COLLECTION = 'runtime_snapshots';
const RECONCILIATION_SNAPSHOT_ID = 'reconciliation_status';

const reconciliationEventStore = () => getDatastore(RECONCILIATION_EVENT_COLLECTION);
const reconciliationSnapshotStore = () => getDatastore(RECONCILIATION_SNAPSHOT_COLLECTION);

export const listPersistedReconciliationEvents = async (): Promise<PersistedUserStreamEvent[]> => {
    const docs = (await reconciliationEventStore().findAsync({})) as PersistedUserStreamEvent[];
    return docs.sort((left, right) => (left.savedAt || 0) - (right.savedAt || 0));
};

export const upsertPersistedReconciliationEvent = async (
    event: PersistedUserStreamEvent
): Promise<void> => {
    await reconciliationEventStore().updateAsync(
        { _id: event.orderId },
        {
            _id: event.orderId,
            ...event,
        },
        { upsert: true }
    );
};

export const removePersistedReconciliationEvent = async (orderId: string): Promise<void> => {
    await reconciliationEventStore().removeAsync({ _id: orderId }, {});
};

export const loadReconciliationSnapshot = async (): Promise<ReconciliationSnapshot | null> => {
    const doc = (await reconciliationSnapshotStore().findOneAsync({
        _id: RECONCILIATION_SNAPSHOT_ID,
    })) as (ReconciliationSnapshot & { _id?: string }) | null;

    if (!doc) {
        return null;
    }

    const { _id, ...snapshot } = doc;
    return snapshot;
};

export const saveReconciliationSnapshot = async (
    snapshot: ReconciliationSnapshot
): Promise<void> => {
    await reconciliationSnapshotStore().updateAsync(
        { _id: RECONCILIATION_SNAPSHOT_ID },
        {
            _id: RECONCILIATION_SNAPSHOT_ID,
            ...snapshot,
        },
        { upsert: true }
    );
};
