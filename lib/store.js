import { defineStore } from 'pinia';
import {
  collection, addDoc, setDoc, deleteDoc, doc, updateDoc, query, orderBy, where,
} from 'firebase/firestore';
import {
  get, has, isArray, isEqual, set, cloneDeep, omit,
} from 'lodash-es';
import logger from '../utils/logger.js';
import { bind, unbind } from './piniafire.js';

const UNINITIALIZED = Symbol('UNINITIALIZED');
const INITITALIZING = Symbol('INITITALIZING');
const INITIALIZED = Symbol('INITIALIZED');

function createDocActions(docSchema, ensureExists) {
  return {
    $get(path) {
      return get(this.doc, path);
    },

    async $getRef(...args) {
      const id = args[0] || this.doc.__id;

      if (!id) {
        return logger.error('Can\'t get ref without an id');
      }

      return this._getRef(id);
    },

    _bind(docRef) {
      return bind(this, 'doc', docRef, {
        beforeUpdate: this.onUpdate,
      }).catch(logger.error);
    },

    async _unbind() {
      const ref = await this.$getRef();
      this.$reset();
      return unbind(this, ref);
    },

    /**
     * Create a document, merging the given data with the default data
     * @param data
     * @return {Object} - the id of the created document
     */
    async $create(data = {}) {
      const dataFromSchema = docSchema?.getDefaultFromShape() || {};
      const newDoc = {
        ...dataFromSchema,
        ...data,
      };

      const created = await this._create(newDoc, (_newDoc) => {
        this.doc = cloneDeep(_newDoc);
      });

      await this._bind(created.ref);

      return this.doc;
    },

    /**
     * Fetch the firebase document by its id
     * @param {String} id
     * @return {Object} the firebase document data
     */
    async $fetch(id) {
      if (this.id === id) return this.$state;

      this.isFetching = true;

      this.doc = docSchema ? docSchema.getDefault() : {};

      const docFromCollection = this.$getDoc?.(id);

      if (docFromCollection) {
        Object.assign(this.doc, docFromCollection);
      }

      const docRef = await this.$getRef(id);
      const docData = await this._bind(docRef)

      if (!docData && ensureExists) {
        await setDoc(docRef, this.doc)
      }

      return docData;
    },

    /**
     * Update the local state
     * @param { String } path
     * @param { * } value
     * @param { Boolean } [shouldSync]
     * @return {Boolean}
     */
    async $update(path, value, shouldSync) {
      return this._update(this.doc, path, value, shouldSync);
    },

    /**
     * Delete the current document
     * @return { Boolean }
     */
    async $delete() {
      const docRef = await this.$getRef();

      unbind(this, docRef);

      await deleteDoc(docRef);

      this.$reset();
      return true;
    },

    /**
     * Save the local document data to the database
     * @param {String | Array} keys
     * @return {Boolean}
     */
    async $sync(keys) {
      return this._sync(this.doc, keys);
    },

    /**
     * Update an array at the given path by returning the new value from the callback argument
     * @param { String } path
     * @param { Function } cb
     * @param shouldSync
     * @return {Boolean|boolean|void}
     */
    async $arrayUpdate(path, cb, shouldSync = true) {
      const value = get(this.doc, path);

      if (!isArray(value)) {
        logger.error(`${path} is not an array`, value, this.$state);
        return false;
      }

      const newVal = cb(value);

      if (isEqual(newVal, value)) {
        logger.log(`Array ${path} hasn't changed`);
        return false;
      }

      return this.$update(path, newVal, shouldSync);
    },

    /**
     * Add an item to an array
     * @param { String }path
     * @param { * }value
     * @param { Boolean } shouldSync
     * @return { Boolean }
     */
    $arrayUnion(path, value, shouldSync) {
      return this.$arrayUpdate(
        path,
        (array) => ((array.includes(value)) ? array : [...array, value]),
        shouldSync,
      );
    },

    /**
     * Remove a given value from an array property
     * @param { String } path
     * @param { * } value
     * @param { Boolean } shouldSync
     * @return { Boolean }
     */
    $arrayRemove(path, value, shouldSync) {
      return this.$arrayUpdate(
        path,
        (array) => array.filter((val) => val !== value),
        shouldSync,
      );
    },

    /**
     * Remove the item of the given index from an array
     * @param { String } path
     * @param { Number } index
     * @param { Boolean } shouldSync
     * @return { Boolean }
     */
    $arrayRemoveIndex(path, index, shouldSync) {
      return this.$arrayUpdate(
        path,
        (array) => array.filter((val, i) => i !== index),
        shouldSync,
      );
    },

    /**
     * Update an array item of the given index
     * @param { String } path
     * @param { Number } index
     * @param { * } newItem
     * @param { Boolean } shouldSync
     * @return { Boolean }
     */
    $arrayUpdateItem(path, index, newItem, shouldSync) {
      return this.$arrayUpdate(
        path,
        (array) => array.map((item, i) => ((i === index) ? newItem : item)),
        shouldSync,
      );
    },
  };
}

function createCollectionActions() {
  return {
    _getQueryArgs() {
      const queryArgs = [];

      if (this.query.orderBy) {
        const dir = this.query.dir || 'asc';
        queryArgs.push(orderBy(this.query.orderBy, dir));
      }

      if (this.query.where) {
        queryArgs.push(where(...this.query.where));
      }

      return queryArgs;
    },
    async $query() {
      this.isFetching = true;

      const ref = collection(this._db, this._collectionPath);
      const queryArgs = [ref, ...this._getQueryArgs()];

      const querySnapshot = query(...queryArgs);

      const docs = await bind(this, 'collection', querySnapshot).catch(logger.error);

      this.isFetching = false;

      return docs;
    },
    async $addDoc(data, beforeCreate) {
      return this._create(data, beforeCreate);
    },
    $deleteDoc(id) {
      return this._delete(id).catch(logger.error);
    },
    $getDoc(id) {
      return this.collection.find((item) => item.__id === id);
    },
    async $updateDoc(id, path, value) {
      const collectionItem = this.$getDoc(id);

      // Perform optimistic update for better UX
      if (collectionItem) {
        this._update(collectionItem, path, value);
      }

      // TODO: update db only
      const patch = { [path]: value };
      return this._updateDoc(id, patch);
    },
  };
}

export default function defineFirebaseStore(options) {
  const {
    id,
    state,
    actions,
    getters,
    collectionName,
    docSchema,
    useCollection,
    useDoc,
    ensureExists,
    initialize,
  } = options;

  if (!id) {
    return logger.error('Can\'t create a store without an id');
  }

  // Store defaults to using both doc and collection actions
  // option must be explicitly disabled on each
  const collectionActions = useCollection === false ? {} : createCollectionActions(collectionName);
  const docActions = useDoc === false ? {} : createDocActions(docSchema, ensureExists);

  return () => {
    const useStore = defineStore(id, {
      __piniafire: true,
      state: () => {
        const userState = (typeof state === 'function') ? state() : state || {};

        return {
          _collectionPath: collectionName,
          _initializedState: UNINITIALIZED,
          isInitialized: false,
          isFetching: false,
          collection: [],
          query: {},
          doc: docSchema?.getDefaultFromShape() || {},
          ...userState,
        };
      },
      actions: {
        ...actions,
        ...docActions,
        ...collectionActions,

        async _getRef(id) {
          return doc(this._db, this._collectionPath, id);
        },

        /**
         * Create a piniafire document and return a promise that resolves with its ref
         * @param { object} [data] - data for the new document
         * @param { function } beforeCreate - a callback to be fired before the document is created in the firestore
         * so that any optimistic updates can be perfomed with the new document data
         * @return { id: string, data: object, ref: DocumentReference }
         * @private
         */
        async _create(data, beforeCreate) {
          const newData = docSchema?.cast(data, { stripUnknown: true }) || data || {};
          const appendData = this._appendToCreated();
          const mergedData = { ...newData, ...appendData };
          const { id, ...newDoc } = mergedData;

          beforeCreate?.(newDoc);

          if (id) {
            const docRef = doc(this._db, `${this._collectionPath}/${data.id}`);
            await setDoc(docRef, newDoc);
            return { id, data: omit(newDoc, id), ref: docRef };
          }
          const collectionRef = collection(this._db, this._collectionPath);
          const newRef = await addDoc(collectionRef, newDoc);
          return { id: newRef.id, data: newDoc, ref: newRef };
        },

        async _update(object, path, value, shouldSync) {
          if (!has(object, path)) {
            throw new Error(`Cannot update track store: invalid document path: ${path}`);
          }

          const existingValue = this.$get(path);
          const valueHasChanged = !isEqual(existingValue, value);

          if (!valueHasChanged) return false;

          try {
            // validate a cloned object first to avoid mutating reactive properties
            // const cloned = cloneDeep(object);
            // set(cloned, path, value);
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
        },

        async _sync(docData, keys) {
          const keysToSync = typeof keys === 'string' ? [keys] : keys;

          const patch = keysToSync.reduce((all, key) => ({ ...all, [key]: get(docData, key) }), {});

          const dataToSync = Object.keys(patch).length > 0 ? patch : docData;

          return this._updateDoc(docData.__id, dataToSync);
        },

        async _updateDoc(id, data) {
          const ref = await this.$getRef(id);

          if (!ref) {
            return logger.error('Cannot sync. Error getting ref');
          }

          const appendData = this._appendToUpdated();
          const patch = { ...data, ...appendData };

          await updateDoc(ref, patch).catch(logger.error);

          return true;
        },

        async _delete(id) {
          const ref = await this._getRef(id);

          return deleteDoc(ref);
        },
        _onValidationSuccess(path) {
          return this._runHandler('onValidationSuccess', this.$id, path);
        },
        _onValidationError(path, message) {
          return this._runHandler('onValidationError', this.$id, path, message);
        },
        _appendToCreated() {
          return this._runHandler('appendToCreated');
        },
        _appendToUpdated() {
          return this._runHandler('appendToUpdated');
        },

        _runHandler(name, ...args) {
          if (options[name] === null) return;

          const handler = options[name] || this._globalOptions[name];

          return handler?.(...args);
        },

        /**
         * Handle subcollections by setting the collection path
         * @param path
         */
        $setCollectionPath(path) {
          const segments = path.split('/');
          const isValid = segments.length % 2 === 0;

          if (!isValid) return logger.error('Invalid collection path');

          this._collectionPath = [path, collectionName].join('/');
        },
      },
      getters,
    });

    const store = useStore();

    if (!store._db) {
      return logger.error('Firestore not found. Did you initialize the plugin by calling pinia.use({ db: yourFirestoreInstance })?');
    }

    if (!store.isInitialized && store._initializedState !== INITITALIZING) {
      store._initializedState = INITITALIZING;

      const onInitialized = () => {
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

    return new Proxy(store, {
      get: (target, prop) => {
        if (store.doc[prop]) {
          return store.doc[prop];
        }

        return Reflect.get(target, prop);
      },
      set: (target, prop, value) => {
        if (typeof store.doc[prop] !== 'undefined') {
          store.doc[prop] = value;
        } else {
          store[prop] = value;
        }

        return true;
      }
    });
  };
}
