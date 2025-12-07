import { App, TFile } from 'obsidian';
import { VKFrontmatter, VKTaskStatus } from './types';

export class FrontmatterManager {
	private app: App;
	private updateQueues: Map<string, Promise<void>> = new Map(); // Per-file update queue

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Read VK-related frontmatter from a file
	 */
	async read(file: TFile): Promise<VKFrontmatter> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter || {};

		return {
			title: frontmatter.title,
			vk_project_name: frontmatter.vk_project_name,
			vk_project_id: frontmatter.vk_project_id,
			vk_task_id: frontmatter.vk_task_id,
			vk_status: frontmatter.vk_status,
			vk_last_synced: frontmatter.vk_last_synced,
			vk_attempt_id: frontmatter.vk_attempt_id,
			vk_branch: frontmatter.vk_branch,
			vk_pr_url: frontmatter.vk_pr_url,
			vk_executor: frontmatter.vk_executor,
		};
	}

	/**
	 * Update VK-related frontmatter fields (merges with existing)
	 * Uses a per-file queue to prevent concurrent update race conditions
	 */
	async update(file: TFile, updates: Partial<VKFrontmatter>): Promise<void> {
		const filePath = file.path;

		// Get or create the queue for this file
		const existingQueue = this.updateQueues.get(filePath) || Promise.resolve();

		// Chain this update after any pending updates
		const updatePromise = existingQueue.then(async () => {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				for (const [key, value] of Object.entries(updates)) {
					if (value !== undefined) {
						frontmatter[key] = value;
					}
				}
			});
		}).finally(() => {
			// Clean up queue entry if this was the last update
			if (this.updateQueues.get(filePath) === updatePromise) {
				this.updateQueues.delete(filePath);
			}
		});

		this.updateQueues.set(filePath, updatePromise);
		await updatePromise;
	}

	/**
	 * Get the title from frontmatter or filename
	 */
	async getTitle(file: TFile): Promise<string> {
		const fm = await this.read(file);
		return fm.title || file.basename;
	}

	/**
	 * Get the description (body content without frontmatter)
	 */
	async getDescription(file: TFile): Promise<string> {
		const content = await this.app.vault.read(file);

		// Remove frontmatter block if present (cross-platform: handles \r\n and \n)
		// Matches: --- followed by newline, any content, newline, ---, optional trailing newlines
		const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n*/;
		const body = content.replace(frontmatterRegex, '').trim();

		return body;
	}

	/**
	 * Check if file has VK integration (has vk_task_id)
	 */
	async isSynced(file: TFile): Promise<boolean> {
		const fm = await this.read(file);
		return !!fm.vk_task_id;
	}

	/**
	 * Get current VK status
	 */
	async getStatus(file: TFile): Promise<VKTaskStatus | null> {
		const fm = await this.read(file);
		return fm.vk_status || null;
	}

	/**
	 * Mark as synced with VK task
	 */
	async markSynced(
		file: TFile,
		taskId: string,
		projectId: string,
		projectName: string,
		status: VKTaskStatus = 'todo'
	): Promise<void> {
		await this.update(file, {
			vk_task_id: taskId,
			vk_project_name: projectName,
			vk_project_id: projectId,
			vk_status: status,
			vk_last_synced: new Date().toISOString(),
		});
	}

	/**
	 * Update execution status
	 */
	async updateExecutionStatus(
		file: TFile,
		status: VKTaskStatus,
		attemptId?: string,
		branch?: string
	): Promise<void> {
		const updates: Partial<VKFrontmatter> = {
			vk_status: status,
			vk_last_synced: new Date().toISOString(),
		};

		if (attemptId) {
			updates.vk_attempt_id = attemptId;
		}

		if (branch) {
			updates.vk_branch = branch;
		}

		await this.update(file, updates);
	}
}
