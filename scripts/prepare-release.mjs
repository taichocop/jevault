import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";

const assets = ["main.js", "manifest.json", "styles.css"];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareVersions(left, right) {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

export async function prepareRelease(root, tag) {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const versions = JSON.parse(await readFile(path.join(root, "versions.json"), "utf8"));
  const version = manifest.version;
  if (typeof version !== "string" || !versionPattern.test(version) || pkg.version !== version) {
    throw new Error("Manifest and package versions must match and use a plain SemVer tag.");
  }
  if (tag !== undefined && tag !== version) {
    throw new Error("Release tag must exactly match the manifest version.");
  }
  if (versions === null || typeof versions !== "object" || Array.isArray(versions)) {
    throw new Error("versions.json must be a version-to-minAppVersion object.");
  }
  const mappedVersions = Object.keys(versions);
  if (mappedVersions.some((mappedVersion) => !versionPattern.test(mappedVersion))) {
    throw new Error("versions.json contains a non-SemVer version key.");
  }
  if (Object.hasOwn(versions, version)) {
    if (versions[version] !== manifest.minAppVersion) {
      throw new Error("versions.json minAppVersion conflicts with the manifest.");
    }
  } else {
    // versions.json は互換性の変更点だけを持つため、直前の有効な設定と比較する。
    const latestPrior = mappedVersions
      .filter((mappedVersion) => compareVersions(mappedVersion, version) < 0)
      .reduce((latest, candidate) =>
        latest === undefined || compareVersions(candidate, latest) > 0 ? candidate : latest,
      undefined);
    if (latestPrior === undefined) {
      throw new Error("versions.json needs a compatibility mapping for this release.");
    }
    if (versions[latestPrior] !== manifest.minAppVersion) {
      throw new Error("minAppVersion changed; versions.json requires an entry for this release.");
    }
  }

  const stage = path.join(root, "release-assets");
  for (const name of assets) {
    const source = path.join(root, name);
    const info = await lstat(source);
    if (!info.isFile() || info.size === 0) {
      throw new Error(`${name} must be a nonempty regular file.`);
    }
  }
  await mkdir(stage);
  const hashes = [];
  for (const name of assets) {
    const source = path.join(root, name);
    const target = path.join(stage, name);
    await copyFile(source, target);
    const bytes = await readFile(target);
    hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  release-assets/${name}`);
  }
  const staged = (await readdir(stage)).sort();
  if (staged.join("\n") !== [...assets].sort().join("\n")) {
    throw new Error("Unexpected release asset.");
  }
  await writeFile(path.join(root, "release-assets.sha256"), `${hashes.join("\n")}\n`);
  return { version, assets: staged };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const tag = process.argv[2];
  try {
    const result = await prepareRelease(root, tag);
    console.log(`Prepared ${result.version}: ${result.assets.join(", ")}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
