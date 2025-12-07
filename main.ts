import {
	App,
	Plugin,
	TFile,
	TFolder,
	Notice,
	Menu,
	MarkdownView,
	WorkspaceLeaf,
	setIcon,
	addIcon,
} from 'obsidian';
import {
	VKPluginSettings,
	DEFAULT_SETTINGS,
	VKTaskStatus,
	VKTaskWithAttemptStatus,
	VKTaskAttempt,
	VKExecutorOption,
	parseExecutorProfiles,
	formatErrorMessage,
	DEFAULT_EXECUTOR,
	DEFAULT_EXECUTOR_VARIANTS,
} from './src/types';
import { VKApiClient } from './src/api';
import { FrontmatterManager } from './src/frontmatter';
import { VKSettingTab } from './src/settings';
import { PushModal } from './src/modals/PushModal';
import { ExecuteModal } from './src/modals/ExecuteModal';
import { StatusModal, StatusRefreshResult } from './src/modals/StatusModal';
import { CreateStoryModal, CreateStoryResult } from './src/modals/CreateStoryModal';
import { VKStatusPoller } from './src/websocket';
import { VibeKanbanView, VIBE_KANBAN_VIEW_TYPE } from './src/views/VibeKanbanView';

export default class VibeKanbanPlugin extends Plugin {
	settings!: VKPluginSettings;
	api!: VKApiClient;
	frontmatter!: FrontmatterManager;
	private statusBarItem: HTMLElement | null = null;
	private statusBarClickHandler: (() => void) | null = null;
	private toolbarButtons: WeakMap<WorkspaceLeaf, { add: HTMLElement; execute: HTMLElement; open: HTMLElement }> = new WeakMap();
	private fileExplorerButton: HTMLElement | null = null;
	private statusPoller: VKStatusPoller | null = null;
	private taskIdToFileIndex: Map<string, string> = new Map(); // taskId -> filePath
	private filesBeingUpdated: Set<string> = new Set(); // Prevent auto-push during programmatic updates (per-file)

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register custom icons (scaled from 24x24 to 100x100 viewBox)
		addIcon('kanban-plus', '<g stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M21 12.5v58"/><path d="M50 12.5v33"/><path d="M79 12.5v38"/><path d="M67 79h25"/><path d="M79 67v25"/></g>');
		addIcon('kanban-upload', '<g stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M17 15v50"/><path d="M40 15v25"/><path d="M63 15v30"/><path d="M79 88v-38"/><path d="M64 65l15-15 15 15"/></g>');
		addIcon('kanban-play', '<g stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M21 12.5v58"/><path d="M50 12.5v33"/><path d="M79 12.5v38"/></g><polygon points="62.5 67 87.5 79 62.5 92" fill="currentColor" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>');

		this.api = new VKApiClient(this.settings.vkUrl);
		this.frontmatter = new FrontmatterManager(this.app);

		// Add ribbon icon - left click opens VK, right click shows menu
		const ribbonIcon = this.addRibbonIcon('kanban', 'KanDo', (evt) => {
			// Left click - open Vibe Kanban
			this.openVibeKanbanView();
		});

		// Right click - show context menu (use registerDomEvent for proper cleanup)
		this.registerDomEvent(ribbonIcon, 'contextmenu', (evt) => {
			evt.preventDefault();
			this.showRibbonMenu(evt);
		});

		// Add status bar item
		if (this.settings.showStatusBar) {
			this.createStatusBarItem();
		}

		// Register commands
		this.addCommand({
			id: 'push-story',
			name: 'Push Feature',
			checkCallback: (checking: boolean) => {
				const file = this.getActiveFile();
				if (file && this.isInStoriesFolder(file)) {
					if (!checking) {
						this.pushStory(file);
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'execute-story',
			name: 'Add and Execute',
			checkCallback: (checking: boolean) => {
				const file = this.getActiveFile();
				if (file && this.isInStoriesFolder(file)) {
					if (!checking) {
						this.executeStory(file);
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'pull-status',
			name: 'Pull Status',
			checkCallback: (checking: boolean) => {
				const file = this.getActiveFile();
				if (file && this.isInStoriesFolder(file)) {
					if (!checking) {
						this.pullStatus(file);
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'open-in-vk',
			name: 'View in Vibe Kanban',
			checkCallback: (checking: boolean) => {
				const file = this.getActiveFile();
				if (file && this.isInStoriesFolder(file)) {
					if (!checking) {
						this.openInVK(file);
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'create-story',
			name: 'Create New Feature',
			callback: () => {
				this.createNewStory();
			},
		});

		// Add settings tab
		this.addSettingTab(new VKSettingTab(this.app, this));

		// Register the Vibe Kanban view
		this.registerView(
			VIBE_KANBAN_VIEW_TYPE,
			(leaf) => new VibeKanbanView(leaf)
		);

		// Add command to open Vibe Kanban view
		this.addCommand({
			id: 'open-vibe-kanban-view',
			name: 'Open Vibe Kanban',
			callback: () => {
				this.openVibeKanbanView();
			},
		});

		// Register event handlers
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					this.updateStatusBar(file);
					this.updateToolbarForFile(file);
				}
			})
		);

		// Listen for metadata cache changes to update UI when frontmatter is written
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file instanceof TFile && this.isInStoriesFolder(file)) {
					this.updateStatusBar(file);
					this.updateToolbarForFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				const file = this.getActiveFile();
				if (file) {
					this.updateStatusBar(file);
					this.updateToolbarForFile(file);
				}
				// Add toolbar to new leaf if it's a markdown view
				if (leaf?.view instanceof MarkdownView) {
					this.addToolbarToView(leaf.view);
				}
			})
		);

		// Register for layout changes to catch new panes and file explorers
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.app.workspace.iterateAllLeaves((leaf) => {
					if (leaf.view instanceof MarkdownView) {
						this.addToolbarToView(leaf.view);
					}
				});
				// Also add button to any new file explorers
				this.addFileExplorerButton();
			})
		);

		// Add context menu for folders
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle('New KanDo card')
							.setIcon('list-plus')
							.onClick(() => {
								this.createNewStory(file.path);
							});
					});
				}
			})
		);

		// Auto-push on save
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				// Skip if this is a programmatic frontmatter update
				if (!(file instanceof TFile)) return;
				if (this.filesBeingUpdated.has(file.path)) {
					return;
				}
				if (
					this.settings.autoPushOnSave &&
					this.isInStoriesFolder(file)
				) {
					const isSynced = await this.frontmatter.isSynced(file);
					if (isSynced) {
						await this.pushStoryQuiet(file);
					}
				}
			})
		);

		// Track file renames to update task index
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				// Update taskIdToFileIndex if this file was tracked
				// Use Array.from to avoid mutation during iteration
				for (const [taskId, filePath] of Array.from(this.taskIdToFileIndex.entries())) {
					if (filePath === oldPath) {
						this.taskIdToFileIndex.set(taskId, file.path);
						if (this.settings.debug) {
							console.log(`[KanDo] Updated task index: ${taskId} -> ${file.path}`);
						}
						break;
					}
				}
			})
		);

		// Track file deletions to clean up task index
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile)) return;
				// Remove from taskIdToFileIndex if this file was tracked
				// Use Array.from to avoid mutation during iteration
				for (const [taskId, filePath] of Array.from(this.taskIdToFileIndex.entries())) {
					if (filePath === file.path) {
						this.taskIdToFileIndex.delete(taskId);
						// Also clean up from poller
						if (this.statusPoller) {
							this.statusPoller.untrackTask(taskId);
						}
						if (this.settings.debug) {
							console.log(`[KanDo] Removed task from index: ${taskId}`);
						}
						break;
					}
				}
			})
		);

		// Build task index, start poller, and add toolbars when workspace is ready
		// onLayoutReady ensures the metadata cache has processed all files
		this.app.workspace.onLayoutReady(async () => {
			// Add toolbar to existing views
			this.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView) {
					this.addToolbarToView(leaf.view);
				}
			});

			// Add "New KanDo card" button to file explorer header
			this.addFileExplorerButton();

			await this.buildTaskIndex();
			this.updateWebSocketConnection();
		});
	}

	onunload(): void {
		// WeakMap auto-cleans when leaves are destroyed, no explicit cleanup needed
		// The DOM elements (buttons) are owned by Obsidian views and cleaned up automatically

		// Clean up status bar
		this.removeStatusBarItem();

		// Clean up file explorer button
		this.removeFileExplorerButton();

		// Stop poller
		if (this.statusPoller) {
			this.statusPoller.stop();
			this.statusPoller = null;
		}
	}

	private removeFileExplorerButton(): void {
		const explorers = this.app.workspace.getLeavesOfType('file-explorer');
		explorers.forEach((explorer) => {
			const button = explorer.view.containerEl.querySelector('.vk-explorer-new-button');
			if (button) button.remove();
		});
		this.fileExplorerButton = null;
	}

	private addToolbarToView(view: MarkdownView): void {
		const leaf = view.leaf;

		// Skip if already added
		if (this.toolbarButtons.has(leaf)) {
			return;
		}

		// Use Obsidian's addAction API - it handles all styling correctly
		// Actions are added right-to-left, so we add in reverse order
		const openButton = view.addAction('external-link', 'View in Vibe Kanban', () => {
			if (view.file) this.handleOpenClick(view.file);
		});
		openButton.addClass('vk-open');

		const executeButton = view.addAction('kanban-play', 'Add and Execute', () => {
			if (view.file) this.handleExecuteClick(view.file);
		});
		executeButton.addClass('vk-execute');

		const addButton = view.addAction('kanban-upload', 'Push to To Do', () => {
			if (view.file) this.handleAddClick(view.file);
		});
		addButton.addClass('vk-add');

		this.toolbarButtons.set(leaf, {
			add: addButton,
			execute: executeButton,
			open: openButton,
		});

		// Update button states for current file
		if (view.file) {
			this.updateToolbarButtons(view.file);
		}
	}

	private addFileExplorerButton(): void {
		const explorers = this.app.workspace.getLeavesOfType('file-explorer');
		explorers.forEach((explorer) => {
			this.addButtonToExplorer(explorer);
		});
	}

	private addButtonToExplorer(explorer: WorkspaceLeaf): void {
		const container = explorer.view.containerEl as HTMLDivElement;
		const navContainer = container.querySelector('div.nav-buttons-container') as HTMLDivElement;
		if (!navContainer) return;

		// Check if button already exists
		if (navContainer.querySelector('.vk-explorer-new-button')) return;

		// Create button element
		const button = document.createElement('div');
		button.className = 'clickable-icon nav-action-button vk-explorer-new-button';
		button.setAttribute('aria-label', 'New KanDo card');
		setIcon(button, 'kanban-plus');

		this.registerDomEvent(button, 'click', () => {
			this.createNewStory();
		});

		navContainer.appendChild(button);
		this.fileExplorerButton = button;
	}

	private async updateToolbarForFile(file: TFile): Promise<void> {
		// Update all toolbar buttons for views showing this file
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
				this.updateToolbarButtons(file);
			}
		});
	}

	private async updateToolbarButtons(file: TFile): Promise<void> {
		// Collect all matching leaves first (iterateAllLeaves doesn't wait for async)
		const matchingLeaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
				matchingLeaves.push(leaf);
			}
		});

		// Now process them with proper async/await
		for (const leaf of matchingLeaves) {
			const buttons = this.toolbarButtons.get(leaf);
			if (!buttons) continue;

			const { add, execute, open } = buttons;

			// Reset all classes
			add.removeClass('vk-hidden', 'vk-disabled');
			execute.removeClass('vk-hidden', 'vk-disabled', 'vk-executing');
			open.removeClass('vk-hidden', 'vk-disabled');

			// Hide all if not in stories folder
			if (!this.isInStoriesFolder(file)) {
				add.addClass('vk-hidden');
				execute.addClass('vk-hidden');
				open.addClass('vk-hidden');
				continue;
			}

			const isSynced = await this.frontmatter.isSynced(file);
			const status = isSynced ? await this.frontmatter.getStatus(file) : null;

			if (!isSynced) {
				// Unsynced: Show Add (upload icon) and Execute, hide Open
				setIcon(add, 'kanban-upload');
				add.setAttribute('aria-label', 'Push to To Do');
				execute.setAttribute('aria-label', 'Add and Execute');
				open.addClass('vk-hidden');
			} else {
				// Synced: Change Add to Sync (refresh-cw icon), show Execute and Open
				setIcon(add, 'refresh-cw');
				add.setAttribute('aria-label', 'Push changes');

				if (status === 'inprogress') {
					// Executing: pulse animation, disable execute, hide sync
					execute.addClass('vk-executing', 'vk-disabled');
					execute.setAttribute('aria-label', 'Executing...');
					add.addClass('vk-hidden'); // Can't sync while executing
					open.setAttribute('aria-label', 'View Task');
				} else if (status === 'inreview' || status === 'done') {
					// Executed: hide execute and sync (can't run again)
					execute.addClass('vk-hidden');
					add.addClass('vk-hidden');
					open.setAttribute('aria-label', 'View Task');
				} else {
					// Ready to execute (todo, cancelled)
					execute.setAttribute('aria-label', 'Add and Execute');
					open.setAttribute('aria-label', 'View in Vibe Kanban');
				}
			}
		}
	}

	// Handler for Push to To Do button
	private async handleAddClick(file: TFile): Promise<void> {
		if (!this.isInStoriesFolder(file)) {
			new Notice('Not a card file');
			return;
		}
		await this.pushStory(file);
	}

	// Handler for Execute button
	private async handleExecuteClick(file: TFile): Promise<void> {
		if (!this.isInStoriesFolder(file)) {
			new Notice('Not a card file');
			return;
		}

		const isSynced = await this.frontmatter.isSynced(file);
		const status = isSynced ? await this.frontmatter.getStatus(file) : null;

		// If executing/reviewing, do nothing (button should be disabled)
		if (status === 'inprogress' || status === 'inreview') {
			return;
		}

		if (!isSynced) {
			// Not synced: push first, then execute
			await this.pushStoryWithCallback(file, async () => {
				await this.executeStory(file);
			});
		} else {
			// Already synced: just execute
			await this.executeStory(file);
		}
	}

	// Handler for Open in VK button
	private async handleOpenClick(file: TFile): Promise<void> {
		if (!this.isInStoriesFolder(file)) {
			new Notice('Not a card file');
			return;
		}

		const fm = await this.frontmatter.read(file);
		if (!fm.vk_task_id) {
			new Notice('Card not synced with Vibe Kanban');
			return;
		}

		const status = fm.vk_status;

		// If executing or in review, open diffs view with latest attempt
		const baseUrl = this.settings.vkUrl.replace(/\/+$/, '');
		if ((status === 'inprogress' || status === 'inreview') && fm.vk_project_id) {
			const diffsPath = `/projects/${fm.vk_project_id}/tasks/${fm.vk_task_id}/attempts/latest?view=diffs`;
			if (this.settings.openInObsidian) {
				await this.openVibeKanbanView(diffsPath);
			} else {
				window.open(`${baseUrl}${diffsPath}`, '_blank');
			}
		} else if (fm.vk_project_id) {
			// Open task view (requires project_id in path)
			const taskPath = `/projects/${fm.vk_project_id}/tasks/${fm.vk_task_id}`;
			if (this.settings.openInObsidian) {
				await this.openVibeKanbanView(taskPath);
			} else {
				window.open(`${baseUrl}${taskPath}`, '_blank');
			}
		} else {
			new Notice('Missing project ID - cannot open task');
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private createStatusBarItem(): void {
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass('vk-status-bar');

		// Add icon
		const iconEl = this.statusBarItem.createSpan({ cls: 'vk-status-bar-icon' });
		setIcon(iconEl, 'kanban');

		// Add text span
		this.statusBarItem.createSpan({ cls: 'vk-status-bar-text', text: '—' });

		this.statusBarClickHandler = () => this.pullStatus();
		this.statusBarItem.addEventListener('click', this.statusBarClickHandler);
	}

	private removeStatusBarItem(): void {
		if (this.statusBarItem) {
			if (this.statusBarClickHandler) {
				this.statusBarItem.removeEventListener('click', this.statusBarClickHandler);
				this.statusBarClickHandler = null;
			}
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
	}

	updateStatusBarVisibility(): void {
		if (this.settings.showStatusBar && !this.statusBarItem) {
			this.createStatusBarItem();
			const file = this.getActiveFile();
			if (file) {
				this.updateStatusBar(file);
			}
		} else if (!this.settings.showStatusBar && this.statusBarItem) {
			this.removeStatusBarItem();
		}
	}

	async updateWebSocketConnection(): Promise<void> {
		// Stop existing poller
		if (this.statusPoller) {
			this.statusPoller.stop();
			this.statusPoller = null;
		}

		// Only start if auto-sync is enabled
		if (!this.settings.autoSyncStatus) {
			return;
		}

		this.statusPoller = new VKStatusPoller();

		// Collect project IDs from tracked tasks and initialize statuses
		const projectIds = new Set<string>();
		const statusPromises: Promise<void>[] = [];

		for (const [taskId, filePath] of this.taskIdToFileIndex.entries()) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				const promise = this.frontmatter.read(file).then((fm) => {
					// Collect project ID
					if (fm.vk_project_id) {
						projectIds.add(fm.vk_project_id);
					}
					// Set known status and track task
					if (this.statusPoller) {
						this.statusPoller.trackTask(taskId);
						if (fm.vk_status) {
							this.statusPoller.setKnownStatus(taskId, fm.vk_status);
						}
					}
				});
				statusPromises.push(promise);
			}
		}

		// Wait for all frontmatter to be read
		await Promise.all(statusPromises);

		// Add default project if set
		if (this.settings.defaultProjectId) {
			projectIds.add(this.settings.defaultProjectId);
		}

		// Only start if we have projects to poll
		if (projectIds.size === 0) {
			if (this.settings.debug) {
				console.log('[KanDo] No projects to poll - skipping poller start');
			}
			return;
		}

		this.statusPoller.start(
			this.settings.vkUrl,
			Array.from(projectIds),
			(task) => this.handleTaskUpdate(task),
			this.settings.debug
		);
	}

	private async handleTaskUpdate(task: VKTaskWithAttemptStatus): Promise<void> {
		// Find the file with this task ID
		const filePath = this.taskIdToFileIndex.get(task.id);
		if (!filePath) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		// Update frontmatter with new status (mark as programmatic update)
		this.filesBeingUpdated.add(file.path);
		try {
			await this.frontmatter.update(file, {
				vk_status: task.status,
				vk_last_synced: new Date().toISOString(),
			});

			// Update UI
			await this.updateStatusBar(file);
			await this.updateToolbarForFile(file);

			// Show notice for significant status changes
			if (task.status === 'done') {
				new Notice(`KanDo: "${task.title}" completed`);
			} else if (task.status === 'deleted') {
				// Get file title for the notice since task.title is empty for deleted tasks
				const fm = await this.frontmatter.read(file);
				const title = fm.title || file.basename;
				new Notice(`KanDo: "${title}" deleted`);
			}
		} catch (error) {
			if (this.settings.debug) {
				console.error('[KanDo] Error handling task update:', error);
			}
		} finally {
			this.filesBeingUpdated.delete(file.path);
		}
	}

	private async buildTaskIndex(): Promise<void> {
		this.taskIdToFileIndex.clear();

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			if (!this.isInStoriesFolder(file)) {
				continue;
			}

			try {
				const fm = await this.frontmatter.read(file);
				if (fm.vk_task_id) {
					this.taskIdToFileIndex.set(fm.vk_task_id, file.path);
					// Track active tasks in poller
					if (this.statusPoller) {
						this.statusPoller.trackTask(fm.vk_task_id);
					}
				}
			} catch (error) {
				// Only skip if it's a frontmatter parsing error
				// Log other errors for debugging
				if (error instanceof Error && !error.message.includes('frontmatter')) {
					console.error(`KanDo: Error reading ${file.path}:`, error.message);
				}
			}
		}
	}

	// Call this when a file is synced to update the index
	private updateTaskIndex(taskId: string, filePath: string): void {
		this.taskIdToFileIndex.set(taskId, filePath);
	}

	private getActiveFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file || null;
	}

	private isInStoriesFolder(file: TFile): boolean {
		if (!this.settings.storiesFolder) {
			return true; // No folder filtering
		}
		const folder = this.settings.storiesFolder.replace(/^\/|\/$/g, '');
		if (!folder) {
			return true; // Empty string after normalization means no filtering
		}
		// Check if file is directly in folder or in a subfolder
		const filePath = file.path;
		const parentPath = file.parent?.path || '';
		return filePath.startsWith(folder + '/') || parentPath === folder || parentPath.startsWith(folder + '/');
	}

	private async updateStatusBar(file: TFile): Promise<void> {
		if (!this.statusBarItem) return;

		const textEl = this.statusBarItem.querySelector('.vk-status-bar-text');
		if (!textEl) return;

		if (!this.isInStoriesFolder(file)) {
			textEl.textContent = '—';
			this.statusBarItem.className = 'vk-status-bar';
			return;
		}

		const isSynced = await this.frontmatter.isSynced(file);
		if (!isSynced) {
			textEl.textContent = 'Not synced';
			this.statusBarItem.className = 'vk-status-bar vk-status-unsynced';
			return;
		}

		const status = await this.frontmatter.getStatus(file);
		this.statusBarItem.className = `vk-status-bar vk-status-${status || 'unknown'}`;

		switch (status) {
			case 'notsynced':
				textEl.textContent = 'Not synced';
				break;
			case 'todo':
				textEl.textContent = 'To Do';
				break;
			case 'inprogress':
				textEl.textContent = 'Executing...';
				break;
			case 'inreview':
				textEl.textContent = 'In Review';
				break;
			case 'done':
				textEl.textContent = 'Done';
				break;
			case 'cancelled':
				textEl.textContent = 'Cancelled';
				break;
			case 'deleted':
				textEl.textContent = 'Deleted';
				break;
			default:
				textEl.textContent = 'Synced';
		}
	}

	private showRibbonMenu(evt: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('New KanDo card')
				.setIcon('list-plus')
				.onClick(() => {
					this.createNewStory();
				})
		);

		menu.addItem((item) =>
			item
				.setTitle('Settings')
				.setIcon('settings')
				.onClick(() => {
					(this.app as any).setting.open();
					(this.app as any).setting.openTabById('kando');
				})
		);

		menu.showAtMouseEvent(evt);
	}

	async pushStory(file: TFile): Promise<void> {
		await this.pushStoryWithCallback(file);
	}

	// Push story with optional callback (used for chained push+execute)
	async pushStoryWithCallback(file: TFile, onComplete?: () => Promise<void>): Promise<void> {
		try {
			const isSynced = await this.frontmatter.isSynced(file);
			const title = await this.frontmatter.getTitle(file);

			if (isSynced) {
				// Update existing task
				await this.pushStoryQuiet(file);
				new Notice('Card updated in Vibe Kanban');
				// Execute callback separately to isolate errors
				if (onComplete) {
					try {
						await onComplete();
					} catch (error) {
						const message = formatErrorMessage('Callback failed', error);
						console.error('[KanDo]', message);
						new Notice(message);
					}
				}
			} else {
				// Check for project ID in frontmatter or settings
				const fm = await this.frontmatter.read(file);
				const projectId = fm.vk_project_id || this.settings.defaultProjectId;

				if (projectId) {
					// Push directly without modal
					const description = await this.frontmatter.getDescription(file);

					const task = await this.api.createTask({
						project_id: projectId,
						title,
						description,
					});

					// Get project name (from frontmatter or fetch from API)
					let projectName = fm.vk_project_name || '';
					if (!projectName) {
						const projects = await this.api.getProjects();
						projectName = projects.find((p) => p.id === projectId)?.name || '';
					}

					await this.frontmatter.markSynced(file, task.id, projectId, projectName, task.status);
					this.updateTaskIndex(task.id, file.path);

					// Track task in poller
					if (this.statusPoller) {
						this.statusPoller.trackTask(task.id);
					}

					await this.updateStatusBar(file);
					await this.updateToolbarButtons(file);

					// Execute callback separately to isolate errors
					if (onComplete) {
						try {
							await onComplete();
						} catch (error) {
							const message = formatErrorMessage('Callback failed', error);
							console.error('[KanDo]', message);
							new Notice(message);
						}
					}
				} else {
					// No project ID available - show modal
					const projects = await this.api.getProjects();
					if (projects.length === 0) {
						new Notice('No projects found in Vibe Kanban');
						return;
					}

					new PushModal(
						this.app,
						title,
						projects,
						this.settings.defaultProjectId,
						async (selectedProjectId: string) => {
							const description = await this.frontmatter.getDescription(file);

							const task = await this.api.createTask({
								project_id: selectedProjectId,
								title,
								description,
							});

							const projectName = projects.find((p) => p.id === selectedProjectId)?.name || '';
							await this.frontmatter.markSynced(file, task.id, selectedProjectId, projectName, task.status);
							this.updateTaskIndex(task.id, file.path);

							// Track task in poller
							if (this.statusPoller) {
								this.statusPoller.trackTask(task.id);
							}

							await this.updateStatusBar(file);
							await this.updateToolbarButtons(file);

							// Execute callback separately to isolate errors
							if (onComplete) {
								try {
									await onComplete();
								} catch (error) {
									// Log callback error but don't fail the push
									const message = formatErrorMessage('Callback failed', error);
									console.error('[KanDo]', message);
									new Notice(message);
								}
							}
						}
					).open();
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to push: ${message}`);
		}
	}

	private async pushStoryQuiet(file: TFile): Promise<void> {
		const fm = await this.frontmatter.read(file);
		if (!fm.vk_task_id) return;

		const title = await this.frontmatter.getTitle(file);
		const description = await this.frontmatter.getDescription(file);

		await this.api.updateTask(fm.vk_task_id, {
			title,
			description,
		});

		await this.frontmatter.update(file, {
			vk_last_synced: new Date().toISOString(),
		});
	}

	async executeStory(file: TFile): Promise<void> {
		try {
			// Read frontmatter once at the start
			let fm = await this.frontmatter.read(file);
			let taskId: string | undefined = fm.vk_task_id;
			let projectId: string | undefined = fm.vk_project_id || this.settings.defaultProjectId;

			// If not synced, push to backlog first
			if (!taskId) {
				if (!projectId) {
					new Notice('No project configured - please set a default project in settings');
					return;
				}

				const title = await this.frontmatter.getTitle(file);
				const description = await this.frontmatter.getDescription(file);

				const task = await this.api.createTask({
					project_id: projectId,
					title,
					description,
				});

				// Get project name (from frontmatter or fetch from API)
				let projectName = fm.vk_project_name || '';
				if (!projectName) {
					const projects = await this.api.getProjects();
					projectName = projects.find((p) => p.id === projectId)?.name || '';
				}

				// Store task ID immediately - no need to re-read frontmatter
				taskId = task.id;
				await this.frontmatter.markSynced(file, task.id, projectId, projectName, task.status);
				this.updateTaskIndex(task.id, file.path);

				// Track task in poller
				if (this.statusPoller) {
					this.statusPoller.trackTask(taskId);
				}
			}

			// Use the values we already have - no need to re-read frontmatter
			if (!taskId || !projectId) {
				new Notice('Card not properly synced');
				return;
			}

			// Push latest content
			await this.pushStoryQuiet(file);

			const title = await this.frontmatter.getTitle(file);

			// Get branches and executor profiles in parallel
			let branches = [];
			let executorOptions: VKExecutorOption[] = [];

			try {
				const [branchesResult, profilesResult] = await Promise.all([
					this.api.getProjectBranches(projectId).catch(() => null),
					this.api.getProfiles().catch(() => null),
				]);

				branches = branchesResult || [
					{ name: this.settings.defaultBranch, is_current: true, is_remote: false },
				];

				if (profilesResult) {
					executorOptions = parseExecutorProfiles(profilesResult);
				}
			} catch {
				// Fall back to defaults
				branches = [{ name: this.settings.defaultBranch, is_current: true, is_remote: false }];
			}

			// Fallback if no executor options fetched
			if (executorOptions.length === 0) {
				executorOptions = [
					{ executor: DEFAULT_EXECUTOR, variants: [...DEFAULT_EXECUTOR_VARIANTS] },
				];
			}

			new ExecuteModal(
				this.app,
				title,
				branches,
				executorOptions,
				this.settings.defaultExecutor,
				this.settings.defaultVariant,
				this.settings.defaultBranch,
				async (executor: string, variant: string | null, branch: string) => {
					const attempt = await this.api.createTaskAttempt({
						task_id: taskId!,
						executor_profile_id: {
							executor,
							variant,
						},
						base_branch: branch,
					});

					await this.frontmatter.updateExecutionStatus(
						file,
						'inprogress',
						attempt.id,
						attempt.branch
					);
					await this.updateStatusBar(file);

					// Ensure poller tracks this task and project
					if (taskId && projectId) {
						if (this.statusPoller) {
							this.statusPoller.setKnownStatus(taskId, 'inprogress');
							this.statusPoller.addProject(projectId);
						} else if (this.settings.autoSyncStatus) {
							// Start poller if not running
							await this.updateWebSocketConnection();
						}
					}
				}
			).open();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to execute: ${message}`);
		}
	}

	async pullStatus(file?: TFile): Promise<void> {
		const targetFile = file || this.getActiveFile();
		if (!targetFile) {
			new Notice('No file open');
			return;
		}

		if (!this.isInStoriesFolder(targetFile)) {
			new Notice('Not a card file');
			return;
		}

		try {
			const isSynced = await this.frontmatter.isSynced(targetFile);
			if (!isSynced) {
				new Notice('Card not synced with Vibe Kanban');
				return;
			}

			const fm = await this.frontmatter.read(targetFile);
			if (!fm.vk_task_id) {
				new Notice('No task ID found');
				return;
			}

			const task = await this.api.getTask(fm.vk_task_id);
			let attempts: any[] = [];

			try {
				attempts = await this.api.getTaskAttempts(fm.vk_task_id);
			} catch {
				// No attempts or error fetching
			}

			// Update frontmatter
			const latestAttempt = attempts[attempts.length - 1];
			await this.frontmatter.updateExecutionStatus(
				targetFile,
				task.status,
				latestAttempt?.id,
				latestAttempt?.branch
			);
			await this.updateStatusBar(targetFile);

			// Show status modal with refresh callback that returns updated data
			new StatusModal(
				this.app,
				task,
				attempts,
				this.settings.vkUrl,
				fm.vk_project_id || '',
				async (): Promise<StatusRefreshResult> => {
					// Fetch latest data
					const refreshedTask = await this.api.getTask(fm.vk_task_id!);
					let refreshedAttempts: VKTaskAttempt[] = [];
					try {
						refreshedAttempts = await this.api.getTaskAttempts(fm.vk_task_id!);
					} catch {
						// No attempts or error fetching
					}

					// Update frontmatter
					const latestAttempt = refreshedAttempts[refreshedAttempts.length - 1];
					await this.frontmatter.updateExecutionStatus(
						targetFile,
						refreshedTask.status,
						latestAttempt?.id,
						latestAttempt?.branch
					);
					await this.updateStatusBar(targetFile);

					return { task: refreshedTask, attempts: refreshedAttempts };
				}
			).open();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to pull status: ${message}`);
		}
	}

	async openInVK(file?: TFile): Promise<void> {
		const targetFile = file || this.getActiveFile();
		if (!targetFile) {
			new Notice('No file open');
			return;
		}

		try {
			const fm = await this.frontmatter.read(targetFile);
			if (!fm.vk_task_id) {
				new Notice('Card not synced with Vibe Kanban');
				return;
			}

			if (!fm.vk_project_id) {
				new Notice('Missing project ID - cannot open task');
				return;
			}

			const taskPath = `/projects/${fm.vk_project_id}/tasks/${fm.vk_task_id}`;
			if (this.settings.openInObsidian) {
				await this.openVibeKanbanView(taskPath);
			} else {
				const baseUrl = this.settings.vkUrl.replace(/\/+$/, '');
				window.open(`${baseUrl}${taskPath}`, '_blank');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to open: ${message}`);
		}
	}

	/**
	 * Open the Vibe Kanban view in a new tab.
	 * Optionally navigate to a specific path within VK.
	 * If no path provided and defaultProjectId is set, opens the project's task board.
	 */
	async openVibeKanbanView(path: string = ''): Promise<void> {
		// Default to the configured project's task board if no path specified
		if (!path && this.settings.defaultProjectId) {
			path = `/projects/${this.settings.defaultProjectId}/tasks`;
		}

		// Check if there's already an open VK view
		const existingLeaves = this.app.workspace.getLeavesOfType(VIBE_KANBAN_VIEW_TYPE);

		if (existingLeaves.length > 0) {
			// Focus existing view and optionally navigate
			const leaf = existingLeaves[0];
			this.app.workspace.revealLeaf(leaf);

			if (path) {
				const view = leaf.view as unknown as VibeKanbanView;
				view.navigateTo(path);
			}
			return;
		}

		// Create a new leaf (tab) for the view
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: VIBE_KANBAN_VIEW_TYPE,
			active: true,
			state: { vkUrl: this.settings.vkUrl, path },
		});

		// Set the URL on the view (also done via state, but this ensures it's set)
		const view = leaf.view as unknown as VibeKanbanView;
		if (view && view.setUrl) {
			view.setUrl(this.settings.vkUrl, path);
		}

		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Create a new story file with native template functionality.
	 * @param targetFolder Optional folder path to create the story in
	 */
	async createNewStory(targetFolder?: string): Promise<void> {
		try {
			// Validate and sanitize targetFolder to prevent path traversal
			let folder = '';
			if (targetFolder) {
				// Normalize path and check for traversal attempts
				const normalized = targetFolder
					.replace(/\\/g, '/') // Normalize backslashes
					.replace(/\/+/g, '/') // Remove duplicate slashes
					.replace(/^\/|\/$/g, ''); // Remove leading/trailing slashes

				// Reject paths with traversal patterns
				if (normalized.includes('..') || normalized.startsWith('/')) {
					new Notice('Invalid folder path');
					return;
				}

				// Verify the folder exists in the vault
				const folderObj = this.app.vault.getAbstractFileByPath(normalized);
				if (folderObj instanceof TFolder) {
					folder = normalized;
				} else if (!folderObj) {
					// Folder doesn't exist, but path is valid - we'll create it
					folder = normalized;
				} else {
					// Path points to a file, not a folder
					new Notice('Invalid folder path');
					return;
				}
			} else {
				folder = this.settings.storiesFolder || '';
			}

			// Show create story modal
			const result = await this.showCreateStoryModal('Untitled');
			if (!result) return; // User cancelled

			// Generate unique filename
			const filePath = this.generateUniqueFilePath(folder, result.title);

			// Build file content
			const content = this.buildStoryContent(result);

			// Ensure folder exists
			if (folder) {
				const folderExists = this.app.vault.getAbstractFileByPath(folder);
				if (!folderExists) {
					await this.app.vault.createFolder(folder);
				}
			}

			// Create file
			const file = await this.app.vault.create(filePath, content);

			// Open the file
			const leaf = this.app.workspace.getLeaf();
			await leaf.openFile(file);

			// Ensure toolbar is added after file opens
			// Small delay to allow view to fully initialize
			setTimeout(() => {
				if (leaf.view instanceof MarkdownView) {
					this.addToolbarToView(leaf.view);
					if (leaf.view.file) {
						this.updateToolbarButtons(leaf.view.file);
					}
				}
			}, 50);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to create card: ${message}`);
		}
	}

	/**
	 * Generate a unique file path, appending numbers if needed to avoid duplicates.
	 */
	private generateUniqueFilePath(folder: string, title: string): string {
		// Sanitize title for filename (remove/replace invalid characters)
		const sanitizedTitle = title
			.replace(/[\\/:*?"<>|]/g, '-')
			.replace(/\s+/g, ' ')
			.trim();

		const basePath = folder ? `${folder}/${sanitizedTitle}` : sanitizedTitle;
		let filePath = `${basePath}.md`;
		let counter = 1;

		// Check for duplicates and append number if needed
		while (this.app.vault.getAbstractFileByPath(filePath)) {
			filePath = `${basePath} ${counter}.md`;
			counter++;
		}

		return filePath;
	}

	/**
	 * Build the markdown content for a new story file.
	 */
	private buildStoryContent(result: CreateStoryResult): string {
		const frontmatter = `---
title: ${result.title}
vk_status: notsynced
vk_project_name: ${result.project.name}
vk_project_id: ${result.project.id}
---`;

		const body = result.description || '';

		return `${frontmatter}\n\n${body}\n`;
	}

	/**
	 * Public API for Templater integration.
	 * Shows a single modal to create a new story with project, title, and description.
	 * Returns null if cancelled.
	 */
	async showCreateStoryModal(defaultTitle: string = 'Untitled'): Promise<CreateStoryResult | null> {
		try {
			const projects = await this.api.getProjects();
			if (projects.length === 0) {
				new Notice('No projects found in Vibe Kanban');
				return null;
			}

			const modal = new CreateStoryModal(
				this.app,
				projects,
				this.settings.defaultProjectId,
				defaultTitle
			);

			return await modal.openAndWait();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to load projects: ${message}`);
			return null;
		}
	}
}
