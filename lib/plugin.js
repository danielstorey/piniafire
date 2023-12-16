import { markRaw } from 'vue';

export default function piniafirePlugin(pluginOptions) {
  if (pluginOptions?.db.type !== 'firestore') {
    throw new Error(`'error initializing. options['db'] must be a Firestore instance'`);
  }

  return ({ store, options }) => {
    if (!options.__piniafire) return;

    const {
      db,
      onValidationSuccess,
      onValidationError,
      appendToCreated,
      appendToUpdated
    } = pluginOptions;

    store._db = markRaw(db);
    store._globalOptions = {
      onValidationSuccess,
      onValidationError,
      appendToCreated,
      appendToUpdated,
    };
  }
}
