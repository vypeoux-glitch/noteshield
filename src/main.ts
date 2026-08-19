import { Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, NoteShieldSettingTab } from './settings.ts';
import type { NoteShieldSettings } from './settings.ts';
import { buildReport, reportFileName } from './report.ts';
import { isIgnoredPath, scanText, summarise } from './scanner.ts';
import type { FileFindings, ScanSummary } from './scanner.ts';
import { NoteShieldView, VIEW_TYPE_NOTESHIELD } from './view.ts';

export default class NoteShieldPlugin extends Plugin {
	settings: NoteShieldSettings = DEFAULT_SETTINGS;
	private lastSummary: ScanSummary | null = null;
	private statusBar: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_NOTESHIELD,
			(leaf) => new NoteShieldView(leaf, () => this.exportReport()),
		);

		this.addRibbonIcon('shield-alert', 'NoteShield: scan vault', () => {
			void this.scanVault();
		});

		this.statusBar = this.addStatusBarItem();

		this.addCommand({
			id: 'scan-vault',
			name: 'Scan vault',
			callback: () => {
				void this.scanVault();
			},
		});

		this.addCommand({
			id: 'scan-current-note',
			name: 'Scan current note',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.scanFiles([file], `“${file.basename}”`);
				return true;
			},
		});

		this.addCommand({
			id: 'export-report',
			name: 'Save last report to vault',
			checkCallback: (checking: boolean) => {
				if (!this.lastSummary) return false;
				if (!checking) void this.exportReport();
				return true;
			},
		});

		this.addSettingTab(new NoteShieldSettingTab(this.app, this));

		if (this.settings.scanOnSave) {
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						void this.quietCheck(file);
					}
				}),
			);
		}
	}

	async onunload(): Promise<void> {
		// Views are unregistered by Obsidian; nothing else holds resources.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private scanOptions(): { enabledRules: Set<string>; redaction: 'partial' | 'full' } {
		return {
			enabledRules: new Set(this.settings.enabledRules),
			redaction: this.settings.redaction,
		};
	}

	private async scanVault(): Promise<void> {
		const candidates = this.app.vault
			.getMarkdownFiles()
			.filter((file) => !isIgnoredPath(file.path, this.settings.ignoredPaths))
			.filter((file) => file.stat.size <= this.settings.maxFileSizeKb * 1024);
		await this.scanFiles(candidates, 'vault');
	}

	private async scanFiles(files: TFile[], what: string): Promise<void> {
		const notice = new Notice(`NoteShield: scanning ${what}…`, 0);
		const options = this.scanOptions();
		const results: FileFindings[] = [];
		try {
			for (const file of files) {
				const text = await this.app.vault.cachedRead(file);
				const findings = scanText(text, options);
				if (findings.length > 0) results.push({ path: file.path, findings });
			}
		} finally {
			notice.hide();
		}

		this.lastSummary = summarise(results, files.length);
		await this.showResults(this.lastSummary);
		this.updateStatusBar(this.lastSummary);
		new Notice(
			this.lastSummary.total === 0
				? `NoteShield: nothing found in ${files.length} note(s).`
				: `NoteShield: ${this.lastSummary.total} finding(s) in ${this.lastSummary.filesWithFindings} note(s).`,
		);
	}

	/** Save-time check: status bar only. Nothing that interrupts writing. */
	private async quietCheck(file: TFile): Promise<void> {
		if (isIgnoredPath(file.path, this.settings.ignoredPaths)) return;
		const text = await this.app.vault.cachedRead(file);
		const findings = scanText(text, this.scanOptions());
		if (!this.statusBar) return;
		this.statusBar.setText(
			findings.length === 0 ? '' : `NoteShield: ${findings.length} in this note`,
		);
	}

	private updateStatusBar(summary: ScanSummary): void {
		if (!this.statusBar) return;
		this.statusBar.setText(summary.total === 0 ? 'NoteShield: clean' : `NoteShield: ${summary.total}`);
	}

	private async showResults(summary: ScanSummary): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_NOTESHIELD)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: VIEW_TYPE_NOTESHIELD, active: true });
			leaf = right;
		}
		const view = leaf.view;
		if (view instanceof NoteShieldView) view.setSummary(summary);
		workspace.revealLeaf(leaf);
	}

	private async exportReport(): Promise<void> {
		if (!this.lastSummary) {
			new Notice('NoteShield: run a scan first.');
			return;
		}
		const now = new Date();
		const folder = this.settings.reportFolder.replace(/^\/+|\/+$/g, '');
		if (folder && !this.app.vault.getFolderByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const path = (folder ? folder + '/' : '') + reportFileName(now);
		const markdown = buildReport(this.lastSummary, {
			vaultName: this.app.vault.getName(),
			generatedAt: now,
		});
		const file = await this.app.vault.create(path, markdown);
		new Notice(`NoteShield: report saved to ${path}`);
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
