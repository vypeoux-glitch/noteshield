import { ItemView, MarkdownView, Notice } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { SEVERITY_ORDER } from './rules.ts';
import type { Severity } from './rules.ts';
import type { ScanSummary } from './scanner.ts';

export const VIEW_TYPE_NOTESHIELD = 'noteshield-results';

const SEVERITY_LABEL: Record<Severity, string> = {
	critical: 'Critical',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
};

/**
 * Results panel.
 *
 * Deliberately a list of jump targets rather than a dashboard: the only useful action after a
 * scan is "take me to that line so I can decide", and every click here does exactly that.
 */
export class NoteShieldView extends ItemView {
	private summary: ScanSummary | null = null;
	private onExport: () => Promise<void>;

	constructor(leaf: WorkspaceLeaf, onExport: () => Promise<void>) {
		super(leaf);
		this.onExport = onExport;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTESHIELD;
	}

	getDisplayText(): string {
		return 'NoteShield';
	}

	getIcon(): string {
		return 'shield-alert';
	}

	setSummary(summary: ScanSummary): void {
		this.summary = summary;
		this.render();
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('noteshield-panel');

		if (!this.summary) {
			container.createEl('p', {
				text: 'Run "NoteShield: Scan vault" to check your notes for sensitive data.',
			});
			return;
		}

		const header = container.createDiv({ cls: 'noteshield-header' });
		header.createEl('h3', { text: 'NoteShield' });
		header.createEl('p', {
			text: `${this.summary.total} finding(s) in ${this.summary.filesWithFindings} of ${this.summary.filesScanned} note(s).`,
		});

		const counts = header.createDiv({ cls: 'noteshield-counts' });
		for (const severity of Object.keys(SEVERITY_ORDER) as Severity[]) {
			const count = this.summary.bySeverity[severity];
			if (count === 0) continue;
			counts.createSpan({
				cls: `noteshield-chip noteshield-${severity}`,
				text: `${SEVERITY_LABEL[severity]}: ${count}`,
			});
		}

		if (this.summary.total === 0) {
			container.createEl('p', { text: 'Nothing matched the enabled rules.' });
			return;
		}

		const exportButton = header.createEl('button', { text: 'Save report to vault' });
		exportButton.addEventListener('click', () => {
			void this.onExport();
		});

		for (const file of this.summary.files) {
			const section = container.createDiv({ cls: 'noteshield-file' });
			section.createDiv({ cls: 'noteshield-file-path', text: file.path });
			for (const finding of file.findings) {
				const row = section.createDiv({ cls: 'noteshield-finding' });
				row.createSpan({
					cls: `noteshield-dot noteshield-${finding.severity}`,
					text: '●',
				});
				row.createSpan({ cls: 'noteshield-rule', text: finding.ruleLabel });
				row.createSpan({ cls: 'noteshield-excerpt', text: finding.excerpt });
				row.createSpan({ cls: 'noteshield-line', text: `:${finding.line}` });
				row.addEventListener('click', () => {
					void this.reveal(file.path, finding.line, finding.column);
				});
			}
		}
	}

	private async reveal(path: string, line: number, column: number): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice(`NoteShield: ${path} is no longer in the vault.`);
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			view.editor.setCursor({ line: line - 1, ch: Math.max(column - 1, 0) });
			view.editor.scrollIntoView(
				{ from: { line: line - 1, ch: 0 }, to: { line: line - 1, ch: 0 } },
				true,
			);
		}
	}
}
