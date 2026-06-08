const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const rootNodeModules = path.join(workspaceRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, rootNodeModules];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [rootNodeModules];
config.resolver.extraNodeModules = {
  react: path.join(rootNodeModules, "react"),
  "react/jsx-runtime": path.join(rootNodeModules, "react/jsx-runtime"),
  "react/jsx-dev-runtime": path.join(rootNodeModules, "react/jsx-dev-runtime"),
  "react-native": path.join(rootNodeModules, "react-native"),
  expo: path.join(rootNodeModules, "expo")
};

module.exports = config;
