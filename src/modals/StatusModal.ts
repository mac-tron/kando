import { App, Modal, Setting, Notice } from 'obsidian';
import { VKTask, VKTaskAttempt, VKTaskStatus } from '../types';

export interface StatusRefreshResult {
	task: VKTask;
	attempts: VKTaskAttempt[];
}

export class StatusModal extends Modal {
	private task: VKTask;
	private attempts: VKTaskAttempt[];
	private vkUrl: string;
	private projectId: string;
	private onRefresh: () => Promise<StatusRefreshResult>;

	constructor(
		app: App,
		task: VKTask,
		attempts: VKTaskAttempt[],
		vkUrl: string,
		projectId: string,
		onRefresh: () => Promise<StatusRefreshResult>
	) {
		super(app);
		this.task = task;
		this.attempts = attempts;
		this.vkUrl = vkUrl;
		this.projectId = projectId;
		this.onRefresh = onRefresh;
	}

	onOpen(): void {
		const { contentEl } = this;

		// Add keyboard navigation
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});

		contentEl.createEl('h2', { text: 'Execution Status' });

		// Task info
		new Setting(contentEl)
			.setName('Task')
			.addText((text) => {
				text.setValue(this.task.title);
				text.setDisabled(true);
			});

		// Status with indicator
		const statusSetting = new Setting(contentEl).setName('Status');
		const statusEl = statusSetting.controlEl.createEl('span', {
			cls: `vk-status vk-status-${this.task.status}`,
		});
		const statusText = this.formatStatus(this.task.status);
		// Use textContent for the display, with aria-label for screen readers
		statusEl.textContent = `${this.getStatusIcon(this.task.status)} ${statusText}`;
		statusEl.setAttribute('aria-label', `Status: ${statusText}`);

		// Latest attempt info
		if (this.attempts.length > 0) {
			const latestAttempt = this.attempts[this.attempts.length - 1];

			contentEl.createEl('h3', { text: 'Latest Attempt' });

			new Setting(contentEl)
				.setName('Executor')
				.addText((text) => {
					text.setValue(latestAttempt.executor.replace(/_/g, ' '));
					text.setDisabled(true);
				});

			new Setting(contentEl)
				.setName('Branch')
				.addText((text) => {
					text.setValue(latestAttempt.branch);
					text.setDisabled(true);
				});

			new Setting(contentEl)
				.setName('Target Branch')
				.addText((text) => {
					text.setValue(latestAttempt.target_branch);
					text.setDisabled(true);
				});

			new Setting(contentEl)
				.setName('Started')
				.addText((text) => {
					const date = new Date(latestAttempt.created_at);
					const timeStr = isNaN(date.getTime()) ? 'Unknown' : this.formatRelativeTime(date);
					text.setValue(timeStr);
					text.setDisabled(true);
				});

			if (this.attempts.length > 1) {
				contentEl.createEl('p', {
					text: `${this.attempts.length - 1} previous attempt(s)`,
					cls: 'setting-item-description',
				});
			}
		} else {
			contentEl.createEl('p', {
				text: 'No execution attempts yet.',
				cls: 'setting-item-description',
			});
		}

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		const openButton = buttonContainer.createEl('button', { text: 'View in Vibe Kanban' });
		openButton.addEventListener('click', () => {
			if (!this.vkUrl || !this.projectId || !this.task.id) {
				new Notice('Missing URL or project information');
				return;
			}
			const baseUrl = this.vkUrl.replace(/\/+$/, '');
			const url = `${baseUrl}/projects/${encodeURIComponent(this.projectId)}/tasks/${encodeURIComponent(this.task.id)}`;
			window.open(url, '_blank');
		});

		const refreshButton = buttonContainer.createEl('button', { text: 'Refresh' });
		refreshButton.addEventListener('click', async () => {
			refreshButton.disabled = true;
			refreshButton.setText('Refreshing...');

			try {
				const result = await this.onRefresh();
				// Update internal state
				this.task = result.task;
				this.attempts = result.attempts;
				// Re-render the modal content
				this.contentEl.empty();
				this.onOpen();
				new Notice('Status refreshed');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`Failed to refresh: ${message}`);
				refreshButton.disabled = false;
				refreshButton.setText('Refresh');
			}
		});

		buttonContainer.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}

	private getStatusIcon(status: VKTaskStatus): string {
		switch (status) {
			case 'notsynced':
				return '◇';
			case 'todo':
				return '○';
			case 'inprogress':
				return '◐';
			case 'inreview':
				return '◑';
			case 'done':
				return '●';
			case 'cancelled':
				return '✕';
			case 'deleted':
				return '⊘';
			default:
				return '○';
		}
	}

	private formatStatus(status: VKTaskStatus): string {
		switch (status) {
			case 'notsynced':
				return 'Not Synced';
			case 'todo':
				return 'To Do';
			case 'inprogress':
				return 'In Progress';
			case 'inreview':
				return 'In Review';
			case 'done':
				return 'Done';
			case 'cancelled':
				return 'Cancelled';
			case 'deleted':
				return 'Deleted';
			default:
				return status;
		}
	}

	private formatRelativeTime(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
	}
}
