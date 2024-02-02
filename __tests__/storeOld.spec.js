import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createApp } from 'vue';
import { createPinia, setActivePinia, defineStore } from 'pinia';
import { array, number, object, reach, string } from 'yup';
import { getDB, setUserId, } from './utils/firebase';
import { piniafirePlugin, defineFirebaseStore } from '..';
import { collection, deleteDoc, doc, getDoc, getDocs } from 'firebase/firestore';

async function getSnapshotById(id) {
  const db = await getDB();
  const ref = doc(db, 'testCollection', id);
  return getDoc(ref);
}

const storeOptions = {
  collectionName: 'testCollection',
  docSchema: object({
    title: string().ensure(),
    testValue: number().default(50).min(10).max(100),
    parent: object().shape({
      child: number().default(1)
    }),
    numbers: array().default([1, 2, 3, 4, 5])
  }),
  state: {
    extraValue: 200,
  },
  actions: {
    testAction: vi.fn(),
  },
  initialize: vi.fn()
};

let db;
let store = {};
let storeWithLocalStorage = {};
let lastId;
let app;

let pinia;

beforeAll(async() => {
  setUserId('user');
  db = await getDB();

  console.log(db);

  pinia = createPinia();

  app = createApp();
  app.use(pinia);

  const useStore = defineFirebaseStore('test', { ...storeOptions, db });
  const useStoreWithLocalStorage = defineFirebaseStore('test-localstorage', { ...storeOptions, db, localStorageFallbackKey: 'test' });
  store = useStore();
  storeWithLocalStorage = useStoreWithLocalStorage();
})


beforeEach(async() => {
  app = createApp();
  pinia = createPinia();
  app.use(pinia);
});

afterAll(async() => {
  db = await getDB();
  const collectionRef = collection(db, 'testCollection');
  const querySnapshot = await getDocs(collectionRef);
  const promises = querySnapshot.docs.map(snapshot => {
    return deleteDoc(snapshot.ref)
  });
  await Promise.all(promises);
});


describe('firebaseStore', () => {
  describe.only('initialize', () => {
    it('should initialize with default values', async () => {
      expect(store.doc.testValue).toBe(50);
      expect(store.extraValue).toBe(200);
    });

    it('should call initialize the first time the store is used', () => {
      const app = createApp();
      const pinia = createPinia();
      app.use(pinia);
      pinia.use(piniafirePlugin({db}));
      const useStore = defineFirebaseStore(storeOptions);
      store = useStore();

      expect(storeOptions.initialize).toBeCalled();
    });
  });

  describe('doc', () => {
    describe('proxy', () => {
      it('should get a document property directly from the store', async () => {
        expect(store.testValue).toBe(50);
        expect(store.doc.testValue).toBe(50);

      });

      it('should set a document property directly from the store', async () => {
        store.testValue = 100;

        expect(store.testValue).toBe(100);
        expect(store.doc.testValue).toBe(100);
      });
    });

    describe('$getRef', () => {
      it('should return a document reference', async() => {
        const docRef = await store.$getRef('docId');

        expect(docRef.constructor.name).toBe('DocumentReference');
        expect(docRef.path).toBe('testCollection/docId');
      });
    });

    describe('$get', async() => {
      it('should return a shallow property', async() => {
        const val = store.$get('testValue');

        expect(val).toBe(100);
      });

      it('should return a nested property', async() => {
        const val = store.$get('parent.child');

        expect(val).toBe(1);
      });
    });

    describe('$create', async() => {
      it('should create a document with default values and return the id', async() => {
        const doc = await store.$create();

        expect(typeof doc.__id).toBe('string');
        expect(store.$get('testValue')).toBe(50);
        expect(store.extraValue).toBe(200);
      });

      it('should create a document with the specified values', async() => {
        await store.$create({ testValue: 501 });

        expect(store.$get('testValue')).toBe(501);
      });

      it('should create a document and strip values not defined in the schema', async() => {
        await store.$create({ title: 'Doc Title', invalidProp: true });

        expect(store.invalidProp).toBe(undefined);
      });
    });

    describe('$fetch', async() => {
      it('should fetch a document', async() => {
        const doc = await store.$fetch(lastId);

        expect(doc.__id).toBe(lastId);
      });
    });

    describe('$update', async() => {
      it('should update a document', async() => {
        const updated = await store.$update('testValue', 99);

        expect(updated).toBe(true);
        expect(store.doc.testValue).toBe(99);
      });

      it('should prevent updating if the schema does not validate', async() => {
        const updated = await store.$update('testValue', 999);

        expect(updated).toBe(false);
        expect(store.doc.testValue).toBe(99);
      });

      it('should throw if the property does not exist', async() => {
        const errorHandler = vi.fn();
        await store.$update('invalidProperty', 999).catch(errorHandler);

        expect(errorHandler).toBeCalled();
        expect(store.doc.invalidProperty).toBe(undefined);
      });

      it('should not update if the value has not changed', async() => {
        await store.$update('testValue', 10);
        const updated = await store.$update('testValue', 2);

        expect(updated).toBe(false);
      });

      it('should not sync after updating', async() => {
        const syncSpy = vi.spyOn(store, '$sync');

        await store.$update('testValue', 11);

        expect(syncSpy).not.toHaveBeenCalled();
      });

      it('should sync after updating', async() => {
        const syncSpy = vi.spyOn(store, '$sync');

        await store.$update('testValue', 12, true);

        expect(syncSpy).toHaveBeenCalled();
      })
    });

    describe('$sync', async() => {
      it('should update a single property in the database document', async() => {
        await store.$create();

        const id = store.doc.__id;
        const db = await getDB();
        const ref = doc(db, 'testCollection', id);
        const snapshot = await getDoc(ref);
        const data = snapshot.data();

        expect(data.title).toBe('');

        await store.$update('title', 'New Title');
        await store.$update('testValue', 20);
        await store.$sync('title');
        const newSnapshot = await getDoc(ref);
        const newData = newSnapshot.data();

        expect(newData.title).toBe('New Title');
        expect(newData.testValue).not.toBe(20);
      });

      it('should update multiple properties in the database document', async() => {
        const newDoc = await store.$create();
        const db = await getDB();
        const ref = doc(db, 'testCollection', newDoc.__id);
        const snapshot = await getDoc(ref);
        const data = snapshot.data();

        expect(data.title).toBe('');
        expect(data.testValue).toBe(50);

        await store.$update('title', 'New Title');
        await store.$update('testValue', 20);
        await store.$sync(['title', 'testValue']);

        const newSnapshot = await getDoc(ref);
        const newData = newSnapshot.data();

        expect(newData.title).toBe('New Title');
        expect(newData.testValue).toBe(20);
      });
    })

    describe('$arrayUpdate', async() => {
      it('should return false if the callback does not return an array', async() => {
        const updated = await store.$arrayUpdate('numbers', (arr) => true);

        expect(updated).toBe(false);
      });

      it('should return false if the array has not changed', async() => {
        const updated = await store.$arrayUpdate('numbers', (arr) => arr);

        expect(updated).toBe(false);
      });

      it('should update the local array value', async() => {
        const updated = await store.$arrayUpdate('numbers', (arr) => [1, 2], false);

        expect(updated).toBe(true);
        expect(store.doc.numbers).toEqual([1, 2])
      });

      it('should update the value in the local state and the database', async() => {
        const newDoc = await store.$create();

        expect(store.doc.numbers).toHaveLength(5);

        const updated = await store.$arrayUpdate('numbers', (arr) => [1, 2]);
        const snapshot = await getSnapshotById(newDoc.__id);
        const data = snapshot.data();

        expect(data.numbers).toEqual([1, 2]);
      });
    });

    describe('$arrayUnion', async() => {
      it('should add an item to an array', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayUnion('numbers', 6);

        expect(store.doc.numbers).toEqual([1, 2, 3, 4, 5, 6]);
      });
    });

    describe('$arrayRemove', async() => {
      it('should not update the array if the given value is not present', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayRemove('numbers', 9);

        expect(updated).toBe(false);
        expect(store.doc.numbers).toEqual([1, 2, 3, 4, 5]);
      });

      it('should remove an item from an array', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayRemove('numbers', 3);

        expect(updated).toBe(true);
        expect(store.doc.numbers).toEqual([1, 2, 4, 5]);
      });
    });

    describe('$arrayRemoveIndex', async() => {
      it('should remove the item of the given index from an array', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayRemoveIndex('numbers', 1);

        expect(updated).toBe(true);
        expect(store.doc.numbers).toEqual([1, 3, 4, 5]);
      });

      it('should not update the array if the index does not exist', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayRemoveIndex('numbers', 5);

        expect(updated).toBe(false);
        expect(store.doc.numbers).toEqual([1, 2, 3, 4, 5]);
      });
    });

    describe('$arrayUpdateItem', () => {
      it('should update the item of the given index', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayUpdateItem('numbers', 0, 9);

        expect(updated).toBe(true);
        expect(store.doc.numbers).toEqual([9, 2, 3, 4, 5]);
      });

      it('should not update the array if the index does not exist', async() => {
        const newDoc = await store.$create();
        const updated = await store.$arrayUpdateItem('numbers', 6, 9);

        expect(updated).toBe(false);
        expect(store.doc.numbers).toEqual([1, 2, 3, 4, 5]);
      });
    });

    describe('$delete', () => {
      it('should delete the document, reset the state and return true', async() => {
        const newDoc = await store.$create();
        const db = await getDB();
        const ref = doc(db, 'testCollection', newDoc.__id);

        const deleted = await store.$delete()

        const snapshot = await getDoc(ref);

        expect(snapshot.exists()).toBe(false);
        expect(deleted).toBe(true);
        expect(store.doc.title).toBe('');
      });
    });

    describe.only('localStorageFallback', () => {
      it('should create a document reference in localstorage', async() => {
        const doc = await storeWithLocalStorage.$create({ testValue: 100 });

        expect(storeWithLocalStorage.testValue).toBe(100);
        expect(doc.testValue).toBe(100);
        expect(JSON.parse(localStorage.getItem('test')).testValue).toBe(100)
      });

      it('should fetch a document reference from localstorage', async() => {
        await storeWithLocalStorage.$create({ testValue: 100 });

        const doc = await storeWithLocalStorage.$fetch();

        expect(storeWithLocalStorage.testValue).toBe(100);
        expect(doc.testValue).toBe(100);
        expect(JSON.parse(localStorage.getItem('test')).testValue).toBe(100)
      });

      it ('should update a document in localStorage', async() => {
        await storeWithLocalStorage.$create({ testValue: 100 });

        const doc = await storeWithLocalStorage.$fetch();

        await storeWithLocalStorage.$update('testValue', 99, true);

        expect(storeWithLocalStorage.testValue).toBe(99);
        expect(doc.testValue).toBe(99);
        expect(JSON.parse(localStorage.getItem('test')).testValue).toBe(99)
      });
    });

  });

  describe('collection', () => {

    describe('$query', () => {
      it('should fetch a collection of documents', async() => {
        const docs = await store.$query();

        expect(docs).toBeInstanceOf(Array);
        expect(docs[0]).toHaveProperty('numbers');
      })
    });

    describe('$addDoc', async() => {
      it('should add a document to the collection', async() => {
        const { id, data, ref } = await store.$addDoc({ numbers: [0, 10, 20] });

        expect(typeof id).toBe('string');
        expect(ref.id).toBe(id);
        expect(data.numbers).toEqual([0, 10, 20]);
      })
    });

    describe('$deleteDoc', async() => {
      it('should delete a document from the collection', async() => {
        const { id, data, ref } = await store.$addDoc();

        await store.$deleteDoc(id);
        const collectionItem = store.collection.find(item => item.__id === id);
        const snapshot = await getSnapshotById(id);

        expect(collectionItem).toBe(undefined);
        expect(snapshot.exists()).toBe(false);
      })
    });

    describe('$getDoc', async() => {
      it('should retrieve a document from the collection by its id', async() => {
        const docs = await store.$query();
        const doc = docs[3];

        const retrieved = store.$getDoc(doc.__id);

        expect(retrieved).toBe(doc);
      });
    });

    describe('$updateDoc', async() => {
      it('should update a document in the collection', async() => {

      });

      it('should not update if schema validation fails', async() => {

      });
    });

  });
});
