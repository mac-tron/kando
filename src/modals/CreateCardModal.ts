import { App, Modal, Setting, Notice, TextAreaComponent } from 'obsidian';
import { VKProject } from '../types';

export interface CreateCardResult {
	project: VKProject;
	title: string;
	description: string;
}

export class CreateCardModal extends Modal {
	private projects: VKProject[];
	private defaultProjectId: string;
	private defaultTitle: string;
	private selectedProject: VKProject | null;
	private title: string;
	private description: string;
	private resolvePromise: ((result: CreateCardResult | null) => void) | null = null;

	constructor(
		app: App,
		projects: VKProject[],
		defaultProjectId: string,
		defaultTitle: string
	) {
		super(app);
		this.projects = projects;
		this.defaultProjectId = defaultProjectId;
		this.defaultTitle = defaultTitle;
		this.title = '';
		this.description = '';

		// Sort projects (default first, then alphabetical)
		this.projects = [...projects].sort((a, b) => {
			if (a.id === defaultProjectId) return -1;
			if (b.id === defaultProjectId) return 1;
			return a.name.localeCompare(b.name);
		});

		// Set default selection - handle empty array with proper null type
		if (this.projects.length > 0) {
			this.selectedProject = this.projects.find(p => p.id === defaultProjectId) || this.projects[0];
		} else {
			this.selectedProject = null;
		}
	}

	async openAndWait(): Promise<CreateCardResult | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('vk-create-card-modal');

		contentEl.createEl('h2', { text: 'New KanDo card' });

		// Handle no projects case
		if (this.projects.length === 0) {
			contentEl.createEl('p', {
				text: 'No projects available. Please check your Vibe Kanban connection.',
				cls: 'setting-item-description mod-warning',
			});
			const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
			buttonContainer.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => {
				this.close();
			});
			return;
		}

		// Project selector
		new Setting(contentEl)
			.setName('Project')
			.addDropdown((dropdown) => {
				for (const project of this.projects) {
					const label = project.id === this.defaultProjectId
						? `${project.name} (default)`
						: project.name;
					dropdown.addOption(project.id, label);
				}
				dropdown.setValue(this.selectedProject?.id || '');
				dropdown.onChange((value) => {
					this.selectedProject = this.projects.find(p => p.id === value) || this.projects[0];
				});
			});

		// Title input
		new Setting(contentEl)
			.setName('Title')
			.addText((text) => {
				text.setPlaceholder('Card title');
				text.onChange((value) => {
					this.title = value;
				});
				// Auto-focus the title field
				setTimeout(() => text.inputEl.focus(), 50);
			});

		// Prompt textarea
		new Setting(contentEl)
			.setName('Prompt')
			.setDesc('Optional - press Cmd/Ctrl+Enter to submit');

		const textAreaContainer = contentEl.createDiv({ cls: 'vk-textarea-container' });
		const textArea = new TextAreaComponent(textAreaContainer);
		textArea.setPlaceholder('Prompt details here...');
		textArea.onChange((value) => {
			this.description = value;
		});
		textArea.inputEl.rows = 6;
		textArea.inputEl.addClass('vk-description-textarea');

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		buttonContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.close();
		});

		const createButton = buttonContainer.createEl('button', {
			text: 'Create',
			cls: 'mod-cta',
		});
		createButton.addEventListener('click', () => {
			if (!this.title.trim()) {
				new Notice('Please enter a title');
				return;
			}
			if (!this.selectedProject) {
				new Notice('Please select a project');
				return;
			}

			if (this.resolvePromise) {
				this.resolvePromise({
					project: this.selectedProject,
					title: this.title.trim(),
					description: this.description.trim(),
				});
				this.resolvePromise = null;
			}
			this.close();
		});

		// Handle Enter key to submit (Enter in title field, Cmd/Ctrl+Enter anywhere)
		contentEl.addEventListener('keydown', (e) => {
			const isTextArea = document.activeElement?.tagName === 'TEXTAREA';
			const isModifiedEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
			const isPlainEnter = e.key === 'Enter' && !e.shiftKey && !isTextArea;

			if (isModifiedEnter || isPlainEnter) {
				e.preventDefault();
				createButton.click();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();

		// If closed without submitting, resolve with null
		if (this.resolvePromise) {
			this.resolvePromise(null);
			this.resolvePromise = null;
		}
	}
}
