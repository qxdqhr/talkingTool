const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const serverDir = path.join(root, "packages", "server");
const desktopResourcesDir = path.join(
  root,
  "packages",
  "desktop",
  "resources",
  "server",
);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd, cwd = root) {
  execSync(cmd, { stdio: "inherit", cwd });
}

if (!fs.existsSync(serverDir)) {
  console.error("Server package not found:", serverDir);
  process.exit(1);
}

console.log("Building server...");
run("npm run server:build");

console.log("Installing server production dependencies...");
run("npm install --omit=dev --no-package-lock --prefix " + serverDir);

const distDir = path.join(serverDir, "dist");
const nodeModulesDir = path.join(serverDir, "node_modules");
const packageJson = path.join(serverDir, "package.json");

if (!fs.existsSync(distDir)) {
  console.error("Server dist not found:", distDir);
  process.exit(1);
}

if (!fs.existsSync(nodeModulesDir)) {
  console.error("Server node_modules not found:", nodeModulesDir);
  process.exit(1);
}

console.log("Copying server bundle into desktop resources...");
cleanDir(desktopResourcesDir);
ensureDir(desktopResourcesDir);

copyDir(distDir, path.join(desktopResourcesDir, "dist"));
copyDir(nodeModulesDir, path.join(desktopResourcesDir, "node_modules"));
fs.copyFileSync(packageJson, path.join(desktopResourcesDir, "package.json"));

console.log("Server bundle ready:", desktopResourcesDir);
