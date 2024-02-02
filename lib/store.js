import { defineStore } from 'pinia';
import {getFirestore, collection, addDoc, setDoc, deleteDoc, doc, updateDoc, query, orderBy, where, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import {get, has, reduce, isArray, isEqual, set, cloneDeep, omit } from 'lodash-es';
import logger from '../utils/logger';
import {computed, reactive, ref} from "vue";
import {useDocument} from "vuefire";

const UNINITIALIZED = 'UNINITIALIZED';
const INITIALIZING = 'INITIALIZING';
const INITIALIZED = 'INITIALIZED';

const isClient = (typeof window === 'object');


const getLocalStorageHandlers = (localStorageFallbackKey) => {
  if (!localStorageFallbackKey) return null;

  if (import.meta.env.MODE !== 'test' && getAuth().currentUser) return null;

 return {
   get: () => {
     const storedJSON = localStorage.getItem(localStorageFallbackKey);
     return storedJSON ? JSON.parse(storedJSON) : null;
   },
   set: (val) => {
     localStorage.setItem(localStorageFallbackKey, JSON.stringify(val));
     return val;
   }
 }
};

export default function defineFirebaseStore(id, setupOrOptions) {
  const {
    db,
    initialState,
    actions,
    getters,
    collectionName,
    docSchema,
    useCollection,
    useDoc,
    localStorageFallbackKey,
    ensureExists,
    initialize,
  } = setupOrOptions;

  if (!id || typeof id !== 'string') {
    return logger.error('Can\'t create a store without an id');
  }

  // Allow passing in a db instance
  const firestore = db || getFirestore();

  const useFirebaseStore = defineStore(id, () => {
    const localStorageHandlers = getLocalStorageHandlers(localStorageFallbackKey);

    let updatedOn;

    const userState = (typeof initialState === 'function') ? initialState() : initialState || {};

    const docState = reactive(initialState);

    const collectionPath = ref(collectionName);
    const collectionRef = computed(() => collection(firestore, collectionPath.value));
    const query = ref({});
    const queryRef = computed(() => { return '' });

    const documentId = ref(null);
    const docRef = computed(() => doc(collectionRef.value));
    const { data, error } = useDocument(docRef, 'sdfsf');

    function _getRef(id) {
      return doc(firestore, collectionPath.value, id);
    }

    async function _create(data, beforeCreate) {
      const newData = docSchema?.cast(data, { stripUnknown: true }) || data || {};
      // TODO: implement or delete
      // const appendData = this._appendToCreated();
      // const mergedData = { ...newData, ...appendData };
      const { id, ...newDoc } = newData;

      beforeCreate?.(newDoc);

      if (localStorageHandlers) {
        return localStorageHandlers.set(newDoc)
      }

      if (id) {
        await setDoc(docRef, newDoc);
      } else {
        await addDoc(collectionRef.value, newDoc);
      }

      return data.value;
    }

    async function _update(object, path, value, shouldSync) {
      if (!has(object, path)) {
        throw new Error(`Cannot update store: invalid document path: ${path}`);
      }

      const existingValue = this.$get(path);
      const valueHasChanged = !isEqual(existingValue, value);

      if (!valueHasChanged) return false;

      try {
        // validate a cloned object first to avoid mutating reactive properties
        const cloned = cloneDeep(object);
        set(cloned, path, value);
        docSchema?.validateSyncAt(path, cloned);
        set(object, path, value);
        this._onValidationSuccess(path);
        shouldSync && await this.$sync(path);
        return true;
      } catch(e) {
        logger.error(e.message);
        this._onValidationError(path, e.message);
        return false;
      }
    }

    async function _sync(docData, keys) {
      const keysToSync = (typeof keys === 'string') ? [keys] : keys;

      const patch = keysToSync.reduce((all, key) => ({ ...all, [key]: get(docData, key) }), {});

      const dataToSync = Object.keys(patch).length > 0 ? patch : docData;

      if (localStorageHandlers) {
        const dataToStore = reduce(dataToSync, (data, value, key) => {
          set(data, key, value);
          return data;
        }, docData);

        return localStorageHandlers.set(dataToStore);
      }

      return _updateDoc(docData.id, dataToSync);
    }

    async function _updateDoc(id, data) {
      const ref = _getRef(id);

      if (!ref) {
        return logger.error('Cannot sync. Error getting ref');
      }

      const appendData = this._appendToUpdated();
      const patch = { ...data, ...appendData };

      await updateDoc(ref, patch).catch(logger.error);

      return true;
    }
  });

  // Store defaults to using both doc and collection actions
  // option must be explicitly disabled on each
  // const collectionActions = useCollection === false ? {} : createCollectionActions(collectionName);
  // const docActions = useDoc === false ? {} : createDocActions(docSchema, ensureExists, localStorageFallbackKey);

  return function() {
    const store = useFirebaseStore();

    if (!firestore) {
      return console.error('Firestore not found.');
    }

    function initializeStore() {
      if (!store.isInitialized && store._initializedState !== INITIALIZING) {
        if (isClient) {
          store._initializedState = INITIALIZING;
        }

        const onInitialized = () => {
          if (!isClient) return;
          store._initializedState = INITIALIZED;
          store.isInitialized = true;
        };

        const returnVal = initialize?.call(store);

        if (returnVal instanceof Promise) {
          returnVal.then(onInitialized);
        } else {
          onInitialized();
        }
      }
    }

    initializeStore();

    return new Proxy(store, {
      get: (target, prop) => {
        if (has(store.doc, prop)) {
          return store.doc[prop];
        }

        return Reflect.get(target, prop);
      },
      set: (target, prop, value) => {
        if (has(store.doc, prop)) {
          store.doc[prop] = value;
        } else {
          store[prop] = value;
        }

        return true;
      }
    });
  };
}
