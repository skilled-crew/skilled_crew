// npm imports
import Chalk from 'chalk';
import * as Remark from 'remark';
import type {
	Root, Node, Heading, Paragraph, Text, Strong, Emphasis, InlineCode, Code, List, ListItem, Blockquote,
	Link, Image,
} from 'mdast';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class MarkdownChalk {
	/**
	 * Parses the given markdown string and returns a chalk-styled string.
	 * @param markdown The markdown string to parse.
	 * @returns A chalk-styled string representing the rendered markdown.
	 */
	parse(markdown: string): string {
		const tree = Remark.remark().parse(markdown) as Root;
		return this.renderBlock(tree, 0).trimEnd();
	}

	private renderBlock(node: Node, indent: number): string {
		switch (node.type) {
			case 'root': {
				const root = node as Root;
				return root.children.map(child => this.renderBlock(child, indent)).join('\n');
			}

			case 'heading': {
				const h = node as Heading;
				const text = h.children.map(c => this.renderInline(c)).join('');
				const headingColors = [
					Chalk.bold.magenta,
					Chalk.bold.cyan,
					Chalk.bold.blue,
					Chalk.bold.green,
					Chalk.bold.yellow,
					Chalk.bold.red,
				];
				const color = headingColors[Math.min(h.depth - 1, headingColors.length - 1)];
				return '\n' + color('#'.repeat(h.depth) + ' ' + text) + '\n';
			}

			case 'paragraph': {
				const p = node as Paragraph;
				const pad = ' '.repeat(indent);
				const text = p.children.map(c => this.renderInline(c)).join('');
				return pad + text;
			}

			case 'list': {
				const l = node as List;
				return l.children
					.map((item, i) =>
						this.renderListItem(item as ListItem, indent, l.ordered ? (l.start ?? 1) + i : null)
					)
					.join('\n');
			}

			case 'code': {
				const c = node as Code;
				const langLabel = c.lang ? Chalk.dim(` ${c.lang}`) : '';
				const bar = Chalk.dim('```') + langLabel;
				const lines = c.value
					.split('\n')
					.map(line => '  ' + Chalk.green(line))
					.join('\n');
				return bar + '\n' + lines + '\n' + Chalk.dim('```');
			}

			case 'blockquote': {
				const bq = node as Blockquote;
				const inner = bq.children.map(c => this.renderBlock(c, 0)).join('\n');
				return inner
					.split('\n')
					.map(line => Chalk.gray('▎ ') + Chalk.italic(Chalk.gray(line)))
					.join('\n');
			}

			case 'thematicBreak':
				return Chalk.dim('─'.repeat(40));

			default:
				return '';
		}
	}

	private renderListItem(item: ListItem, indent: number, ordinal: number | null): string {
		const pad = '  '.repeat(indent);
		const bullet =
			ordinal !== null ? Chalk.bold.cyan(`${ordinal}.`) : Chalk.bold.cyan('•');
		const prefix = pad + bullet + ' ';

		const lines: string[] = [];
		for (const child of item.children) {
			if (child.type === 'paragraph') {
				const text = (child as Paragraph).children.map(c => this.renderInline(c)).join('');
				lines.push(text);
			} else if (child.type === 'list') {
				lines.push('\n' + this.renderBlock(child, indent + 1));
			} else {
				lines.push(this.renderBlock(child, indent + 1));
			}
		}

		return prefix + lines.join('\n' + ' '.repeat(prefix.length));
	}

	private renderInline(node: Node): string {
		switch (node.type) {
			case 'text':
				return (node as Text).value;

			case 'strong':
				return Chalk.bold(
					(node as Strong).children.map(c => this.renderInline(c)).join('')
				);

			case 'emphasis':
				return Chalk.italic(
					(node as Emphasis).children.map(c => this.renderInline(c)).join('')
				);

			case 'inlineCode':
				return Chalk.yellow((node as InlineCode).value);

			case 'link': {
				const l = node as Link;
				const text = l.children.map(c => this.renderInline(c)).join('');
				return Chalk.blue.underline(text) + Chalk.dim(` (${l.url})`);
			}

			case 'image': {
				const img = node as Image;
				return Chalk.dim(`[image: ${img.alt || img.url}]`);
			}

			case 'break':
				return '\n';

			default:
				return '';
		}
	}
}


///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////


// --- minitest ---
if (import.meta.url === `file://${process.argv[1]}`) {
	const sample = [
		'# Hello World',
		'',
		'This is a **bold** and _italic_ paragraph with `inlineCode` and a [link](https://example.com).',
		'',
		'## Features',
		'',
		'- Item one',
		'- Item **two** with emphasis',
		'  - Nested item',
		'  - Another nested',
		'',
		'1. First ordered',
		'2. Second ordered',
		'',
		'> A blockquote with _italic_ text.',
		'',
		'```typescript',
		'const x: number = 42;',
		'console.log(x);',
		'```',
		'',
		'---',
		'',
		'### Done',
	].join('\n');

	const result = new MarkdownChalk().parse(sample);
	console.log(result);
}
