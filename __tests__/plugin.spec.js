import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createApp } from 'vue';
import { createPinia, setActivePinia, defineStore } from 'pinia';
import { getDB, setUserId, } from './utils/firebase';
import { piniafirePlugin, defineFirebaseStore } from '..';


let db;
let app;
let pinia;

beforeAll(async() => {
  setUserId('user');
  db = await getDB();
})

beforeEach(async() => {
  app = createApp();
  pinia = createPinia();
  app.use(pinia);
});

describe('plugin', () => {
  it(`should throw an error if the 'db' property is not defined`, () => {
    const initializeWithError = () => pinia.use(piniafirePlugin());

    expect(initializeWithError).toThrow();
  });

  it('should not initialize on a regular pinia store', () => {
    const pinia = createPinia();
    pinia.use(piniafirePlugin({ db }));

    const useStore = defineStore({});
    const store = useStore();

    expect(store._db).toBe(undefined);
  });

  it('should initialize the store', () => {
    pinia.use(piniafirePlugin({ db }))

    const useStore = defineFirebaseStore({ id: 'storeId' });
    const store = useStore();

    expect(store._db).not.toBe(undefined);
    expect(typeof store._globalOptions.onValidationSuccess).toBe('undefined');
    expect(typeof store._globalOptions.onValidationError).toBe('undefined');
    expect(typeof store._globalOptions.appendToCreated).toBe('undefined');
    expect(typeof store._globalOptions.appendToUpdated).toBe('undefined');
  });

  it('should initialize the store with the globalOptions', () => {
    pinia.use(piniafirePlugin({
      db,
      onValidationSuccess: vi.fn(),
      onValidationError: vi.fn(),
      appendToCreated: vi.fn(),
      appendToUpdated: vi.fn(),
    }))

    const useStore = defineFirebaseStore({ id: 'storeId' });
    const store = useStore();

    expect(store._db).not.toBe(undefined);
    expect(typeof store._globalOptions.onValidationSuccess).toBe('function');
    expect(typeof store._globalOptions.onValidationError).toBe('function');
    expect(typeof store._globalOptions.appendToCreated).toBe('function');
    expect(typeof store._globalOptions.appendToUpdated).toBe('function');
  });

  it('should call the global handlers', () => {
    const onValidationSuccess = vi.fn();
    const onValidationError = vi.fn();
    const appendToCreated = () => ({ createdBy: 'user1' });
    const appendToUpdated = () => ({ updatedBy: 'user2' });

    pinia.use(piniafirePlugin({
      db,
      onValidationSuccess,
      onValidationError,
      appendToCreated,
      appendToUpdated
    }));

    const useStore = defineFirebaseStore({ id: 'storeId' });
    const store = useStore();

    store._onValidationSuccess('path');
    store._onValidationError('path', 'error message');

    expect(onValidationSuccess).toBeCalledWith('storeId', 'path');
    expect(onValidationError).toBeCalledWith('storeId', 'path', 'error message');
    expect(store._appendToCreated().createdBy).toBe('user1');
    expect(store._appendToUpdated().updatedBy).toBe('user2');
  });

  it('should override the global handlers with local options', () => {
    const onValidationSuccess = vi.fn();
    const onValidationError = vi.fn();
    const appendToCreated = () => ({ createdBy: 'user3' });
    const appendToUpdated = () => ({ updatedBy: 'user4' });

    pinia.use(piniafirePlugin({
      db,
      onValidationSuccess: vi.fn(),
      onValidationError: vi.fn(),
      appendToCreated: vi.fn(),
      appendToUpdated: vi.fn(),
    }))

    const useStore = defineFirebaseStore({
      id: 'storeId',
      onValidationSuccess,
      onValidationError,
      appendToCreated,
      appendToUpdated
    });
    const store = useStore();

    store._onValidationSuccess('path');
    store._onValidationError('path', 'error');

    expect(onValidationSuccess).toBeCalledWith('storeId', 'path');
    expect(onValidationError).toBeCalledWith('storeId', 'path', 'error');
    expect(store._appendToCreated().createdBy).toBe('user3');
    expect(store._appendToUpdated().updatedBy).toBe('user4');
  });
})
