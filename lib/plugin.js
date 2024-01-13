export default function piniafirePlugin(pluginOptions) {
  return ({ store, options }) => {
    if (!options.__piniafire) return;

    const {
      onValidationSuccess,
      onValidationError,
      appendToCreated,
      appendToUpdated
    } = pluginOptions;

    store._globalOptions = {
      onValidationSuccess,
      onValidationError,
      appendToCreated,
      appendToUpdated,
    };
  }
}
