#!/usr/bin/env bun
/**
 * Builds the node-runnable `dist/` this package ships to npm.
 *
 * Bundles every CLI entrypoint + the library barrel with Bun.build (target: "node", format:
 * "esm"), leaving the runtime deps (@modelcontextprotocol/sdk, oauth-1.0a, zod, dotenv) external
 * so they resolve from the consumer's node_modules instead of being inlined. All entrypoints live
 * directly in src/, so Bun.build's shared-root output naming lands flat at dist/<name>.js — never
 * dist/src/<name>.js (src/mcp.ts relies on this: it locates ../package.json relative to its own
 * compiled location, which only resolves correctly one path segment below the package root).
 *
 * Bun.build strips or leaves shebangs inconsistently across entrypoints, so every CLI output gets
 * its leading line normalized to `#!/usr/bin/env node` (never the bundler's own emission, never
 * `#!/usr/bin/env bun` — this dist ships to plain `node` via `npx -y etrade-mcp`) and chmod 755.
 * `src/index.ts` is a plain importable library module, not a CLI: no shebang, no exec bit.
 *
 * Run via `bun run build` (`bun scripts/build.ts`); also invoked automatically by
 * `prepublishOnly` before every `npm publish`. dist/ stays gitignored — it is build output, never
 * committed.
 */
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(ROOT, "dist");

// name -> whether it's a CLI (gets the node shebang + exec bit) or a plain library module.
const ENTRYPOINTS: Record<string, { src: string; bin: boolean }> = {
	mcp: { src: "src/mcp.ts", bin: true },
	auth: { src: "src/auth.ts", bin: true },
	"auth-start": { src: "src/auth-start.ts", bin: true },
	"auth-finish": { src: "src/auth-finish.ts", bin: true },
	"auth-renew-cli": { src: "src/auth-renew-cli.ts", bin: true },
	"totp-cli": { src: "src/totp-cli.ts", bin: true },
	"login-fill": { src: "src/login-fill.ts", bin: true },
	index: { src: "src/index.ts", bin: false },
};

const EXTERNAL = [
	"@modelcontextprotocol/sdk",
	"@modelcontextprotocol/sdk/*",
	"oauth-1.0a",
	"zod",
	"dotenv",
];

const SHEBANG_RE = /^#!.*\n/;
const NODE_SHEBANG = "#!/usr/bin/env node\n";

async function main() {
	rmSync(DIST, { recursive: true, force: true });
	mkdirSync(DIST, { recursive: true });

	const entrypoints = Object.values(ENTRYPOINTS).map((e) => resolve(ROOT, e.src));

	const result = await Bun.build({
		entrypoints,
		outdir: DIST,
		target: "node",
		format: "esm",
		external: EXTERNAL,
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		console.error("[build] ✗ Bun.build failed");
		process.exit(1);
	}

	// Verify the flat-dist contract before touching shebangs, so a future entrypoint added under a
	// subdirectory (which would break the ../package.json resolution in mcp.ts) fails loudly here
	// rather than shipping a broken bin.
	for (const [name, meta] of Object.entries(ENTRYPOINTS)) {
		const outPath = resolve(DIST, `${name}.js`);
		let content: string;
		try {
			content = readFileSync(outPath, "utf8");
		} catch {
			console.error(`[build] ✗ expected flat output missing: dist/${name}.js (from ${meta.src})`);
			process.exit(1);
		}

		if (meta.bin) {
			const stripped = content.replace(SHEBANG_RE, "");
			writeFileSync(outPath, NODE_SHEBANG + stripped);
			chmodSync(outPath, 0o755);
		}
	}

	const built = Object.keys(ENTRYPOINTS)
		.map((n) => `dist/${n}.js`)
		.join(", ");
	console.error(`[build] ✓ ${result.outputs.length} output(s): ${built}`);
}

async function buildTypes() {
	const tsc = Bun.spawn(
		[resolve(ROOT, "node_modules/.bin/tsc"), "--project", "tsconfig.build.json"],
		{ cwd: ROOT, stdout: "inherit", stderr: "inherit" },
	);
	const code = await tsc.exited;
	if (code !== 0) {
		console.error("[build] ✗ declaration emit (tsc --project tsconfig.build.json) failed");
		process.exit(code);
	}
	console.error("[build] ✓ dist/index.d.ts (+ per-module .d.ts) emitted");
}

await main();
await buildTypes();
