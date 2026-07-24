import type { SandboxFactory, SessionEnv } from '@flue/runtime';

function createNoopSessionEnv(): SessionEnv {
	const unavailable =
		(operation: string) => async (): Promise<never> => {
			throw new Error(`[research] ${operation} is unavailable in the research-only sandbox`);
		};

	return {
		cwd: '/',
		resolvePath: (path) => path,
		exec: unavailable('exec'),
		readFile: unavailable('readFile'),
		readFileBuffer: unavailable('readFileBuffer'),
		writeFile: unavailable('writeFile'),
		stat: unavailable('stat'),
		readdir: unavailable('readdir'),
		// Skill discovery probes paths with exists(); return false instead of throwing.
		exists: async () => false,
		mkdir: unavailable('mkdir'),
		rm: unavailable('rm'),
	};
}

/**
 * Sandbox that disables Flue's default bash/read/write/grep/glob tools.
 * Research agents receive only the tools passed to session.task().
 */
export function researchOnlySandbox(): SandboxFactory {
	return {
		createSessionEnv: async () => createNoopSessionEnv(),
		tools: () => [],
	};
}
