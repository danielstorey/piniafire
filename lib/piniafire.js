// Inspired by https://github.com/s-agena/pinia-firestore

import { onSnapshot } from 'firebase/firestore';
import logger from '../utils/logger.js';

function getStoreKey(id, name) {
  return `${id}:${name}`;
}

const unsubs = {};

function pick(id, name) {
  const itemKey = getStoreKey(id, name);
  const item = unsubs[itemKey];
  logger.log('pick:', id, name, item);
  return item;
}

function remove(id, name) {
  const itemKey = getStoreKey(id, name);
  const item = unsubs[itemKey];

  if (item !== undefined) {
    delete unsubs[itemKey];
    logger.log('remove:', id, name, item);
  }
}

function store(id, name, unsub, type) {
  const itemKey = getStoreKey(id, name);
  const item = {
    id,
    name,
    unsub,
    remove: () => remove(id, name),
    type,
  };
  unsubs[itemKey] = item;
}

export const unbind = (piniaInstance, ref) => {
  const item = pick(piniaInstance.$id, ref.id);

  item.unsub();
  item.remove();
};

export const bind = async(piniaInstance, field, ref, options = {}) => new Promise((resolve, reject) => {
  let isInitialised = false;

  const updateHandler = (ref.type === 'document')
    ? handleDocSnapshotUpdate
    : handleCollectionSnapshotUpdate;

  const unsub = onSnapshot(ref, updateHandler, handleError);

  function handleDocSnapshotUpdate(snapshot) {
    if (!snapshot.exists()) {
      return _resolve(false);
    }

    const { beforeUpdate, afterUpdate } = options;
    const doc = makeDocumentData(snapshot);

    if (beforeUpdate) {
      try {
        beforeUpdate(doc);
      } catch(e) {
        logger.error('beforeUpdate handler failed', e.message);
      }
    }

    piniaInstance.$patch((state) => {
      Object.assign(state[field], doc);
    });

    if (afterUpdate) afterUpdate(doc);

    _resolve(doc);
  }

  function handleCollectionSnapshotUpdate(querySnapshot) {
    const docs = piniaInstance.$state.collection;

    piniaInstance[field] = docs;

    querySnapshot.docChanges().forEach((change) => {
      const { id } = change.doc;

      switch (change.type) {
        case 'added':
          const doc = docs[id];
          const { newIndex } = change;
          if (!doc) {
            const newDoc = makeDocumentData(change.doc);
            newDoc.__index = newIndex;
            docs.splice(change.newIndex, 0, newDoc);
            docs[id] = newDoc;
          } else {
            doc.__index = newIndex;
            docs[newIndex] = doc;
          }
          break;
        case 'modified':
          docs.splice(change.newIndex, 1, makeDocumentData(change.doc));
          break;
        case 'removed':
          docs.splice(change.oldIndex, 1);
          delete docs[id];
          break;
      }
    });

    _resolve(docs);
  }

  function _resolve(val) {
    if (!isInitialised) {
      isInitialised = true;
      resolve(val);
    }
  }

  function handleError(error) {
    logger.error(`${piniaInstance.$id} error`, error);
    remove(piniaInstance.$id, ref.id);

    if (!isInitialised) {
      isInitialised = true;
      reject(error);
    }
  }

  store(piniaInstance.$id, ref.id, unsub, ref.type);
});

function makeDocumentData(snapshot) {
  const doc = snapshot.data() || {};

  return {
    __id: snapshot.id,
    __path: snapshot.ref.path,
    __metadata: snapshot.metadata,
    ...doc,
  };
}
