import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { PACK_LABELS, RULES } from './rules.ts';
import type { RulePack } from './rules.ts';
import type NoteShieldPlugin from './main.ts';

export interface NoteShieldSettings {
	enabledRules: string[];
	ignoredPaths: string[];
	redaction: 'partial' | 'full';
	/** Notes above this size are skipped — they are almost always exports or pasted dumps. */
	maxFileSizeKb: number;
	/** Scan the note you just edited, quietly, and only report on it. */
	scanOnSave: boolean;
	reportFolder: string;
}

export const DEFAULT_SETTINGS: NoteShieldSettings = {
	enabledRules: RULES.map((rule) => rule.id),
	ignoredPaths: ['Templates', 'Archive/**'],
	redaction: 'partial',
	maxFileSizeKb: 512,
	scanOnSave: false,
	reportFolder: '',
};

export class NoteShieldSettingTab extends PluginSettingTab {
	private plugin: NoteShieldPlugin;

	constructor(app: App, plugin: NoteShieldPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', {
			text:
				'NoteShield scans your vault locally. It makes no network requests, sends no telemetry ' +
				'and never writes an unredacted value into a report.',
			cls: 'noteshield-settings-intro',
		});

		new Setting(containerEl)
			.setName('Redaction in reports and results')
			.setDesc('Partial keeps the first and last characters so you can recognise the value.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('partial', 'Partial (ab••••••yz)')
					.addOption('full', 'Full (••••••)')
					.setValue(this.plugin.settings.redaction)
					.onChange(async (value) => {
						this.plugin.settings.redaction = value === 'full' ? 'full' : 'partial';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Ignored paths')
			.setDesc('One per line. Supports * inside a folder name and ** across folders.')
			.addTextArea((text) =>
				text
					.setPlaceholder('Templates\nArchive/**')
					.setValue(this.plugin.settings.ignoredPaths.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.ignoredPaths = value
							.split('\n')
							.map((line) => line.trim())
							.filter((line) => line.length > 0);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Skip notes larger than')
			.setDesc('In kilobytes. Large pasted exports slow a scan down for little value.')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.maxFileSizeKb))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (Number.isFinite(parsed) && parsed > 0) {
							this.plugin.settings.maxFileSizeKb = Math.floor(parsed);
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Report folder')
			.setDesc('Where saved reports go. Empty means the vault root.')
			.addText((text) =>
				text
					.setPlaceholder('Audits')
					.setValue(this.plugin.settings.reportFolder)
					.onChange(async (value) => {
						this.plugin.settings.reportFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Check a note when it is saved')
			.setDesc('Only the edited note, and only a status bar count — no popups while you write.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.scanOnSave).onChange(async (value) => {
					this.plugin.settings.scanOnSave = value;
					await this.plugin.saveSettings();
				}),
			);

		// Headings go through Setting().setHeading() — the community review guidelines ask for it,
		// and it keeps the spacing consistent with every other plugin's settings tab.
		new Setting(containerEl).setName('Rules').setHeading();

		const packs = Object.keys(PACK_LABELS) as RulePack[];
		for (const pack of packs) {
			new Setting(containerEl).setName(PACK_LABELS[pack]).setHeading();
			for (const rule of RULES.filter((r) => r.pack === pack)) {
				new Setting(containerEl)
					.setName(`${rule.label} · ${rule.severity}`)
					.setDesc(rule.why)
					.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.enabledRules.includes(rule.id))
							.onChange(async (value) => {
								const enabled = new Set(this.plugin.settings.enabledRules);
								if (value) enabled.add(rule.id);
								else enabled.delete(rule.id);
								this.plugin.settings.enabledRules = [...enabled];
								await this.plugin.saveSettings();
							}),
					);
			}
		}
	}
}
