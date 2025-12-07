import { App, Modal, Setting, Notice } from 'obsidian';
import { VKProject } from '../types';

export class PushModal extends Modal {
	private title: string;
	private projects: VKProject[];
	private selectedProjectId: string;
	private onSubmit: (projectId: string) => Promise<void>;

	constructor(
		app: App,
		title: string,
		projects: VKProject[],
		defaultProjectId: string,
		onSubmit: (projectId: string) => Promise<void>
	) {
		super(app);
		this.title = title;
		this.projects = projects;
		// Safely handle empty projects array
		if (projects.length > 0) {
			this.selectedProjectId = defaultProjectId || projects[0].id;
		} else {
			this.selectedProjectId = '';
		}
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;

		// Add keyboard navigation
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});

		contentEl.createEl('h2', { text: 'Push to Vibe Kanban' });

		// Title display
		new Setting(contentEl)
			.setName('Title')
			.setDesc('The feature title that will be used in Vibe Kanban')
			.addText((text) => {
				text.setValue(this.title);
				text.setDisabled(true);
			});

		// Project selector
		new Setting(contentEl)
			.setName('Project')
			.setDesc('Select the Vibe Kanban project for this feature')
			.addDropdown((dropdown) => {
				if (this.projects.length === 0) {
					dropdown.addOption('', 'No projects available');
					dropdown.setDisabled(true);
				} else {
					for (const project of this.projects) {
						dropdown.addOption(project.id, project.name);
					}
					dropdown.setValue(this.selectedProjectId);
					dropdown.onChange((value) => {
						this.selectedProjectId = value;
					});
				}
			});

		// Info text
		contentEl.createEl('p', {
			text: 'This will create a new task in Vibe Kanban with the note content as the description.',
			cls: 'setting-item-description',
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		buttonContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.close();
		});

		const pushButton = buttonContainer.createEl('button', {
			text: 'Push',
			cls: 'mod-cta',
		});
		pushButton.addEventListener('click', async () => {
			if (!this.selectedProjectId) {
				new Notice('Please select a project');
				return;
			}

			// Validate selected project exists
			if (!this.projects.find(p => p.id === this.selectedProjectId)) {
				new Notice('Invalid project selected');
				return;
			}

			pushButton.disabled = true;
			pushButton.setText('Pushing...');

			try {
				await this.onSubmit(this.selectedProjectId);
				this.close();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`Failed to push: ${message}`);
				pushButton.disabled = false;
				pushButton.setText('Push');
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
