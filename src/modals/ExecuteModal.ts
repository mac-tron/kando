import { App, Modal, Setting, Notice } from 'obsidian';
import { VKGitBranch, VKExecutorOption } from '../types';

export class ExecuteModal extends Modal {
	private title: string;
	private branches: VKGitBranch[];
	private executorOptions: VKExecutorOption[];
	private selectedExecutor: string;
	private selectedVariant: string;
	private selectedBranch: string;
	private onSubmit: (executor: string, variant: string | null, branch: string) => Promise<void>;
	private variantDropdownEl: HTMLSelectElement | null = null;

	constructor(
		app: App,
		title: string,
		branches: VKGitBranch[],
		executorOptions: VKExecutorOption[],
		defaultExecutor: string,
		defaultVariant: string,
		defaultBranch: string,
		onSubmit: (executor: string, variant: string | null, branch: string) => Promise<void>
	) {
		super(app);
		this.title = title;
		this.branches = branches;
		this.executorOptions = executorOptions;
		this.selectedExecutor = defaultExecutor;
		this.selectedVariant = defaultVariant;
		this.selectedBranch = defaultBranch;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;

		// Add keyboard navigation
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});

		contentEl.createEl('h2', { text: 'Execute in Vibe Kanban' });

		// Feature title
		new Setting(contentEl)
			.setName('Feature')
			.addText((text) => {
				text.setValue(this.title);
				text.setDisabled(true);
			});

		// Executor selector
		new Setting(contentEl)
			.setName('Executor')
			.setDesc('The AI agent that will work on this task')
			.addDropdown((dropdown) => {
				for (const option of this.executorOptions) {
					dropdown.addOption(option.executor, option.executor.replace(/_/g, ' '));
				}
				dropdown.setValue(this.selectedExecutor);
				dropdown.onChange((value) => {
					this.selectedExecutor = value;
					this.updateVariantDropdown();
				});
			});

		// Variant selector
		const variantSetting = new Setting(contentEl)
			.setName('Variant')
			.setDesc('Configuration variant for the executor');

		variantSetting.addDropdown((dropdown) => {
			this.variantDropdownEl = dropdown.selectEl;
			this.populateVariantDropdown(dropdown.selectEl);
			dropdown.onChange((value) => {
				this.selectedVariant = value;
			});
		});

		// Branch selector
		new Setting(contentEl)
			.setName('Base Branch')
			.setDesc('The branch to create the feature branch from')
			.addDropdown((dropdown) => {
				// Add local branches first
				const localBranches = this.branches.filter((b) => !b.is_remote);

				if (localBranches.length === 0) {
					// No local branches - use default or show placeholder
					dropdown.addOption(this.selectedBranch || 'main', this.selectedBranch || 'main');
					dropdown.setValue(this.selectedBranch || 'main');
				} else {
					for (const branch of localBranches) {
						dropdown.addOption(branch.name, branch.name + (branch.is_current ? ' (current)' : ''));
					}

					// Set default
					if (localBranches.some((b) => b.name === this.selectedBranch)) {
						dropdown.setValue(this.selectedBranch);
					} else {
						this.selectedBranch = localBranches[0].name;
						dropdown.setValue(this.selectedBranch);
					}
				}

				dropdown.onChange((value) => {
					this.selectedBranch = value;
				});
			});

		// Warning
		const warning = contentEl.createEl('p', {
			cls: 'setting-item-description mod-warning',
		});
		warning.textContent = 'This will start an AI agent working on this task in Vibe Kanban.';

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		buttonContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.close();
		});

		const executeButton = buttonContainer.createEl('button', {
			text: 'Execute',
			cls: 'mod-cta',
		});
		executeButton.addEventListener('click', async () => {
			if (!this.selectedBranch) {
				new Notice('Please select a base branch');
				return;
			}

			executeButton.disabled = true;
			executeButton.setText('Starting...');

			try {
				// Pass variant as null if it's DEFAULT (API treats null as default)
				const variant = this.selectedVariant === 'DEFAULT' ? null : this.selectedVariant;
				await this.onSubmit(this.selectedExecutor, variant, this.selectedBranch);
				this.close();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`Failed to execute: ${message}`);
				executeButton.disabled = false;
				executeButton.setText('Execute');
			}
		});
	}

	private populateVariantDropdown(selectEl: HTMLSelectElement): void {
		// Clear existing options
		selectEl.empty();

		// Find the current executor's variants
		const executorOption = this.executorOptions.find(
			(opt) => opt.executor === this.selectedExecutor
		);

		if (executorOption) {
			for (const variant of executorOption.variants) {
				const option = selectEl.createEl('option', {
					text: variant,
					value: variant,
				});
				if (variant === this.selectedVariant) {
					option.selected = true;
				}
			}

			// If current variant not available for this executor, reset to DEFAULT or first
			if (!executorOption.variants.includes(this.selectedVariant)) {
				this.selectedVariant = executorOption.variants.includes('DEFAULT')
					? 'DEFAULT'
					: executorOption.variants[0] || 'DEFAULT';
				selectEl.value = this.selectedVariant;
			}
		}
	}

	private updateVariantDropdown(): void {
		if (this.variantDropdownEl) {
			this.populateVariantDropdown(this.variantDropdownEl);
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
