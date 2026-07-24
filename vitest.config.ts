import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

function parseSkillMd(content: string) {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	const frontmatter = match?.[1] ?? '';
	const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? 'skill';
	const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? name;
	return { name, description, instructions: content };
}

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
	},
	plugins: [
		{
			name: 'flue-md-skill-loader',
			enforce: 'pre',
			load(id) {
				if (id.endsWith('.md') && id.includes('.flue/')) {
					const content = readFileSync(id, 'utf8');
					if (id.endsWith('SKILL.md')) {
						return `export default ${JSON.stringify(parseSkillMd(content))};`;
					}
					return `export default ${JSON.stringify(content)};`;
				}
			},
		},
	],
});
