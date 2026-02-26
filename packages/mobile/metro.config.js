const path = require("path");

// 修复 monorepo 模块解析：确保被提升到根目录的 nativewind 能找到 react-native
const mobileModules = path.resolve(__dirname, "node_modules");
process.env.NODE_PATH = process.env.NODE_PATH
  ? mobileModules + path.delimiter + process.env.NODE_PATH
  : mobileModules;
require("module").Module._initPaths();

if (!Array.prototype.toReversed) {
  Object.defineProperty(Array.prototype, "toReversed", {
    value: function () {
      return this.slice().reverse();
    },
    writable: true,
    configurable: true,
  });
}

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// monorepo 需要 watch 根目录以支持跨包引用
config.watchFolders = [workspaceRoot];

// 同时从本地和根目录 node_modules 解析依赖
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 支持 bin 资源（如模型文件）
config.resolver.assetExts = [...(config.resolver.assetExts || []), "bin"];

module.exports = withNativeWind(config, { input: "./global.css" });
