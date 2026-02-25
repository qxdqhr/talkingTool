import { registerRootComponent } from "expo";
import { LogBox } from "react-native";

LogBox.ignoreLogs([
  "new NativeEventEmitter() was called with a non-null argument",
  "new NativeEventEmitter() was called with a non-null argument without the required addListener method.",
  "new NativeEventEmitter() was called with a non-null argument without the required removeListeners method.",
  "`new NativeEventEmitter()` was called with a non-null argument without the required `addListener` method.",
  "`new NativeEventEmitter()` was called with a non-null argument without the required `removeListeners` method.",
]);

const App = require("./App").default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
