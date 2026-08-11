#!/usr/bin/env bash
# Installs the packed tarball into a throwaway project and exercises it as a consumer
# would. This is the check that catches a runtime import of a package that was only ever
# a development dependency: it is invisible to the test suite, which resolves from the
# repository's own node_modules.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

npm run build >/dev/null
tarball="$root/$(npm pack --silent)"
work="$(mktemp -d)"
trap 'rm -rf "$work"; rm -f "$tarball"' EXIT

cd "$work"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "$tarball" >/dev/null

echo "--- core entry, with no jsdom installed ---"
test ! -d node_modules/jsdom || { echo "FAIL: jsdom was pulled in transitively"; exit 1; }
node --input-type=module -e '
  import { analyse, toText, CATALOGUE_VERSION } from "formfair";
  const r = analyse(`<input name="firstName" pattern="[A-Za-z]{2,40}" maxlength="40">`);
  const fired = r.findings.map((f) => f.rule).sort().join(",");
  if (fired !== "FF-01,FF-04,FF-05") throw new Error(`unexpected findings: ${fired}`);
  const codes = r.advisories.map((a) => a.code);
  if (!codes.includes("ADV-NORM-BOUNDARY")) throw new Error(`missing advisory: ${codes}`);
  toText(r);
  console.log(`core ok, catalogue ${CATALOGUE_VERSION}`);
'

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "--- skipping formfair/node: jsdom needs Node 22.22.2 or newer, this is $(node -v) ---"
  exit 0
fi

echo "--- formfair/node, after installing the optional peer ---"
npm install --silent --no-audit --no-fund jsdom >/dev/null
node --input-type=module -e '
  import { analyseWith } from "formfair";
  import { axeProvider } from "formfair/node";
  const html = `<form><input name="firstName" pattern="[A-Za-z]+"></form>`;
  const r = await analyseWith(html, axeProvider());
  if (r.delegated.engine !== "axe-core") throw new Error("delegation did not run");
  if (!/^\d+\.\d+\.\d+/.test(r.delegated.engineVersion)) throw new Error("no engine version");
  console.log(`formfair/node ok, axe-core ${r.delegated.engineVersion}`);
'
