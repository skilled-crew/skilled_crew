import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownChalk } from '../../src/libs/markdown_chalk';

function stripAnsi(str: string): string {
	return str.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('MarkdownChalk', () => {
	const md = new MarkdownChalk();

	it('returns empty string for empty input', () => {
		assert.equal(md.parse(''), '');
	});

	it('preserves plain text content in output', () => {
		const result = md.parse('Hello, world!');
		assert.match(stripAnsi(result), /Hello, world!/);
	});

	it('renders bold text and preserves the text content', () => {
		const result = md.parse('**bold text**');
		assert.match(stripAnsi(result), /bold text/);
	});

	it('renders fenced code block and preserves code content', () => {
		const result = md.parse('```\nconsole.log("hi");\n```');
		assert.match(stripAnsi(result), /console\.log/);
	});

	it('renders heading and preserves heading text', () => {
		const result = md.parse('# My Heading');
		assert.match(stripAnsi(result), /My Heading/);
	});

	it('renders unordered list items', () => {
		const result = md.parse('- First item\n- Second item');
		const plain = stripAnsi(result);
		assert.match(plain, /First item/);
		assert.match(plain, /Second item/);
	});

	it('renders ordered list items', () => {
		const result = md.parse('1. Alpha\n2. Beta');
		const plain = stripAnsi(result);
		assert.match(plain, /Alpha/);
		assert.match(plain, /Beta/);
	});

	it('renders blockquote and preserves quoted text', () => {
		const result = md.parse('> A blockquote');
		assert.match(stripAnsi(result), /A blockquote/);
	});

	it('renders inline code and preserves code content', () => {
		const result = md.parse('Use `myFunc()` to call it.');
		assert.match(stripAnsi(result), /myFunc/);
	});

	it('renders thematic break without crashing', () => {
		const result = md.parse('---');
		assert.ok(typeof result === 'string');
	});

	it('renders multiple element types without crashing', () => {
		const input = [
			'# Title',
			'',
			'A paragraph with **bold** and `code`.',
			'',
			'- Item one',
			'- Item two',
			'',
			'> A quote',
			'',
			'```ts',
			'const x = 1;',
			'```',
		].join('\n');

		const result = md.parse(input);
		const plain = stripAnsi(result);
		assert.match(plain, /Title/);
		assert.match(plain, /paragraph/);
		assert.match(plain, /Item one/);
		assert.match(plain, /A quote/);
		assert.match(plain, /const x = 1/);
	});
});
