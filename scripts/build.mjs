// @ts-check

/**
 * @fileoverview Builds the public package files from split TypeScript sources.
 */

import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = join(packageRoot, 'dist');
const distSwapLockDirectory = join(packageRoot, '.dist-swap.lock');
const tscPath = require.resolve('typescript/bin/tsc');
const GENERATED_JAVASCRIPT_BANNER =
  '// @generated - do not edit. Source: npm run build';
const DIST_SWAP_LOCK_RETRY_MS = 50;
const DIST_SWAP_LOCK_TIMEOUT_MS = 30_000;

/**
 * Temporary folders created for one build run.
 *
 * @typedef BuildDirectories
 * @property {string} declarationDirectory - temporary directory for generated declaration files.
 * @property {string} distDirectory - temporary directory that will become the public dist folder.
 */

/** Builds declaration files and bundled ESM files for the npm package. */
async function runBuild() {
  const buildDirectories = await createTemporaryBuildDirectories();

  try {
    await runBuildStep('emit declaration files', async () => {
      await execFileAsync(process.execPath, [
        tscPath,
        '-p',
        join(packageRoot, 'tsconfig.json'),
        '--emitDeclarationOnly',
        '--outDir',
        buildDirectories.declarationDirectory,
      ]);
    });

    await copyPublicDeclaration('index.d.ts', buildDirectories);
    await copyPublicDeclaration('index.d.ts.map', buildDirectories);
    await copyPublicDeclaration(
      'normalizeMarkdownTables.d.ts',
      buildDirectories,
    );
    await copyPublicDeclaration(
      'normalizeMarkdownTables.d.ts.map',
      buildDirectories,
    );
    await copyPublicDeclaration(
      'normalizer/publicTypes.d.ts',
      buildDirectories,
    );
    await copyPublicDeclaration(
      'normalizer/publicTypes.d.ts.map',
      buildDirectories,
    );

    await Promise.all([
      bundleEntry(
        'src/normalizeMarkdownTables.ts',
        'normalizeMarkdownTables.js',
        buildDirectories.distDirectory,
      ),
      bundleEntry('src/index.ts', 'index.js', buildDirectories.distDirectory, [
        './normalizeMarkdownTables.js',
        'prettier',
        'prettier/*',
      ]),
    ]);

    await runBuildStep('remove temporary declaration files', async () => {
      await rm(buildDirectories.declarationDirectory, {
        force: true,
        recursive: true,
      });
    });

    await replaceDistDirectory(buildDirectories.distDirectory);
  } catch (cause) {
    await cleanTemporaryDistDirectory(buildDirectories.distDirectory, cause);
  }
}

/**
 * Creates a unique build folder so failed builds do not remove the last good dist output.
 *
 * @returns {Promise<BuildDirectories>} temporary dist and declaration directories.
 */
async function createTemporaryBuildDirectories() {
  return runBuildStep('create a temporary dist directory', async () => {
    const temporaryDistDirectory = await mkdtemp(
      join(packageRoot, '.dist-build-'),
    );
    const temporaryDeclarationDirectory = join(
      temporaryDistDirectory,
      '.types',
    );

    await mkdir(temporaryDeclarationDirectory, { recursive: true });

    return {
      declarationDirectory: temporaryDeclarationDirectory,
      distDirectory: temporaryDistDirectory,
    };
  });
}

/**
 * Copies one generated declaration file into the public dist folder.
 *
 * @param {string} fileName - declaration file path under the temporary declaration folder.
 * @param {BuildDirectories} buildDirectories - temporary build folders for this run.
 * @returns {Promise<void>} Resolves after the declaration file is copied.
 */
async function copyPublicDeclaration(fileName, buildDirectories) {
  await runBuildStep(`copy declaration "${fileName}"`, async () => {
    const target = join(buildDirectories.distDirectory, fileName);

    await mkdir(dirname(target), { recursive: true });
    await copyFile(
      join(buildDirectories.declarationDirectory, fileName),
      target,
    );
  });
}

/**
 * Bundles one public TypeScript entry point into ESM output.
 *
 * @param {string} entryPoint - source file path from the package root.
 * @param {string} fileName - output file path under the temporary dist folder.
 * @param {string} targetDistDirectory - temporary dist folder for this run.
 * @param {ReadonlyArray<string>} external - packages or import paths esbuild should leave external.
 * @returns {Promise<void>} Resolves after esbuild writes the bundle.
 */
async function bundleEntry(
  entryPoint,
  fileName,
  targetDistDirectory,
  external = [],
) {
  await runBuildStep(`bundle "${entryPoint}"`, async () => {
    await build({
      banner: {
        js: GENERATED_JAVASCRIPT_BANNER,
      },
      bundle: true,
      entryPoints: [join(packageRoot, entryPoint)],
      external: [...external],
      format: 'esm',
      legalComments: 'none',
      outfile: join(targetDistDirectory, fileName),
      platform: 'node',
      sourcemap: true,
      sourcesContent: true,
      target: 'es2022',
    });
  });
}

/**
 * Replaces the public dist folder after every build output has been written.
 *
 * @param {string} nextDistDirectory - complete temporary dist folder.
 * @returns {Promise<void>} Resolves after the new dist folder is published.
 */
async function replaceDistDirectory(nextDistDirectory) {
  await runBuildStep('replace dist directory', async () => {
    await withDistSwapLock(async () => {
      const previousDistParentDirectory = await mkdtemp(
        join(packageRoot, '.dist-previous-'),
      );
      const previousDistDirectory = join(previousDistParentDirectory, 'dist');
      let hasPreviousDistDirectory = false;
      let shouldCleanPreviousDistParentDirectory = true;

      try {
        if (await pathExists(distDirectory)) {
          await rename(distDirectory, previousDistDirectory);
          hasPreviousDistDirectory = true;
        }

        await rename(nextDistDirectory, distDirectory);
      } catch (cause) {
        if (hasPreviousDistDirectory) {
          try {
            await rename(previousDistDirectory, distDirectory);
          } catch (restoreCause) {
            shouldCleanPreviousDistParentDirectory = false;

            throw new Error(
              'Could not restore the previous dist directory after replacing dist failed.',
              {
                cause: restoreCause,
              },
            );
          }
        }

        throw cause;
      } finally {
        if (shouldCleanPreviousDistParentDirectory) {
          await rm(previousDistParentDirectory, {
            force: true,
            recursive: true,
          });
        }
      }
    });
  });
}

/**
 * Runs the final dist swap one build at a time.
 *
 * @param {() => Promise<void>} action - work to run while this process owns the dist swap lock.
 * @returns {Promise<void>} Resolves after the locked work completes.
 */
async function withDistSwapLock(action) {
  await acquireDistSwapLock();

  try {
    await action();
  } finally {
    await rm(distSwapLockDirectory, { force: true, recursive: true });
  }
}

/**
 * Waits for any other local build to finish publishing dist.
 *
 * @returns {Promise<void>} Resolves after this process owns the lock.
 */
async function acquireDistSwapLock() {
  const startedAtMs = Date.now();

  for (;;) {
    try {
      await mkdir(distSwapLockDirectory);
      return;
    } catch (cause) {
      if (!isNodeErrorCode(cause, 'EEXIST')) {
        throw new Error('Could not create the dist swap lock.', { cause });
      }

      if (Date.now() - startedAtMs > DIST_SWAP_LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for the dist swap lock after ${String(
            DIST_SWAP_LOCK_TIMEOUT_MS,
          )}ms.`,
          { cause },
        );
      }

      await delay(DIST_SWAP_LOCK_RETRY_MS);
    }
  }
}

/**
 * Checks whether a file or directory exists.
 *
 * @param {string} path - file or directory to check.
 * @returns {Promise<boolean>} `true` when the path exists.
 */
async function pathExists(path) {
  try {
    await access(path);

    return true;
  } catch (cause) {
    if (isNodeErrorCode(cause, 'ENOENT')) {
      return false;
    }

    throw new Error(`Could not check "${path}".`, { cause });
  }
}

/**
 * Checks a Node error code without trusting the thrown value shape.
 *
 * @param {unknown} value - thrown value from a Node API.
 * @param {string} code - expected Node error code.
 * @returns {boolean} `true` when the value has the requested code.
 */
function isNodeErrorCode(value, code) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'code') === code
  );
}

/**
 * Removes failed build output without hiding cleanup failures.
 *
 * @param {string} temporaryDistDirectory - temporary dist folder to remove.
 * @param {unknown} buildFailure - original build failure.
 * @returns {Promise<never>} Always rejects with the original failure or a cleanup failure.
 */
async function cleanTemporaryDistDirectory(
  temporaryDistDirectory,
  buildFailure,
) {
  try {
    await rm(temporaryDistDirectory, { force: true, recursive: true });
  } catch (cleanupFailure) {
    throw new Error(
      'Could not clean up temporary build output after a failed build.',
      {
        cause: cleanupFailure,
      },
    );
  }

  throw buildFailure;
}

/**
 * Adds the build step name to failures without hiding the original error.
 *
 * @param {string} step - build step name added to the thrown error.
 * @template Result
 * @param {() => Promise<Result>} runStep - async work for this build step.
 * @returns {Promise<Result>} Resolves with the build step result.
 */
async function runBuildStep(step, runStep) {
  try {
    return await runStep();
  } catch (cause) {
    throw new Error(`Could not ${step}.`, { cause });
  }
}

await runBuild();
